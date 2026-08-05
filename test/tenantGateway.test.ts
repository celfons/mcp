import { describe, it, expect, vi, afterEach } from "vitest";
import { parseManifest } from "../src/tenant/manifest";
import { checkOutboundUrl, safeFetch, OutboundError } from "../src/tenant/safeUrl";
import { project, readPath } from "../src/tenant/project";
import { resolveTenant, hashToken, readBearer } from "../src/tenant/store";
import { runTool, asStringArgs } from "../src/tenant/gateway";

// ---------------------------------------------------------------------------
// O gateway por tenant (celfons/whatsapp#1324).
//
// A ordem dos blocos é a ordem do risco. O primeiro é o ISOLAMENTO: ao viver
// fora da plataforma, este Worker perde o `INV-TENANT-SCOPE` e o guard
// estrutural que o cobra lá — o que sobra é a regra escrita em `store.ts` e
// estes testes. Um erro de escopo aqui cruza clientes, e nenhum teste do
// backend veria.
//
// Depois vêm as três coisas que decidem o que chega ao PROMPT de um agente:
// SSRF (para onde este Worker pode requisitar), projeção (o que da resposta do
// cliente pode viajar) e mensagem de erro (que não pode ecoar o corpo do
// cliente de volta ao modelo).
// ---------------------------------------------------------------------------

const TOKEN_A = "token-do-tenant-a-1234567890";
const TOKEN_B = "token-do-tenant-b-0987654321";

const manifestFor = (tenantId: string, host: string) => ({
  tenantId,
  label: `ERP ${tenantId}`,
  baseUrl: `https://${host}`,
  auth: { type: "bearer", token: `segredo-${tenantId}` },
  tools: [
    {
      name: "consultar_pedido",
      description: "Status do pedido do cliente",
      method: "GET",
      path: "/pedidos/{orderId}",
      scope: "customer",
      identityParam: "telefone",
      params: [
        { name: "orderId", in: "path", required: true },
        { name: "telefone", in: "query", required: true }
      ],
      fields: [
        { path: "status", label: "Status" },
        { path: "previsao", label: "Previsão" }
      ]
    }
  ]
});

/** KV de mentira com as duas famílias de chave que o store usa. */
const fakeKv = (entries: Record<string, unknown>) => ({
  get: async (key: string, type?: string) => {
    const value = entries[key];
    if (value === undefined) return null;
    return type === "json" ? value : (value as string);
  }
});

const request = (token?: string) =>
  new Request("https://gateway.example.test/mcp/tenant", {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });

const envWith = async (tenants: Array<{ id: string; token: string; host: string }>) => {
  const entries: Record<string, unknown> = {};
  for (const t of tenants) {
    entries[`tenant-token:${await hashToken(t.token)}`] = t.id;
    entries[`tenant-manifest:${t.id}`] = manifestFor(t.id, t.host);
  }
  return { TENANT_MANIFESTS: fakeKv(entries) } as unknown as Env;
};

afterEach(() => vi.unstubAllGlobals());

// --- 1 · Isolamento ---------------------------------------------------------

describe("isolamento entre tenants", () => {
  it("o token de um tenant resolve o manifesto DELE, e só dele", async () => {
    const env = await envWith([
      { id: "tnt_a", token: TOKEN_A, host: "api-a.example.test" },
      { id: "tnt_b", token: TOKEN_B, host: "api-b.example.test" }
    ]);

    const a = await resolveTenant(request(TOKEN_A), env);
    const b = await resolveTenant(request(TOKEN_B), env);

    expect(a.ok && a.tenant.tenantId).toBe("tnt_a");
    expect(b.ok && b.tenant.tenantId).toBe("tnt_b");
    // O que mais importa: a credencial e a base de um NÃO aparecem para o outro.
    expect(a.ok && a.tenant.manifest.baseUrl).toBe("https://api-a.example.test");
    expect(a.ok && JSON.stringify(a.tenant.manifest)).not.toContain("tnt_b");
    expect(b.ok && JSON.stringify(b.tenant.manifest)).not.toContain("segredo-tnt_a");
  });

  it("falha fechado em cada passo, sem anunciar ferramenta nenhuma", async () => {
    const env = await envWith([{ id: "tnt_a", token: TOKEN_A, host: "api-a.example.test" }]);

    expect((await resolveTenant(request(), env)).ok).toBe(false);
    expect((await resolveTenant(request("token-desconhecido-000000"), env)).ok).toBe(false);
    // Sem KV o endpoint fica inerte em vez de improvisar.
    expect((await resolveTenant(request(TOKEN_A), {} as Env)).ok).toBe(false);
  });

  it("recusa manifesto cujo tenantId não casa com a chave sob a qual foi guardado", async () => {
    const env = {
      TENANT_MANIFESTS: fakeKv({
        [`tenant-token:${await hashToken(TOKEN_A)}`]: "tnt_a",
        // Gravado na chave de A, mas declarando ser B: é assim que um tenant
        // passa a responder pelo outro.
        "tenant-manifest:tnt_a": manifestFor("tnt_b", "api-b.example.test")
      })
    } as unknown as Env;

    const result = await resolveTenant(request(TOKEN_A), env);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe("invalid_manifest");
  });

  it("guarda o HASH do token, nunca o token", async () => {
    const digest = await hashToken(TOKEN_A);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(TOKEN_A);
  });

  it("ignora Authorization malformado ou curto demais", () => {
    expect(readBearer(new Request("https://x.test", { headers: { Authorization: "Basic abc" } }))).toBeNull();
    expect(readBearer(new Request("https://x.test", { headers: { Authorization: "Bearer curto" } }))).toBeNull();
    expect(readBearer(request(TOKEN_A))).toBe(TOKEN_A);
  });
});

// --- 2 · Manifesto ----------------------------------------------------------

describe("manifesto", () => {
  it("aceita um manifesto completo", () => {
    expect(parseManifest(manifestFor("tnt_a", "api.example.test")).ok).toBe(true);
  });

  it("exige que a ferramenta customer DECLARE o parâmetro de identidade", () => {
    // O backend recusa (`identityParam_missing`) a ferramenta que não o declara
    // no inputSchema: sem esta regra, anunciaríamos algo nunca chamável.
    const bad = manifestFor("tnt_a", "api.example.test");
    bad.tools[0].params = [{ name: "orderId", in: "path", required: true }];
    const result = parseManifest(bad);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/identityParam/);
  });

  it("recusa escopo business com parâmetro de identidade", () => {
    const bad = manifestFor("tnt_a", "api.example.test");
    bad.tools[0].scope = "business";
    expect(parseManifest(bad).ok).toBe(false);
  });

  it("recusa placeholder no path sem parâmetro correspondente", () => {
    const bad = manifestFor("tnt_a", "api.example.test");
    bad.tools[0].path = "/pedidos/{orderId}/{itemId}";
    const result = parseManifest(bad);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/itemId/);
  });

  it("recusa ferramenta sem campos declarados — seria devolver o JSON cru", () => {
    const bad = manifestFor("tnt_a", "api.example.test");
    bad.tools[0].fields = [];
    expect(parseManifest(bad).ok).toBe(false);
  });
});

// --- 3 · SSRF ---------------------------------------------------------------

describe("destino da chamada", () => {
  it("aceita https público e recusa o resto", () => {
    expect(checkOutboundUrl("https://api.cliente.com/pedidos").ok).toBe(true);
    for (const bad of [
      "http://api.cliente.com",
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://169.254.169.254/latest/meta-data",
      "https://10.0.0.5/x",
      "https://192.168.1.10/x",
      "https://172.16.0.9/x",
      "https://[::1]/x",
      "https://algo.internal/x",
      "file:///etc/passwd"
    ]) {
      expect(checkOutboundUrl(bad).ok, `${bad} deveria ser recusado`).toBe(false);
    }
  });

  it("não segue redirecionamento — seguir devolveria a escolha do destino ao outro lado", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 302 })));
    await expect(
      safeFetch("https://api.cliente.com/x", { method: "GET", headers: {}, timeoutMs: 1000 })
    ).rejects.toBeInstanceOf(OutboundError);
  });

  it("não devolve o corpo do erro do cliente — ele iria para o prompt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ erro: "cpf 123.456.789-00 não encontrado" }), { status: 500 }))
    );
    await expect(
      safeFetch("https://api.cliente.com/x", { method: "GET", headers: {}, timeoutMs: 1000 })
    ).rejects.toThrow(/respondeu 500$/);
  });

  it("corta resposta acima do teto de bytes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(5000), { status: 200 })));
    await expect(
      safeFetch("https://api.cliente.com/x", { method: "GET", headers: {}, timeoutMs: 1000, maxBytes: 1000 })
    ).rejects.toThrow(/grande demais/);
  });
});

// --- 4 · Projeção -----------------------------------------------------------

describe("projeção de campos", () => {
  it("lê caminho com ponto e índice", () => {
    const payload = { pedido: { itens: [{ nome: "Creatina" }] } };
    expect(readPath(payload, "pedido.itens[0].nome")).toBe("Creatina");
    expect(readPath(payload, "pedido.itens[9].nome")).toBeUndefined();
    expect(readPath(payload, "nada.aqui")).toBeUndefined();
  });

  it("leva SÓ o que foi declarado", () => {
    const payload = { status: "enviado", custo_interno: 12.5, margem: 0.4, cliente_cpf: "123" };
    const { text } = project(payload, [{ path: "status", label: "Status" }], 500);
    expect(text).toBe("Status: enviado");
    expect(text).not.toContain("12.5");
    expect(text).not.toContain("123");
  });

  it("não serializa objeto nem array — apontar para estrutura é cadastro errado", () => {
    const { text, missing } = project({ itens: [{ nome: "x" }] }, [{ path: "itens", label: "Itens" }], 500);
    expect(text).toBe("");
    expect(missing).toEqual(["itens"]);
  });

  it("corta em linha inteira, nunca no meio de um valor", () => {
    const payload = { a: "1234567890", b: "valor-que-nao-cabe" };
    const { text, truncated } = project(
      payload,
      [
        { path: "a", label: "A" },
        { path: "b", label: "B" }
      ],
      14
    );
    expect(text).toBe("A: 1234567890");
    expect(truncated).toBe(true);
    // O corte é entre linhas: nenhum valor aparece pela metade.
    expect(text.split("\n").every((line) => /^[^:]+: .+$/.test(line))).toBe(true);
  });
});

// --- 5 · Execução -----------------------------------------------------------

describe("execução da ferramenta", () => {
  const manifest = parseManifest(manifestFor("tnt_a", "api.cliente.com"));
  const tool = manifest.ok ? manifest.manifest.tools[0] : null;

  it("monta path, query e credencial, e devolve os campos projetados", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: "enviado", previsao: "amanhã", custo: 9 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTool(manifest.ok ? manifest.manifest : ({} as never), tool!, {
      orderId: "4471",
      telefone: "5511999"
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.cliente.com/pedidos/4471?telefone=5511999");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer segredo-tnt_a");
    expect(init.redirect).toBe("manual");
    expect(result.content[0].text).toBe("Status: enviado\nPrevisão: amanhã");
    expect(result.content[0].text).not.toContain("custo");
  });

  it("recusa antes de chamar quando falta parâmetro obrigatório", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await runTool(manifest.ok ? manifest.manifest : ({} as never), tool!, { orderId: "4471" });
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("responde em texto quando a API do cliente falha — o turno segue sem o bloco", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    const result = await runTool(manifest.ok ? manifest.manifest : ({} as never), tool!, {
      orderId: "1",
      telefone: "5511"
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/503/);
  });

  it("diz que não achou em vez de devolver vazio", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ outra_coisa: 1 }), { status: 200 })));
    const result = await runTool(manifest.ok ? manifest.manifest : ({} as never), tool!, {
      orderId: "1",
      telefone: "5511"
    });
    expect(result.content[0].text).toMatch(/Nenhum dado encontrado/);
  });

  it("descarta argumento que não é escalar", () => {
    expect(asStringArgs({ a: "x", b: 2, c: true, d: { nested: 1 }, e: ["x"] })).toEqual({
      a: "x",
      b: "2",
      c: "true"
    });
  });
});
