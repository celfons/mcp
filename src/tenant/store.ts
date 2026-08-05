import { parseManifest, type TenantManifest } from "./manifest";

/**
 * De onde vem o manifesto, e como se sabe QUEM está chamando.
 *
 * Este é o arquivo onde mora o isolamento entre tenants — e é a
 * responsabilidade que o gateway assume ao existir fora da plataforma. Lá, o
 * `INV-TENANT-SCOPE` cobre toda query e há guard estrutural cobrando; aqui não
 * há nada disso, então a regra é reduzida a uma frase e defendida por um teste:
 *
 *   O token da requisição resolve UM tenant, e as ferramentas montadas naquela
 *   requisição saem do manifesto DAQUELE tenant. Não existe caminho que leia
 *   manifesto de outro, e não existe listagem.
 *
 * O índice é `tenant-token:<sha-256 do token>` → tenantId. Guardar o hash, e não
 * o token, é o que faz um dump do KV não virar um chaveiro: quem lê o índice
 * não consegue se passar por ninguém.
 */

const TOKEN_PREFIX = "tenant-token:";
const MANIFEST_PREFIX = "tenant-manifest:";

export type ResolvedTenant = { tenantId: string; manifest: TenantManifest };

export type ResolveFailure =
  | "no_store"
  | "no_token"
  | "unknown_token"
  | "no_manifest"
  | "invalid_manifest";

export type ResolveResult =
  | { ok: true; tenant: ResolvedTenant }
  | { ok: false; reason: ResolveFailure; detail?: string };

/** O KV onde índice e manifestos moram. Ausente = o endpoint por tenant fica inerte. */
function store(env: Env): KVNamespace | null {
  const kv = (env as Record<string, unknown>).TENANT_MANIFESTS;
  return kv && typeof (kv as KVNamespace).get === "function" ? (kv as KVNamespace) : null;
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Lê o token do `Authorization: Bearer …` — o mesmo header que a plataforma guarda cifrado. */
export function readBearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token && token.length >= 16 ? token : null;
}

/**
 * Resolve o tenant da requisição. Fail-closed em cada passo: sem KV, sem token,
 * token desconhecido, manifesto ausente ou inválido — todos param aqui, e o
 * chamador responde 401 sem anunciar ferramenta nenhuma. Anunciar ferramenta
 * antes de saber de quem ela é seria o mesmo que não ter isolamento.
 */
export async function resolveTenant(request: Request, env: Env): Promise<ResolveResult> {
  const kv = store(env);
  if (!kv) return { ok: false, reason: "no_store" };

  const token = readBearer(request);
  if (!token) return { ok: false, reason: "no_token" };

  const tenantId = await kv.get(`${TOKEN_PREFIX}${await hashToken(token)}`);
  if (!tenantId) return { ok: false, reason: "unknown_token" };

  const raw = await kv.get(`${MANIFEST_PREFIX}${tenantId}`, "json");
  if (!raw) return { ok: false, reason: "no_manifest" };

  const parsed = parseManifest(raw);
  if (!parsed.ok) return { ok: false, reason: "invalid_manifest", detail: parsed.error };

  // O manifesto declara o próprio `tenantId`; se ele divergir da chave sob a qual
  // foi guardado, alguém gravou no lugar errado — e "quase certo" aqui é
  // exatamente como um tenant passa a responder pelo outro.
  if (parsed.manifest.tenantId !== tenantId) {
    return { ok: false, reason: "invalid_manifest", detail: "tenantId do manifesto não casa com a chave" };
  }

  return { ok: true, tenant: { tenantId, manifest: parsed.manifest } };
}
