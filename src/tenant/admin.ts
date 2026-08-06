import { parseManifest, type TenantManifest } from "./manifest";
import { hashToken } from "./store";
import { buildEvoManifest, evoToolPolicy } from "./presets/evo";

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

  await persist(kv, parsed.manifest, token);

  return json(200, {
    tenantId,
    tools: parsed.manifest.tools.map((t) => ({ name: t.name, scope: t.scope })),
    tokenIndexed: Boolean(token)
  });
}

/**
 * Grava manifesto + índice do token. Extraído de `putManifest` quando o preset
 * passou a ser um segundo produtor de manifesto: um caminho de gravação
 * duplicado é como as duas chaves acabam gravadas em ordens diferentes.
 */
async function persist(
  kv: KVNamespace,
  manifest: TenantManifest,
  token: string
): Promise<void> {
  await kv.put(`${MANIFEST_PREFIX}${manifest.tenantId}`, JSON.stringify(manifest));
  if (token) await kv.put(`${TOKEN_PREFIX}${await hashToken(token)}`, manifest.tenantId);
}

export type EvoPresetBody = {
  dns?: unknown;
  secretKey?: unknown;
  idBranch?: unknown;
  label?: unknown;
  token?: unknown;
  /** `"all"` (default) ou `"business"` — só preço, plano, grade e unidade. */
  include?: unknown;
};

/**
 * `PUT /admin/tenants/:tenantId/preset/evo`
 *
 * Ativa uma academia em três campos, em vez de um manifesto de 250 linhas
 * colado à mão. O manifesto é GERADO e validado pelo mesmo `parseManifest` da
 * rota irmã — o preset não é um caminho de gravação paralelo, é um gerador de
 * entrada para o mesmo.
 *
 * A resposta devolve a `tool_policy` que a plataforma precisa gravar em
 * `tenant_mcp_servers`. Ela vem daqui porque os dois documentos têm de
 * concordar e moram em repositórios diferentes: uma ferramenta anunciada aqui e
 * não classificada lá nasce inchamável (`unclassified`), e o dono só descobre
 * pela métrica de degradação. Devolvê-la pronta tira a transcrição manual do
 * caminho da ativação.
 */
export async function putEvoPreset(
  request: Request,
  env: Env,
  tenantId: string
): Promise<AdminResult> {
  const denied = authorize(request, env);
  if (denied) return denied;

  const kv = store(env);
  if (!kv) return json(503, { error: "KV de manifestos não está configurado." });
  if (!tenantId) return json(400, { error: "tenantId é obrigatório." });

  let body: EvoPresetBody;
  try {
    body = (await request.json()) as EvoPresetBody;
  } catch {
    return json(400, { error: "Corpo não é JSON válido." });
  }

  const dns = typeof body.dns === "string" ? body.dns.trim() : "";
  const secretKey = typeof body.secretKey === "string" ? body.secretKey.trim() : "";
  if (!dns || !secretKey) {
    return json(400, { error: "dns e secretKey da EVO são obrigatórios." });
  }
  if (body.idBranch !== undefined && !Number.isInteger(body.idBranch)) {
    return json(400, { error: "idBranch, quando informado, precisa ser inteiro." });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (body.token !== undefined && token.length < 16) {
    return json(400, { error: "O token precisa ter ao menos 16 caracteres." });
  }

  // Valor desconhecido é RECUSADO, nunca lido como o default. Um `include:
  // "buisness"` com erro de digitação, tratado como "all", ativaria as consultas
  // sobre o aluno numa academia que pediu explicitamente para não tê-las — e o
  // telefone do cliente passaria a sair do perímetro por causa de um typo.
  if (body.include !== undefined && body.include !== "all" && body.include !== "business") {
    return json(400, { error: 'include, quando informado, precisa ser "all" ou "business".' });
  }
  const include = body.include === "business" ? ("business" as const) : ("all" as const);

  const built = buildEvoManifest({
    tenantId,
    dns,
    secretKey,
    include,
    ...(typeof body.label === "string" ? { label: body.label } : {}),
    ...(typeof body.idBranch === "number" ? { idBranch: body.idBranch } : {})
  });
  if (!built.ok) {
    // Só acontece se o próprio preset regredir. Recusar com nome é melhor do que
    // gravar um manifesto que o gateway depois recusa na leitura.
    return json(500, { error: `Preset EVO inválido — ${built.error}` });
  }

  await persist(kv, built.manifest, token);

  return json(200, {
    tenantId,
    preset: "evo",
    include,
    tools: built.manifest.tools.map((t) => ({ name: t.name, scope: t.scope })),
    tokenIndexed: Boolean(token),
    // Para colar em `PUT /api/admin/tenants/{tenantId}/mcp-server` da plataforma.
    // Derivada do manifesto que acabou de ser gravado, então ela nunca descreve
    // uma consulta que aquele tenant não anuncia.
    toolPolicy: evoToolPolicy(built.manifest)
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
