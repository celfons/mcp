import { describe, it, expect, vi, afterEach } from "vitest";
import worker from "../src/server";
import { handleGestaoInternal } from "../src/owner/gestaoInternal";
import {
  buildInsightsQuery,
  fetchAllPages,
  isGraphUrl,
  normalizeAccountId,
  registerMetaAdsTools,
  shapeInsightRow,
  type MetaAdsScope
} from "../src/social/meta-ads";
import { putTenantMetaAds, getTenantMetaAdsAdmin, deleteTenantMetaAds } from "../src/tenant/metaAds";
import { hashToken } from "../src/tenant/store";
import { buildEvoManifest } from "../src/tenant/presets/evo";

// ---------------------------------------------------------------------------
// Meta Ads, só leitura. Ordem do risco: (1) no modo da ACADEMIA, toda chamada
// sai sob a conta dela, com o token dela — nunca a do Worker, nunca outra conta;
// (2) o cadastro valida o token e nunca devolve o token; (3) as ferramentas só
// aparecem na gestão de quem cadastrou, e nunca no agente (/mcp/tenant).
// ---------------------------------------------------------------------------

const ctx = {} as ExecutionContext;
const ADMIN = "admin-token-1234567890";
const TENANT_TOKEN = "token-da-academia-a-0123456789";
const META_TOKEN = "EAAB-token-da-academia-0123456789";
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

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
function capture(env: Env, scope?: MetaAdsScope) {
  const tools: Record<string, Handler> = {};
  registerMetaAdsTools({ registerTool: (n: string, _c: unknown, h: Handler) => void (tools[n] = h) } as never, env, scope);
  return tools;
}

/** Graph de mentira: grava as URLs e responde uma página. */
function stubGraph(body: unknown = { data: [] }) {
  const urls: URL[] = [];
  vi.stubGlobal("fetch", async (input: string) => {
    urls.push(new URL(input));
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  });
  return urls;
}

describe("conta e consulta", () => {
  it("normaliza a conta e recusa o resto", () => {
    expect(normalizeAccountId({} as Env, "123")).toBe("act_123");
    expect(normalizeAccountId({} as Env, "act_123")).toBe("act_123");
    expect(normalizeAccountId({ META_AD_ACCOUNT_ID: "999" } as Env)).toBe("act_999");
    expect(() => normalizeAccountId({} as Env, "act_12/../me")).toThrow();
    expect(() => normalizeAccountId({} as Env)).toThrow(/META_AD_ACCOUNT_ID/);
  });

  it("período: padrão last_30d; since/until juntos e em ordem", () => {
    expect(buildInsightsQuery({})).toMatchObject({ date_preset: "last_30d", level: "campaign" });
    expect(buildInsightsQuery({ since: "2026-10-01", until: "2026-10-31", timeIncrement: "1" })).toMatchObject({
      time_range: JSON.stringify({ since: "2026-10-01", until: "2026-10-31" }),
      time_increment: "1"
    });
    expect(buildInsightsQuery({ since: "2026-10-01" })).toHaveProperty("error");
    expect(buildInsightsQuery({ since: "2026-11-01", until: "2026-10-01" })).toHaveProperty("error");
    expect(buildInsightsQuery({ campaignIds: ["1", "x;drop"] })).toHaveProperty("error");
  });

  it("linha de insight: números como número e resultados-chave com custo", () => {
    const row = shapeInsightRow({
      spend: "150.50",
      impressions: "10000",
      actions: [
        { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "30" },
        { action_type: "lead", value: "5" }
      ],
      cost_per_action_type: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "5.01" }]
    });
    expect(row.spend).toBe(150.5);
    expect(row.resultados).toEqual({ conversas_iniciadas: { quantidade: 30, custo: 5.01 }, leads: { quantidade: 5 } });
  });

  it("paginação: segue só a Graph API e para no teto", async () => {
    expect(isGraphUrl("https://graph.facebook.com/v21.0/x?after=1")).toBe(true);
    expect(isGraphUrl("https://evil.example/next")).toBe(false);
    let n = 0;
    vi.stubGlobal("fetch", async () => {
      n += 1;
      return new Response(JSON.stringify({ data: [n], paging: { next: "https://graph.facebook.com/v21.0/next?p=" + n } }));
    });
    const out = await fetchAllPages("https://graph.facebook.com/v21.0/act_1/campaigns", {}, 3);
    expect(out).toEqual({ rows: [1, 2, 3], truncated: true });

    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ data: [1], paging: { next: "https://evil.example/x" } })));
    expect(await fetchAllPages("https://graph.facebook.com/v21.0/act_1/campaigns", {})).toEqual({ rows: [1], truncated: false });
  });
});

describe("modo da academia: presa à conta e ao token dela", () => {
  const env = { META_ADS_ACCESS_TOKEN: "token-do-worker-nao-pode-sair" } as unknown as Env;
  const scope: MetaAdsScope = { kind: "tenant", accessToken: META_TOKEN, adAccountId: "act_111" };

  it("insights saem sob act_111 com o token da academia, nunca o do Worker", async () => {
    const urls = stubGraph({ data: [{ spend: "10" }] });
    const res = await capture(env, scope).meta_ads_insights({});
    expect(res.isError).toBeFalsy();
    expect(urls[0].pathname).toMatch(/\/act_111\/insights$/);
    expect(urls[0].searchParams.get("access_token")).toBe(META_TOKEN);
  });

  it("outra conta, ou objeto solto por id: recusado sem chamar a Meta", async () => {
    const urls = stubGraph();
    const tools = capture(env, scope);
    expect((await tools.meta_ads_insights({ objectId: "act_222" })).isError).toBe(true);
    expect((await tools.meta_ads_insights({ objectId: "123456" })).isError).toBe(true);
    expect((await tools.meta_ads_list_campaigns({ accountId: "act_222" })).isError).toBe(true);
    expect(urls).toHaveLength(0);
  });

  it("conjuntos de uma campanha: listados sob a conta, com a campanha como filtro", async () => {
    const urls = stubGraph();
    await capture(env, scope).meta_ads_list_adsets({ campaignId: "555" });
    expect(urls[0].pathname).toMatch(/\/act_111\/adsets$/);
    expect(JSON.parse(urls[0].searchParams.get("filtering")!)).toEqual([{ field: "campaign.id", operator: "IN", value: ["555"] }]);
  });

  it("modo global: o token do Worker e o pai mais específico", async () => {
    const urls = stubGraph();
    await capture(env).meta_ads_list_adsets({ campaignId: "555" });
    expect(urls[0].pathname).toMatch(/\/555\/adsets$/);
    expect(urls[0].searchParams.get("access_token")).toBe("token-do-worker-nao-pode-sair");
  });
});

describe("cadastro por academia (admin)", () => {
  const req = (method: string, body?: unknown, auth = ADMIN) =>
    new Request("https://gw.test/admin/tenants/ctrc/meta-ads", {
      method,
      headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  const envWith = (kv = fakeKv()) => ({ TENANT_MANIFESTS: kv, ADMIN_TOKEN: ADMIN }) as unknown as Env;
  const metaOk = vi.fn(async () => new Response(JSON.stringify({ id: "act_111", name: "CTRC Ads", currency: "BRL" })));

  it("exige o token de admin", async () => {
    const res = await putTenantMetaAds(req("PUT", { accessToken: META_TOKEN, adAccountId: "111" }, "errado-errado-errado"), envWith(), "ctrc", metaOk);
    expect(res.status).toBe(401);
  });

  it("valida na Meta, grava, e o GET nunca devolve o token", async () => {
    const kv = fakeKv();
    const put = await putTenantMetaAds(req("PUT", { accessToken: META_TOKEN, adAccountId: "111" }), envWith(kv), "ctrc", metaOk);
    expect(put).toEqual({ status: 200, body: { tenantId: "ctrc", adAccountId: "act_111", accountName: "CTRC Ads", currency: "BRL" } });
    const got = await getTenantMetaAdsAdmin(req("GET"), envWith(kv), "ctrc");
    expect(got.status).toBe(200);
    expect(JSON.stringify(got.body)).not.toContain(META_TOKEN);
    expect((await deleteTenantMetaAds(req("DELETE"), envWith(kv), "ctrc")).status).toBe(200);
    expect(kv.data.has("tenant-meta-ads:ctrc")).toBe(false);
  });

  it("token que a Meta recusa não é gravado", async () => {
    const kv = fakeKv();
    const refused = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid OAuth access token." } }), { status: 400 }));
    const res = await putTenantMetaAds(req("PUT", { accessToken: META_TOKEN, adAccountId: "111" }), envWith(kv), "ctrc", refused);
    expect(res.status).toBe(400);
    expect(kv.data.size).toBe(0);
  });
});

describe("quem recebe as ferramentas", () => {
  async function seeded(withMeta: boolean) {
    const kv = fakeKv();
    const built = buildEvoManifest({ tenantId: "ctrc", label: "CTRC", dns: "ctrc", secretKey: "s" });
    if (!built.ok) throw new Error(built.error);
    kv.data.set("tenant-manifest:ctrc", JSON.stringify(built.manifest));
    kv.data.set(`tenant-token:${await hashToken(TENANT_TOKEN)}`, "ctrc");
    if (withMeta) {
      kv.data.set(
        "tenant-meta-ads:ctrc",
        JSON.stringify({ accessToken: META_TOKEN, adAccountId: "act_111", updatedAt: "2026-11-18T00:00:00Z" })
      );
    }
    return { TENANT_MANIFESTS: kv } as unknown as Env;
  }
  const list = (path: string) =>
    new Request(`https://gw.test${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TENANT_TOKEN}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    });

  it("gestão com Meta cadastrada: EVO e Meta juntas", async () => {
    const text = await (await handleGestaoInternal(list("/mcp/gestao"), await seeded(true), ctx)).text();
    expect(text).toContain("evo_gestao_vendas");
    expect(text).toContain("meta_ads_insights");
  });

  it("gestão sem Meta cadastrada: sem as ferramentas da Meta (nem com o token global do Worker)", async () => {
    const env = Object.assign(await seeded(false), { META_ADS_ACCESS_TOKEN: "token-do-worker" });
    const text = await (await handleGestaoInternal(list("/mcp/gestao"), env, ctx)).text();
    expect(text).not.toContain("meta_ads_");
  });

  it("o agente (/mcp/tenant) nunca as recebe", async () => {
    const text = await (await worker.fetch!(list("/mcp/tenant") as never, await seeded(true), ctx)).text();
    expect(text).not.toContain("meta_ads_");
  });
});
