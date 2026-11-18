import { describe, it, expect } from "vitest";
import worker from "../src/server";
import { handleGestaoInternal } from "../src/owner/gestaoInternal";
import { hashToken } from "../src/tenant/store";
import { buildEvoManifest } from "../src/tenant/presets/evo";

// ---------------------------------------------------------------------------
// GestaoGateway: a gestão pelo token da academia, só pela ligação interna.
//
// Ordem do risco: (1) o token da academia, vindo da INTERNET, não pode abrir a
// gestão — o fetch público não tem caminho até ela; (2) pela ligação interna, o
// token resolve UM tenant e só ele; (3) o que se anuncia é a gestão + vitrine,
// nunca as consultas do aluno.
// ---------------------------------------------------------------------------

const ctx = {} as ExecutionContext;
const TOKEN_A = "token-da-academia-a-0123456789";
const TOKEN_B = "token-da-academia-b-0123456789";

const fakeKv = (data = new Map<string, string>()) => ({
  data,
  get: async (k: string, t?: string) => {
    const v = data.get(k);
    return v === undefined ? null : t === "json" ? JSON.parse(v) : v;
  },
  put: async (k: string, v: string) => void data.set(k, v),
  delete: async (k: string) => void data.delete(k)
});

async function seeded() {
  const kv = fakeKv();
  for (const [id, label, token] of [
    ["tnt_a", "Unidade A", TOKEN_A],
    ["tnt_b", "Unidade B", TOKEN_B]
  ] as const) {
    const built = buildEvoManifest({ tenantId: id, label, dns: id.replace("_", ""), secretKey: `segredo-${id}` });
    if (!built.ok) throw new Error(built.error);
    kv.data.set(`tenant-manifest:${id}`, JSON.stringify(built.manifest));
    kv.data.set(`tenant-token:${await hashToken(token)}`, id);
  }
  return { TENANT_MANIFESTS: kv } as unknown as Env;
}

const rpc = (method: string, params: Record<string, unknown>) => (token: string | null, path = "/mcp/gestao") =>
  new Request(`https://mcp-social.internal${path}`, {
    method: "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
const listTools = rpc("tools/list", {});
const initialize = rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "teste", version: "0" }
});

describe("da internet, o token da academia NÃO abre a gestão", () => {
  it("/mcp/gestao no fetch público não é a gestão", async () => {
    const res = await worker.fetch!(listTools(TOKEN_A) as any, await seeded(), ctx);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("evo_gestao_");
  });

  it("/mcp/gestao/<tenantId> no fetch público continua exigindo o Access, mesmo com o token", async () => {
    const res = await worker.fetch!(listTools(TOKEN_A, "/mcp/gestao/tnt_a") as any, await seeded(), ctx);
    expect([401, 503]).toContain(res.status);
    expect(await res.text()).not.toContain("evo_gestao_");
  });

  it("/mcp/tenant com o mesmo token segue sendo só o agente, sem gestão", async () => {
    const res = await worker.fetch!(listTools(TOKEN_A, "/mcp/tenant") as any, await seeded(), ctx);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain("evo_gestao_");
  });
});

describe("pela ligação interna (GestaoGateway)", () => {
  it("token da academia: anuncia a gestão e a vitrine, e NUNCA as consultas do aluno", async () => {
    const res = await handleGestaoInternal(listTools(TOKEN_A), await seeded(), ctx);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain("evo_gestao_vendas");
    expect(text).toContain("evo_planos_e_precos");
    expect(text).not.toContain("evo_meu_plano");
    expect(text).not.toContain("evo_minhas_cobrancas");
  });

  it("o token resolve a SUA academia, e não outra", async () => {
    const env = await seeded();
    const a = await (await handleGestaoInternal(initialize(TOKEN_A), env, ctx)).text();
    const b = await (await handleGestaoInternal(initialize(TOKEN_B), env, ctx)).text();
    expect(a).toContain("Gestão da academia — Unidade A");
    expect(a).not.toContain("Unidade B");
    expect(b).toContain("Gestão da academia — Unidade B");
    expect(b).not.toContain("Unidade A");
  });

  it.each([
    ["sem token", null, 401],
    ["token desconhecido", "token-que-ninguem-cadastrou-123", 401]
  ])("%s: %i, sem anunciar ferramenta", async (_label, token, status) => {
    const res = await handleGestaoInternal(listTools(token), await seeded(), ctx);
    expect(res.status).toBe(status);
    expect(await res.text()).not.toContain("evo_gestao_");
  });

  it("academia sem EVO: 404", async () => {
    const kv = fakeKv();
    kv.data.set(`tenant-token:${await hashToken(TOKEN_A)}`, "tnt_a");
    kv.data.set(
      "tenant-manifest:tnt_a",
      JSON.stringify({ tenantId: "tnt_a", label: "Sem EVO", baseUrl: "https://api.exemplo.test", tools: [] })
    );
    const res = await handleGestaoInternal(listTools(TOKEN_A), { TENANT_MANIFESTS: kv } as unknown as Env, ctx);
    expect([404, 500]).toContain(res.status);
    expect(await res.text()).not.toContain("evo_gestao_");
  });

  it("sem KV: 503 — ausência de configuração nunca libera", async () => {
    const res = await handleGestaoInternal(listTools(TOKEN_A), {} as Env, ctx);
    expect(res.status).toBe(503);
  });

  it("outro caminho na entrypoint: 404", async () => {
    const res = await handleGestaoInternal(listTools(TOKEN_A, "/mcp/tenant"), await seeded(), ctx);
    expect(res.status).toBe(404);
  });
});
