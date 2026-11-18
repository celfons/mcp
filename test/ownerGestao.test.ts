import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import worker from "../src/server";
import { verifyAccess, resetAccessKeyCache } from "../src/owner/access";
import { putOwners, ownerTenants } from "../src/owner/owners";
import { vendas, prospects, resolvePeriod, type EvoAccess } from "../src/owner/evoGestao";
import { hashToken } from "../src/tenant/store";
import { buildEvoManifest } from "../src/tenant/presets/evo";

// ---------------------------------------------------------------------------
// /mcp/gestao/<tenantId>: a gestão da academia para o DONO, via claude.ai.
//
// Ordem do risco: (1) quem passa — o JWT do Access tem de ser validado de
// verdade, e o e-mail tem de estar na lista de donos DAQUELA academia; (2) o que
// sai — agregados, nunca nome/CPF/telefone de aluno.
// ---------------------------------------------------------------------------

const TEAM = "closing.cloudflareaccess.com";
const AUD = "aud-portal-123";
const ctx = {} as ExecutionContext;

const b64url = (bytes: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const b64json = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

let keys: CryptoKeyPair;
let jwk: JsonWebKey;

beforeEach(async () => {
  resetAccessKeyCache();
  keys = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;
  jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
});
afterEach(() => vi.unstubAllGlobals());

async function sign(claims: Record<string, unknown>, kid = "k1", key = keys.privateKey): Promise<string> {
  const head = b64json({ alg: "RS256", kid });
  const body = b64json(claims);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}
const goodClaims = (over: Record<string, unknown> = {}) => ({
  aud: [AUD],
  iss: `https://${TEAM}`,
  exp: Math.floor(Date.now() / 1000) + 600,
  email: "Dono@Academia.com",
  ...over
});
const certs = () => async () => new Response(JSON.stringify({ keys: [{ ...jwk, kid: "k1" }] }));
const req = (token?: string, path = "/mcp/gestao/tnt_a") =>
  new Request(`https://gw.example.test${path}`, {
    method: "POST",
    headers: token ? { "cf-access-jwt-assertion": token } : {}
  });

const fakeKv = (data = new Map<string, string>()) => ({
  data,
  get: async (k: string, t?: string) => {
    const v = data.get(k);
    return v === undefined ? null : t === "json" ? JSON.parse(v) : v;
  },
  put: async (k: string, v: string) => void data.set(k, v),
  delete: async (k: string) => void data.delete(k)
});
const envWith = (kv = fakeKv(), extra: Record<string, unknown> = {}) =>
  ({ TENANT_MANIFESTS: kv, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_TOKEN: "admin-token-1234567890", ...extra }) as unknown as Env;

describe("verifyAccess: o JWT do Cloudflare Access é validado de verdade", () => {
  it("sessão válida devolve o e-mail normalizado", async () => {
    const id = await verifyAccess(req(await sign(goodClaims())), envWith(), { fetcher: certs() });
    expect(id).toEqual({ ok: true, email: "dono@academia.com" });
  });

  it.each([
    ["audiência de outro aplicativo", { aud: ["outro"] }],
    ["outro emissor", { iss: "https://outro.cloudflareaccess.com" }],
    ["expirado", { exp: Math.floor(Date.now() / 1000) - 5 }],
    ["sem e-mail", { email: "" }]
  ])("recusa: %s", async (_n, over) => {
    const id = await verifyAccess(req(await sign(goodClaims(over))), envWith(), { fetcher: certs() });
    expect(id.ok).toBe(false);
  });

  it("recusa assinatura de outra chave e cabeçalho ausente", async () => {
    const other = (await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"]
    )) as CryptoKeyPair;
    expect((await verifyAccess(req(await sign(goodClaims(), "k1", other.privateKey)), envWith(), { fetcher: certs() })).ok).toBe(false);
    expect((await verifyAccess(req(), envWith(), { fetcher: certs() })).ok).toBe(false);
  });

  it("sem configuração do Access, 503 — ausência de configuração nunca libera", async () => {
    const id = await verifyAccess(req(await sign(goodClaims())), envWith(fakeKv(), { ACCESS_AUD: "" }), { fetcher: certs() });
    expect(id).toMatchObject({ ok: false, status: 503 });
  });
});

describe("lista de donos", () => {
  const put = (env: Env, body: unknown, token = "admin-token-1234567890") =>
    putOwners(
      new Request("https://h/admin/tenants/tnt_a/owners", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(body)
      }),
      env,
      "tnt_a"
    );

  it("adiciona e remove, sem mexer nas outras academias da pessoa", async () => {
    const kv = fakeKv();
    const env = envWith(kv);
    kv.data.set(`owner-email:${await hashToken("dono@academia.com")}`, JSON.stringify(["tnt_b"]));
    expect((await put(env, { emails: ["Dono@Academia.com"] })).status).toBe(200);
    expect(await ownerTenants(env, "dono@academia.com")).toEqual(["tnt_b", "tnt_a"]);
    await put(env, { emails: [], removeEmails: ["dono@academia.com"] });
    expect(await ownerTenants(env, "dono@academia.com")).toEqual(["tnt_b"]);
  });

  it("exige o token de admin", async () => {
    expect((await put(envWith(), { emails: ["a@b.co"] }, "errado-errado-errado")).status).toBe(401);
  });
});

describe("rota /mcp/gestao/<tenantId>", () => {
  const withCerts = () => {
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes("/cdn-cgi/access/certs") ? certs()() : real(input, init)
    );
  };

  it("sem sessão do Access: 401", async () => {
    const res = await worker.fetch!(req() as any, envWith(), ctx);
    expect(res.status).toBe(401);
  });

  it("login válido, mas não é dono DESTA academia: 403", async () => {
    withCerts();
    const kv = fakeKv();
    kv.data.set(`owner-email:${await hashToken("dono@academia.com")}`, JSON.stringify(["tnt_b"]));
    const res = await worker.fetch!(req(await sign(goodClaims())) as any, envWith(kv), ctx);
    expect(res.status).toBe(403);
  });

  it("dono da academia sem EVO: 404", async () => {
    withCerts();
    const kv = fakeKv();
    kv.data.set(`owner-email:${await hashToken("dono@academia.com")}`, JSON.stringify(["tnt_a"]));
    const res = await worker.fetch!(req(await sign(goodClaims())) as any, envWith(kv), ctx);
    expect(res.status).toBe(404);
  });

  it("dono com EVO: anuncia a gestão e a vitrine, e NUNCA as consultas do aluno", async () => {
    withCerts();
    const kv = fakeKv();
    kv.data.set(`owner-email:${await hashToken("dono@academia.com")}`, JSON.stringify(["tnt_a"]));
    const built = buildEvoManifest({ tenantId: "tnt_a", label: "Unidade A", dns: "unidade", secretKey: "segredo" });
    if (!built.ok) throw new Error(built.error);
    kv.data.set("tenant-manifest:tnt_a", JSON.stringify(built.manifest));
    const res = await worker.fetch!(
      new Request("https://gw.example.test/mcp/gestao/tnt_a", {
        method: "POST",
        headers: {
          "cf-access-jwt-assertion": await sign(goodClaims()),
          "content-type": "application/json",
          accept: "application/json, text/event-stream"
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
      }) as any,
      envWith(kv),
      ctx
    );
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain("evo_gestao_vendas");
    expect(text).toContain("evo_planos_e_precos");
    expect(text).not.toContain("evo_meu_plano");
    expect(text).not.toContain("evo_minhas_cobrancas");
  });
});

describe("agregação: totais, e nenhum dado pessoal de aluno", () => {
  const access: EvoAccess = { authorization: "Basic eA==", idBranch: 7 };

  it("vendas: soma por dia/item, ignora removidas, não devolve nome nem CPF", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      return new Response(
        JSON.stringify([
          {
            saleDate: "2026-11-02T10:00:00",
            nameEmployeeSale: "Ana Recepção",
            member: { name: "Fulano da Silva", document: "123.456.789-00" },
            saleItens: [{ description: "Plano Anual", saleValue: 119, idMembership: 3 }]
          },
          { saleDate: "2026-11-02T11:00:00", saleItens: [{ description: "Day use", saleValue: 30 }] },
          { saleDate: "2026-11-03T09:00:00", removed: true, saleItens: [{ description: "Plano Anual", saleValue: 119 }] }
        ])
      );
    });
    const out = await vendas(access, { start: "2026-11-01", end: "2026-11-05" });
    expect(out).toMatchObject({ vendas: 2, vendasComPlano: 1, valorTotal: 149, ticketMedio: 74.5 });
    expect(out.porDia).toEqual([{ dia: "2026-11-02", quantidade: 2, valor: 149 }]);
    expect(JSON.stringify(out)).not.toMatch(/Fulano|123\.456/);
    expect(calls[0]).toContain("dateSaleStart=2026-11-01");
    expect(calls[0]).toContain("idBranch=7");
    expect(calls).toHaveLength(1);
  });

  it("prospects: conversão por canal, sem telefone", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify([
          { registerDate: "2026-11-01", mktChannel: "Instagram", cellphone: "11999990000", idMember: 10 },
          { registerDate: "2026-11-01", mktChannel: "Instagram", cellphone: "11999990001" },
          { registerDate: "2026-11-02", mktChannel: "", cellphone: "11999990002" }
        ])
      )
    );
    const out = await prospects(access, { start: "2026-11-01", end: "2026-11-05" });
    expect(out).toMatchObject({ prospects: 3, convertidos: 1 });
    expect(out.porCanal).toContainEqual({ canal: "Instagram", quantidade: 2, convertidos: 1, taxaConversao: 50 });
    expect(JSON.stringify(out)).not.toMatch(/1199999/);
  });

  it("período: padrão de 30 dias e teto de 366", () => {
    expect(resolvePeriod({ dataFim: "2026-11-30" })).toEqual({ start: "2026-11-01", end: "2026-11-30" });
    expect(typeof resolvePeriod({ dataInicio: "2025-01-01", dataFim: "2026-11-30" })).toBe("string");
    expect(typeof resolvePeriod({ dataInicio: "30/11/2026" })).toBe("string");
  });
});
