import { authorize, type AdminResult } from "../tenant/admin";
import { hashToken } from "../tenant/store";

/**
 * Quem pode abrir a gestão de qual academia.
 *
 * `owner-email:<sha-256 do e-mail>` → lista de tenantIds. O e-mail vem do
 * login do Access, já validado; a lista é escrita só pela rota de admin. Sem
 * entrada, nenhuma academia: a ausência nunca libera.
 */
const OWNER_PREFIX = "owner-email:";

function store(env: Env): KVNamespace | null {
  const kv = (env as Record<string, unknown>).TENANT_MANIFESTS;
  return kv && typeof (kv as KVNamespace).get === "function" ? (kv as KVNamespace) : null;
}

const normalize = (email: string): string => email.trim().toLowerCase();

export async function ownerTenants(env: Env, email: string): Promise<string[]> {
  const kv = store(env);
  if (!kv) return [];
  const raw = await kv.get(`${OWNER_PREFIX}${await hashToken(normalize(email))}`, "json");
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * `PUT /admin/tenants/:tenantId/owners` com `{ "emails": [...] }`: estes são,
 * a partir de agora, os donos desta academia. Quem saiu da lista perde o acesso
 * a ela (as outras academias da pessoa ficam como estavam).
 */
export async function putOwners(request: Request, env: Env, tenantId: string): Promise<AdminResult> {
  const denied = authorize(request, env);
  if (denied) return denied;
  const kv = store(env);
  if (!kv) return { status: 503, body: { error: "KV não configurado." } };

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { status: 400, body: { error: "Corpo deve ser JSON." } };
  }
  const emails = (body as { emails?: unknown }).emails;
  const removed = (body as { removeEmails?: unknown }).removeEmails;
  if (!Array.isArray(emails) || emails.some((e) => typeof e !== "string" || !EMAIL_RE.test(e))) {
    return { status: 400, body: { error: "`emails` deve ser uma lista de e-mails." } };
  }
  const toRemove = Array.isArray(removed) ? removed.filter((e): e is string => typeof e === "string") : [];

  for (const email of emails as string[]) {
    const key = `${OWNER_PREFIX}${await hashToken(normalize(email))}`;
    const current = ((await kv.get(key, "json")) as string[] | null) ?? [];
    if (!current.includes(tenantId)) await kv.put(key, JSON.stringify([...current, tenantId]));
  }
  for (const email of toRemove) {
    const key = `${OWNER_PREFIX}${await hashToken(normalize(email))}`;
    const current = ((await kv.get(key, "json")) as string[] | null) ?? [];
    const next = current.filter((t) => t !== tenantId);
    if (next.length) await kv.put(key, JSON.stringify(next));
    else await kv.delete(key);
  }
  return { status: 200, body: { tenantId, owners: (emails as string[]).length, removed: toRemove.length } };
}
