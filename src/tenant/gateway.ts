import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { applyTransform, type TenantManifest, type TenantTool } from "./manifest";
import { project, readScalar, resolveProjectionRoot } from "./project";
import { OutboundError, safeFetch } from "./safeUrl";
import { fail, ok, type ToolResult } from "../social/shared";

/**
 * O GATEWAY: fala MCP com a plataforma e REST com a API do cliente.
 *
 * O encaixe que faz isto valer a pena é que `tools/list` não pergunta nada a
 * ninguém — ele é SINTETIZADO do manifesto. Do lado da plataforma não há
 * novidade: ela vê um servidor MCP como qualquer outro, e toda a proteção que
 * ela já tem (seleção por LLM, política de escopo, sobrescrita do identificador
 * pelo telefone verificado, orçamento de tempo, sanitização, métricas de
 * degradação) continua valendo sem uma linha alterada lá.
 *
 * O que este arquivo precisa honrar do contrato do backend (ADR-0036):
 *
 *  • o `inputSchema` anunciado DECLARA o parâmetro de identidade das ferramentas
 *    `customer` — sem isso o backend recusa a chamada (`identityParam_missing`);
 *  • a descrição é curta: o backend corta em 200 caracteres antes de mostrá-la
 *    ao modelo que escolhe a ferramenta;
 *  • o retorno é TEXTO já projetado — nunca o JSON do cliente;
 *  • falha vira resultado de erro, não exceção: o modelo recebe uma frase e o
 *    turno segue sem o bloco, em vez de o leg inteiro cair.
 */

/** Monta o `inputSchema` da ferramenta a partir dos parâmetros declarados. */
function inputSchemaOf(tool: TenantTool): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const param of tool.params) {
    const base = z.string().max(200).describe(param.description ?? param.name);
    shape[param.name] = param.required ? base : base.optional();
  }
  return shape;
}

/** Os cabeçalhos de autenticação da API do cliente — os mesmos nos dois saltos. */
function authHeaders(manifest: TenantManifest): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (manifest.auth.type === "bearer") headers.Authorization = `Bearer ${manifest.auth.token}`;
  else if (manifest.auth.type === "header") headers[manifest.auth.name] = manifest.auth.value;
  return headers;
}

function joinUrl(baseUrl: string, path: string, query: URLSearchParams): string {
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  const qs = query.toString();
  return `${base}${suffix}${qs ? `?${qs}` : ""}`;
}

/**
 * Substitui `{param}` no path e devolve o restante para query/header.
 *
 * Três precedências, e a ordem é deliberada: a query FIXA entra primeiro (é do
 * autor do manifesto), os parâmetros do modelo depois — mas sem poder
 * sobrescrever chave fixa, porque o schema proíbe a colisão —, e o valor
 * RESOLVIDO por último, que é o único que pode chegar depois de tudo porque é o
 * único que ninguém de fora escolheu.
 */
function buildTarget(
  manifest: TenantManifest,
  tool: TenantTool,
  args: Record<string, string | undefined>,
  injected: Record<string, string> = {}
): { url: string; headers: Record<string, string> } {
  let path = tool.path;
  const query = new URLSearchParams();
  const headers = authHeaders(manifest);

  for (const [key, value] of Object.entries(tool.query)) query.set(key, value);

  for (const param of tool.params) {
    // Com `resolve`, o parâmetro de identidade foi CONSUMIDO pelo salto de
    // resolução: ele existe no `inputSchema` porque o backend exige que a
    // ferramenta `customer` o declare (ADR-0036 §2, condição 3), não porque a
    // consulta principal saiba o que fazer com um telefone.
    if (tool.resolve && param.name === tool.identityParam) continue;
    const raw = args[param.name];
    if (raw === undefined || raw === "") continue;
    const value = applyTransform(raw, param.transform);
    if (value === "") continue;
    if (param.in === "path") {
      path = path.replaceAll(`{${param.name}}`, encodeURIComponent(value));
    } else if (param.in === "query") {
      query.set(param.name, value);
    } else {
      headers[param.name] = value;
    }
  }

  for (const [key, value] of Object.entries(injected)) query.set(key, value);

  return { url: joinUrl(manifest.baseUrl, path, query), headers };
}

function missingRequired(tool: TenantTool, args: Record<string, string | undefined>): string | null {
  for (const param of tool.params) {
    if (param.required && !args[param.name]) return param.name;
  }
  return null;
}

/**
 * Teto do valor resolvido. Um id interno cabe folgado; o teto está aqui para
 * que um servidor que devolva um blob num campo escalar não vire uma query
 * gigante na consulta seguinte.
 */
const MAX_RESOLVED_CHARS = 64;

/** Piso de tempo para um salto. Abaixo disso não vale a pena tentar. */
const MIN_HOP_MS = 400;

type ResolveOutcome =
  | { ok: true; value: string }
  /** Não achou cadastro para esta identidade — desfecho NORMAL, não falha. */
  | { ok: false; notFound: true }
  | { ok: false; notFound: false; message: string };

/**
 * O salto de resolução: identidade verificada → chave interna do cliente.
 *
 * Só é chamado por `runTool`, e o valor enviado é sempre o `identityParam` da
 * ferramenta. Não há assinatura que permita mandar outra coisa.
 */
async function runResolve(
  manifest: TenantManifest,
  tool: TenantTool,
  identity: string,
  budgetMs: number
): Promise<ResolveOutcome> {
  const resolve = tool.resolve;
  if (!resolve) return { ok: false, notFound: false, message: "resolve ausente" };

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(resolve.query ?? {})) query.set(key, value);
  query.set(resolve.param, identity);

  let body: string;
  try {
    body = await safeFetch(joinUrl(manifest.baseUrl, resolve.path, query), {
      method: "GET",
      headers: authHeaders(manifest),
      timeoutMs: budgetMs
    });
  } catch (error) {
    return {
      ok: false,
      notFound: false,
      message: error instanceof OutboundError ? error.message : "falha ao identificar o cadastro"
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, notFound: false, message: "a API do cliente não respondeu JSON" };
  }

  for (const candidate of resolve.extract) {
    const value = readScalar(parsed, candidate);
    if (value !== null && value.length <= MAX_RESOLVED_CHARS) return { ok: true, value };
  }
  // Nenhum candidato deu escalar: ou o telefone não tem cadastro, ou a resposta
  // mudou de forma. Os dois terminam igual — e o que NÃO pode acontecer é a
  // consulta principal sair sem a chave.
  return { ok: false, notFound: true };
}

/**
 * Executa uma ferramenta: chama a API do cliente e devolve os campos declarados.
 *
 * Exportada porque é onde está o comportamento que vale testar — o registro no
 * servidor MCP é só a amarração.
 */
export async function runTool(
  manifest: TenantManifest,
  tool: TenantTool,
  args: Record<string, string | undefined>,
  now: () => number = Date.now
): Promise<ToolResult> {
  const missing = missingRequired(tool, args);
  if (missing) return fail(`Faltou o parâmetro obrigatório "${missing}".`);

  // `timeoutMs` é o orçamento da FERRAMENTA, não de um salto. Com resolução são
  // dois saltos seriais, e o que importa é caber no teto que o backend concede à
  // chamada inteira (`MCP_TIMEOUT_MS`); um teto por salto faria o pior caso ser a
  // soma deles. Um salto rápido devolve o tempo ao seguinte — o mesmo prazo
  // absoluto que o leg do ADR-0036 usa do outro lado do fio.
  const deadline = now() + manifest.timeoutMs;
  const remaining = (): number => deadline - now();

  const injected: Record<string, string> = {};
  if (tool.resolve && tool.identityParam) {
    const param = tool.params.find((p) => p.name === tool.identityParam);
    const identity = applyTransform(args[tool.identityParam] ?? "", param?.transform);
    if (!identity) return fail("Faltou a identidade do cliente para esta consulta.");

    const resolved = await runResolve(manifest, tool, identity, Math.max(MIN_HOP_MS, remaining()));
    if (!resolved.ok) {
      // Não achou: a consulta principal NÃO acontece. Sem a chave, um
      // `/receivables` devolveria o financeiro de todo mundo — o vazamento entre
      // clientes do mesmo tenant que o ADR-0036 existe para fechar.
      if (resolved.notFound) return ok("Nenhum cadastro encontrado para este contato.");
      return fail(resolved.message);
    }
    injected[tool.resolve.into] = resolved.value;
  }

  const { url, headers } = buildTarget(manifest, tool, args, injected);

  let body: string;
  try {
    body = await safeFetch(url, {
      method: tool.method,
      headers,
      timeoutMs: Math.max(MIN_HOP_MS, remaining())
    });
  } catch (error) {
    // A mensagem é a NOSSA, nunca o corpo do erro do cliente: esse texto entra
    // no prompt, e uma API que ecoa o payload devolveria dado por via de erro.
    return fail(error instanceof OutboundError ? error.message : "falha ao consultar a API do cliente");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return fail("a API do cliente não respondeu JSON");
  }

  const projected = project(resolveProjectionRoot(parsed, tool.root), tool.fields, tool.maxChars);
  if (!projected.text) {
    // Sem campo nenhum, a consulta não tem o que informar. Dizer isso é melhor
    // do que devolver vazio: o agente segue a conversa sabendo que não achou.
    return ok("Nenhum dado encontrado para esta consulta.");
  }
  return ok(projected.text);
}

/**
 * Aceita só escalares e os converte a texto. Objeto e array são DESCARTADOS: o
 * esquema anunciado pede string, então uma estrutura aqui é o modelo saindo do
 * contrato, e repassá-la à API do cliente seria montar uma requisição com o que
 * ninguém validou.
 */
export function asStringArgs(args: Record<string, unknown>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(args ?? {})) {
    if (typeof value === "string") out[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value);
  }
  return out;
}

/**
 * Registra, neste servidor, as ferramentas DESTE tenant — e de nenhum outro.
 * O chamador já resolveu o manifesto a partir do token da requisição.
 */
export function registerTenantTools(server: McpServer, manifest: TenantManifest): void {
  for (const tool of manifest.tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: inputSchemaOf(tool) },
      // O SDK entrega `Record<string, unknown>` (o esquema é montado em runtime,
      // então ele não tem como inferir a forma). A normalização a string acontece
      // aqui, num lugar só, em vez de cada `runTool` desconfiar do próprio
      // argumento.
      async (args: Record<string, unknown>) => runTool(manifest, tool, asStringArgs(args))
    );
  }
}
