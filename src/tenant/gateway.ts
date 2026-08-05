import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { TenantManifest, TenantTool } from "./manifest";
import { project } from "./project";
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

/** Substitui `{param}` no path e devolve o restante para query/header. */
function buildTarget(
  manifest: TenantManifest,
  tool: TenantTool,
  args: Record<string, string | undefined>
): { url: string; headers: Record<string, string> } {
  let path = tool.path;
  const query = new URLSearchParams();
  const headers: Record<string, string> = { Accept: "application/json" };

  for (const param of tool.params) {
    const value = args[param.name];
    if (value === undefined || value === "") continue;
    if (param.in === "path") {
      path = path.replaceAll(`{${param.name}}`, encodeURIComponent(value));
    } else if (param.in === "query") {
      query.set(param.name, value);
    } else {
      headers[param.name] = value;
    }
  }

  if (manifest.auth.type === "bearer") headers.Authorization = `Bearer ${manifest.auth.token}`;
  else if (manifest.auth.type === "header") headers[manifest.auth.name] = manifest.auth.value;

  const base = manifest.baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  const qs = query.toString();
  return { url: `${base}${suffix}${qs ? `?${qs}` : ""}`, headers };
}

function missingRequired(tool: TenantTool, args: Record<string, string | undefined>): string | null {
  for (const param of tool.params) {
    if (param.required && !args[param.name]) return param.name;
  }
  return null;
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
  args: Record<string, string | undefined>
): Promise<ToolResult> {
  const missing = missingRequired(tool, args);
  if (missing) return fail(`Faltou o parâmetro obrigatório "${missing}".`);

  const { url, headers } = buildTarget(manifest, tool, args);

  let body: string;
  try {
    body = await safeFetch(url, {
      method: tool.method,
      headers,
      timeoutMs: manifest.timeoutMs
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

  const projected = project(parsed, tool.fields, tool.maxChars);
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
