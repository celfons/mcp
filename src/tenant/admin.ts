import { parseManifest } from "./manifest";
import { hashToken } from "./store";

/**
 * A rota de administração dos manifestos.
 *
 * Ela existe por uma razão estreita: até agora, gravar um manifesto era colar
 * JSON num painel ou num `wrangler kv key put`. O `parseManifest` — que recusa
 * manifesto inválido INTEIRO — só rodava na LEITURA, o que significa que um JSON
 * quebrado era aceito na gravação sem uma palavra, e a falha aparecia depois,
 * como um agente que responde sem o dado. Validar no caminho da escrita move o
 * erro para onde alguém está olhando.
 *
 * As DUAS chaves são gravadas aqui (manifesto + índice do token) porque elas só
 * fazem sentido juntas: um manifesto sem índice é inalcançável, e um índice sem
 * manifesto é um 404 com token válido. O KV não tem transação, então a ordem é
 * deliberada — manifesto primeiro, índice depois. Se a segunda escrita falhar,
 * sobra um manifesto órfão (inerte, ninguém o alcança) em vez de um token que
 * aponta para o vazio.
 *
 * Autenticação: um segredo (`ADMIN_TOKEN`) comparado em tempo constante. Sem o
 * segredo configurado, a rota inteira responde 503 — ausência de credencial
 * nunca vira "aberto".
 */

const MANIFEST_PREFIX = "tenant-manifest:";
const TOKEN_PREFIX = "tenant-token:";

export type AdminResult = { status: number; body: Record<string, unknown> };

const json = (status: number, body: Record<string, unknown>): AdminResult => ({ status, body });

/** Comparação em tempo constante — um `===` vaza o prefixo correto pelo tempo. */
export function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorize(request: Request, env: Env): AdminResult | null {
  const expected = (env as Record<string, unknown>).ADMIN_TOKEN;
  if (typeof expected !== "string" || expected.length < 16) {
    return json(503, { error: "Administração não está configurada neste ambiente." });
  }
  const header = request.headers.get("authorization") ?? "";
  const provided = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1]?.trim() ?? "";
  if (!provided || !secretsMatch(provided, expected)) {
    return json(401, { error: "Token de administração inválido." });
  }
  return null;
}

function store(env: Env): KVNamespace | null {
  const kv = (env as Record<string, unknown>).TENANT_MANIFESTS;
  return kv && typeof (kv as KVNamespace).put === "function" ? (kv as KVNamespace) : null;
}

export type ManifestPutBody = {
  manifest?: unknown;
  /** Token que a plataforma vai apresentar. Só o HASH é guardado. */
  token?: unknown;
};

/**
 * `PUT /admin/tenants/:tenantId/manifest`
 *
 * Grava manifesto (e, quando vier token, o índice). Devolve o que foi aceito —
 * nunca o token, nunca a credencial do manifesto.
 */
export async function putManifest(
  request: Request,
  env: Env,
  tenantId: string
): Promise<AdminResult> {
  const denied = authorize(request, env);
  if (denied) return denied;

  const kv = store(env);
  if (!kv) return json(503, { error: "KV de manifestos não está configurado." });
  if (!tenantId) return json(400, { error: "tenantId é obrigatório." });

  let body: ManifestPutBody;
  try {
    body = (await request.json()) as ManifestPutBody;
  } catch {
    return json(400, { error: "Corpo não é JSON válido." });
  }

  const parsed = parseManifest(body.manifest);
  if (!parsed.ok) {
    // A recusa é NOMEADA e nada é gravado: um "salvo" que não salvou é a falha
    // que esta rota existe para acabar.
    return json(400, { error: `Manifesto recusado — ${parsed.error}` });
  }
  if (parsed.manifest.tenantId !== tenantId) {
    return json(400, { error: "O tenantId do manifesto não casa com o da URL." });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (body.token !== undefined && token.length < 16) {
    return json(400, { error: "O token precisa ter ao menos 16 caracteres." });
  }

  await kv.put(`${MANIFEST_PREFIX}${tenantId}`, JSON.stringify(parsed.manifest));
  if (token) {
    await kv.put(`${TOKEN_PREFIX}${await hashToken(token)}`, tenantId);
  }

  return json(200, {
    tenantId,
    tools: parsed.manifest.tools.map((t) => ({ name: t.name, scope: t.scope })),
    tokenIndexed: Boolean(token)
  });
}

/** `DELETE /admin/tenants/:tenantId/manifest` — o tenant deixa de ser alcançável. */
export async function deleteManifest(
  request: Request,
  env: Env,
  tenantId: string
): Promise<AdminResult> {
  const denied = authorize(request, env);
  if (denied) return denied;

  const kv = store(env);
  if (!kv) return json(503, { error: "KV de manifestos não está configurado." });

  await kv.delete(`${MANIFEST_PREFIX}${tenantId}`);
  // O índice do token NÃO é apagado aqui: a chave dele é o hash, e o hash só se
  // obtém do token, que não temos. Sem manifesto o token já resolve para 404, e
  // um índice órfão não alcança nada — ficar é inerte, e inventar uma varredura
  // do KV para achá-lo seria uma listagem, justo o que este desenho não tem.
  return json(200, { tenantId, removed: true });
}

/** `GET /admin/tenants/:tenantId/manifest` — secret-free. */
export async function getManifest(
  request: Request,
  env: Env,
  tenantId: string
): Promise<AdminResult> {
  const denied = authorize(request, env);
  if (denied) return denied;

  const kv = store(env);
  if (!kv) return json(503, { error: "KV de manifestos não está configurado." });

  const raw = await kv.get(`${MANIFEST_PREFIX}${tenantId}`, "json");
  if (!raw) return json(404, { error: "Nenhum manifesto para este tenant." });

  const parsed = parseManifest(raw);
  if (!parsed.ok) return json(200, { tenantId, valid: false, error: parsed.error });

  const { auth, ...rest } = parsed.manifest;
  return json(200, {
    tenantId,
    valid: true,
    // A credencial da API do cliente NUNCA volta — só se ela existe.
    manifest: { ...rest, auth: { type: auth.type, configured: auth.type !== "none" } }
  });
}
