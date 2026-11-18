import { GRAPH_BASE, graphVersion } from "../social/shared";
import { normalizeAccountId, type MetaAdsScope } from "../social/meta-ads";
import { authorize, type AdminResult } from "./admin";

/**
 * As credenciais da Meta Ads de UMA academia, para a gestão (`/mcp/gestao/...`).
 *
 * `tenant-meta-ads:<tenantId>` → { accessToken, adAccountId, accountName, updatedAt }. Mesmo KV e
 * mesma disciplina da EVO: escrita só pela rota de admin, lida só para o tenant já identificado.
 * O token nunca volta numa resposta.
 */
const PREFIX = "tenant-meta-ads:";

export type TenantMetaAds = {
  accessToken: string;
  adAccountId: string;
  accountName?: string;
  currency?: string;
  updatedAt: string;
};

function store(env: Env): KVNamespace | null {
  const kv = (env as Record<string, unknown>).TENANT_MANIFESTS;
  return kv && typeof (kv as KVNamespace).get === "function" ? (kv as KVNamespace) : null;
}

export async function getTenantMetaAds(env: Env, tenantId: string): Promise<TenantMetaAds | null> {
  const kv = store(env);
  if (!kv) return null;
  const raw = (await kv.get(`${PREFIX}${tenantId}`, "json")) as Partial<TenantMetaAds> | null;
  if (!raw || typeof raw.accessToken !== "string" || typeof raw.adAccountId !== "string") return null;
  return raw as TenantMetaAds;
}

export function metaAdsScopeOf(config: TenantMetaAds | null): MetaAdsScope | null {
  return config ? { kind: "tenant", accessToken: config.accessToken, adAccountId: config.adAccountId } : null;
}

const json = (status: number, body: Record<string, unknown>): AdminResult => ({ status, body });

/**
 * `PUT /admin/tenants/:tenantId/meta-ads` com `{ "accessToken": "...", "adAccountId": "act_123" }`.
 * Antes de gravar, o token é testado contra a conta: credencial que não lê a conta é recusada
 * aqui, e não descoberta pelo dono no meio de uma pergunta.
 */
export async function putTenantMetaAds(
  request: Request,
  env: Env,
  tenantId: string,
  fetcher: typeof fetch = fetch
): Promise<AdminResult> {
  const denied = authorize(request, env);
  if (denied) return denied;
  const kv = store(env);
  if (!kv) return json(503, { error: "KV não configurado." });

  let body: { accessToken?: unknown; adAccountId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: "Corpo deve ser JSON." });
  }
  const accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
  if (accessToken.length < 20) return json(400, { error: "accessToken (com ads_read) é obrigatório." });
  let adAccountId: string;
  try {
    adAccountId = normalizeAccountId(env, typeof body.adAccountId === "string" ? body.adAccountId : "");
  } catch {
    return json(400, { error: "adAccountId inválido (use act_123 ou 123)." });
  }

  const url = new URL(`${GRAPH_BASE}/${graphVersion(env)}/${adAccountId}`);
  url.searchParams.set("fields", "id,name,currency,account_status");
  url.searchParams.set("access_token", accessToken);
  let account: { id?: string; name?: string; currency?: string; error?: { message?: string } };
  try {
    const res = await fetcher(url.toString(), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    account = (await res.json()) as typeof account;
    if (!res.ok || account.error) {
      return json(400, { error: `A Meta recusou o token para ${adAccountId}: ${account.error?.message ?? res.status}` });
    }
  } catch {
    return json(502, { error: "Não foi possível falar com a Meta para validar o token." });
  }

  const record: TenantMetaAds = {
    accessToken,
    adAccountId,
    ...(account.name ? { accountName: account.name } : {}),
    ...(account.currency ? { currency: account.currency } : {}),
    updatedAt: new Date().toISOString()
  };
  await kv.put(`${PREFIX}${tenantId}`, JSON.stringify(record));
  return json(200, { tenantId, adAccountId, accountName: account.name ?? null, currency: account.currency ?? null });
}

/** `GET` — o que está cadastrado, sem o token. */
export async function getTenantMetaAdsAdmin(request: Request, env: Env, tenantId: string): Promise<AdminResult> {
  const denied = authorize(request, env);
  if (denied) return denied;
  const config = await getTenantMetaAds(env, tenantId);
  if (!config) return json(404, { error: "Nenhuma conta da Meta cadastrada para este tenant." });
  return json(200, {
    tenantId,
    adAccountId: config.adAccountId,
    accountName: config.accountName ?? null,
    currency: config.currency ?? null,
    updatedAt: config.updatedAt
  });
}

/** `DELETE` — a gestão da academia deixa de ter as ferramentas da Meta. */
export async function deleteTenantMetaAds(request: Request, env: Env, tenantId: string): Promise<AdminResult> {
  const denied = authorize(request, env);
  if (denied) return denied;
  const kv = store(env);
  if (!kv) return json(503, { error: "KV não configurado." });
  await kv.delete(`${PREFIX}${tenantId}`);
  return json(200, { tenantId, removed: true });
}
