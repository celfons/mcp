import { describe, it, expect, vi, afterEach } from "vitest";
import worker from "../src/server";
import { handleGestaoInternal } from "../src/owner/gestaoInternal";
import { buildEvoUrl, capOutput, MAX_OUTPUT_CHARS, registerEvoApiTools } from "../src/owner/evoApi";
import { EVO_ROUTES } from "../src/owner/evoCatalog";
import { maskPersonalData } from "../src/owner/evoMask";
import { hashToken } from "../src/tenant/store";
import { buildEvoManifest } from "../src/tenant/presets/evo";

// ---------------------------------------------------------------------------
// A API de leitura da EVO, rota a rota, só na GESTÃO.
//
// Ordem do risco: (1) o agente do WhatsApp NÃO ganha estas ferramentas; (2) só
// leitura, e sem as rotas de segredo; (3) a unidade é a da academia; (4) dado
// pessoal de aluno sai mascarado, inclusive no erro.
// ---------------------------------------------------------------------------

const ctx = {} as ExecutionContext;
const TOKEN = "token-da-academia-a-0123456789";
afterEach(() => vi.unstubAllGlobals());

const fakeKv = (data = new Map<string, string>()) => ({
  data,
  get: async (k: string, t?: string) => {
    const v = data.get(k);
    return v === undefined ? null : t === "json" ? JSON.parse(v) : v;
  },
  put: async (k: string, v: string) => void data.set(k, v),
  delete: async (k: string) => void data.delete(k)
});

async function seeded(idBranch?: number) {
  const kv = fakeKv();
  const built = buildEvoManifest({ tenantId: "tnt_a", label: "Unidade A", dns: "unidade", secretKey: "segredo", idBranch });
  if (!built.ok) throw new Error(built.error);
  kv.data.set("tenant-manifest:tnt_a", JSON.stringify(built.manifest));
  kv.data.set(`tenant-token:${await hashToken(TOKEN)}`, "tnt_a");
  return { TENANT_MANIFESTS: kv } as unknown as Env;
}

const rpc = (method: string, params: Record<string, unknown>, path = "/mcp/gestao") =>
  new Request(`https://mcp-social.internal${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });

describe("quem recebe as ferramentas", () => {
  it("a gestão anuncia todas as rotas do catálogo", async () => {
    const text = await (await handleGestaoInternal(rpc("tools/list", {}), await seeded(), ctx)).text();
    for (const route of EVO_ROUTES) expect(text).toContain(`"${route.tool}"`);
    expect(text).toContain("evo_gestao_vendas");
  });

  it("o agente do WhatsApp (/mcp/tenant) segue SEM elas", async () => {
    const res = await worker.fetch!(rpc("tools/list", {}, "/mcp/tenant") as any, await seeded(), ctx);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain("evo_planos_e_precos");
    expect(text).not.toMatch(/"evo_v\d_/);
  });
});

describe("catálogo: só leitura, sem as rotas de segredo", () => {
  it("nenhuma rota de cartão, foto facial, token de gateway, troca de senha ou PIX", () => {
    const paths = EVO_ROUTES.map((r) => r.path);
    for (const banned of [
      "/api/v1/members/{idMember}/creditcard",
      "/api/v2/accessControl/facial-photo",
      "/api/v1/configuration/gateway-form-token",
      "/api/v2/configuration/gateway",
      "/api/v1/members/resetPassword",
      "/api/v1/pix/qr-code"
    ])
      expect(paths).not.toContain(banned);
    expect(EVO_ROUTES.length).toBeGreaterThan(70);
  });

  it("nomes válidos e únicos para o MCP", () => {
    const names = EVO_ROUTES.map((r) => r.tool);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z0-9_]{1,64}$/);
  });

  it("toda chamada sai como GET", async () => {
    const methods: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      methods.push(String(init.method));
      return new Response("[]");
    });
    const tools: Record<string, (a: Record<string, unknown>) => Promise<unknown>> = {};
    registerEvoApiTools({ registerTool: (n: string, _c: unknown, h: any) => void (tools[n] = h) } as any, {
      authorization: "Basic eA=="
    });
    for (const route of EVO_ROUTES) {
      const args = Object.fromEntries(route.params.filter((p) => p.required).map((p) => [p.name, p.type === "string" ? "x" : 1]));
      await tools[route.tool](args);
    }
    expect(methods.length).toBe(EVO_ROUTES.length);
    expect(new Set(methods)).toEqual(new Set(["GET"]));
  });
});

describe("a unidade é a da academia", () => {
  const members = EVO_ROUTES.find((r) => r.tool === "evo_v2_members")!;

  it("idBranch vem do cadastro, mesmo que o modelo mande outro", () => {
    const url = buildEvoUrl(members, { idBranch: 999, take: 10 }, { authorization: "x", idBranch: 7 }) as string;
    expect(new URL(url).searchParams.get("idBranch")).toBe("7");
  });

  it("idBranch não é anunciado ao modelo quando a academia tem unidade", async () => {
    const text = await (await handleGestaoInternal(rpc("tools/list", {}), await seeded(7), ctx)).text();
    const list = JSON.parse(text.split("data: ")[1]) as { result: { tools: { name: string; inputSchema: any }[] } };
    const tool = list.result.tools.find((t) => t.name === "evo_v2_members")!;
    expect(Object.keys(tool.inputSchema.properties)).not.toContain("idBranch");
  });

  it("parâmetro de caminho é codificado (não vira outra rota)", () => {
    const byId = EVO_ROUTES.find((r) => r.path === "/api/v2/members/{idMember}")!;
    const url = buildEvoUrl(byId, { idMember: "1/../../v1/configuration" }, { authorization: "x" }) as string;
    expect(new URL(url).pathname).toBe("/api/v2/members/1%2F..%2F..%2Fv1%2Fconfiguration");
  });

  it("obrigatório ausente: recusa sem chamar a EVO", () => {
    const byId = EVO_ROUTES.find((r) => r.path === "/api/v2/members/{idMember}")!;
    expect(buildEvoUrl(byId, {}, { authorization: "x" })).toEqual({ error: expect.stringContaining("idMember") });
  });
});

describe("máscara de dado pessoal", () => {
  it("aluno: nome em iniciais, contato e documento pelos 2 últimos, endereço e foto fora, nascimento só o ano", () => {
    const out = maskPersonalData({
      idMember: 10,
      firstName: "Maria",
      lastName: "da Silva",
      document: "123.456.789-01",
      email: "maria@exemplo.com",
      cellphone: "11987654321",
      birthDate: "1990-05-20T00:00:00",
      address: "Rua A, 1",
      zipCode: "01001000",
      photoUrl: "https://foto",
      gender: "F",
      contacts: [{ idPhone: 1, contactType: "Celular", description: "11987654321" }],
      memberships: [{ idMembership: 3, name: "Plano Black", value: 99.9 }]
    }) as any;
    expect(out.firstName).toBe("M.");
    expect(out.lastName).toBe("D. S.");
    expect(out.document).toBe("***01");
    expect(out.email).toBe("***om");
    expect(out.cellphone).toBe("***21");
    expect(out.birthDate).toBe("1990-**-**");
    expect(out.address).toBe("[removido]");
    expect(out.zipCode).toBe("[removido]");
    expect(out.photoUrl).toBe("[removido]");
    expect(out.gender).toBe("F");
    expect(out.contacts[0]).toEqual({ idPhone: 1, contactType: "Celular", description: "***21" });
    expect(out.memberships[0].name).toBe("Plano Black");
    expect(JSON.stringify(out)).not.toMatch(/Maria|Silva|456|maria@|987654/);
  });

  it("`name` de pessoa vira iniciais; `name` de plano, aula ou unidade fica", () => {
    expect((maskPersonalData({ idProspect: 1, name: "João Pedro" }) as any).name).toBe("J. P.");
    expect((maskPersonalData({ idActivity: 1, name: "Spinning" }) as any).name).toBe("Spinning");
    expect((maskPersonalData({ idMember: null, name: "Plano X" }) as any).name).toBe("Plano X");
  });

  it("nome de funcionário em campo próprio segue legível; token some", () => {
    const out = maskPersonalData({ nameEmployeeSale: "Carlos Vendedor", tokenGympass: "abc", nameMember: "Ana Lima" }) as any;
    expect(out).toEqual({ nameEmployeeSale: "Carlos Vendedor", tokenGympass: "[removido]", nameMember: "A. L." });
  });
});

describe("chamada de ponta a ponta", () => {
  it("resposta da EVO sai mascarada", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify([{ idMember: 1, firstName: "Maria", lastName: "Souza", document: "12345678901" }]))
    );
    const res = await handleGestaoInternal(
      rpc("tools/call", { name: "evo_v2_members", arguments: { take: 5 } }),
      await seeded(7),
      ctx
    );
    const text = await res.text();
    expect(text).toContain("M.");
    expect(text).not.toContain("Maria");
    expect(text).not.toContain("12345678901");
  });

  it("erro da EVO não ecoa o corpo (que pode trazer dado de aluno)", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ msg: "Maria Souza CPF 12345678901" }), { status: 400 }));
    const text = await (
      await handleGestaoInternal(rpc("tools/call", { name: "evo_v2_members", arguments: {} }), await seeded(), ctx)
    ).text();
    expect(text).toContain("400");
    expect(text).not.toContain("Maria");
  });
});

describe("teto da resposta", () => {
  it("lista grande é cortada em itens, com aviso", () => {
    const big = Array.from({ length: 5000 }, (_, i) => ({ id: i, descricao: "x".repeat(50) }));
    const out = capOutput(big) as { aviso: string; itens: unknown[] };
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS);
    expect(out.itens.length).toBeGreaterThan(0);
    expect(out.aviso).toContain("take/skip");
  });

  it("resposta pequena passa intacta", () => {
    expect(capOutput([{ a: 1 }])).toEqual([{ a: 1 }]);
  });
});
