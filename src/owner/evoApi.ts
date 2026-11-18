import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { fail, ok, type ToolResult } from "../social/shared";
import { OutboundError, safeFetch } from "../tenant/safeUrl";
import { EVO_BASE_URL } from "../tenant/presets/evo";
import { EVO_ROUTES, type EvoParam, type EvoRoute } from "./evoCatalog";
import type { EvoAccess } from "./evoGestao";
import { maskPersonalData } from "./evoMask";

/**
 * Toda a API de LEITURA da EVO para o dono, uma ferramenta por rota GET
 * (`evo_v1_*`, `evo_v2_*`, `evo_v3_*`), geradas do catálogo
 * (`scripts/gen-evo-catalog.mjs`). Só na gestão: o agente do WhatsApp
 * (`/mcp/tenant`) segue com as consultas do preset, sem mudança.
 *
 * Três contenções, além do GET-só:
 * 1. **A unidade é a da academia.** `idBranch` não é parâmetro: quando a
 *    academia tem unidade cadastrada, ela vai em toda chamada que a aceita.
 * 2. **Dado pessoal mascarado** (`evoMask.ts`) antes de a resposta sair.
 * 3. **Resposta com teto.** Lista grande é cortada em itens, com aviso para
 *    paginar (`take`/`skip`), em vez de estourar o contexto do modelo.
 */

const HOP_TIMEOUT_MS = 20_000;
const MAX_BYTES = 8 * 1024 * 1024;
export const MAX_OUTPUT_CHARS = 60_000;

type Args = Record<string, unknown>;

function zodOf(param: EvoParam): z.ZodTypeAny {
  let schema: z.ZodTypeAny;
  if (param.enum?.length) {
    schema = param.type === "integer" ? z.number().int() : z.enum(param.enum.map(String) as [string, ...string[]]);
  } else if (param.type === "integer") schema = z.number().int();
  else if (param.type === "number") schema = z.number();
  else if (param.type === "boolean") schema = z.boolean();
  else if (param.type === "array") schema = z.array(param.items === "number" ? z.number() : z.string().max(200)).max(100);
  else schema = z.string().max(200);
  const hint = param.format === "date" ? " Data: AAAA-MM-DD." : "";
  const enumHint = param.enum?.length && param.type === "integer" ? ` Valores: ${param.enum.join(", ")}.` : "";
  const described = schema.describe(`${param.description}${hint}${enumHint}`.trim() || param.name);
  return param.required ? described : described.optional();
}

/** O `idBranch` fica com a academia, não com o modelo. */
const ownedByTenant = (param: EvoParam, access: EvoAccess) =>
  param.name.toLowerCase() === "idbranch" && access.idBranch !== undefined;

export function buildEvoUrl(route: EvoRoute, args: Args, access: EvoAccess): string | { error: string } {
  let path = route.path;
  const query = new URLSearchParams();
  for (const param of route.params) {
    const value = ownedByTenant(param, access) ? access.idBranch : args[param.name];
    if (value === undefined || value === null || value === "") {
      if (param.required) return { error: `Parâmetro obrigatório ausente: ${param.name}.` };
      continue;
    }
    if (param.in === "path") {
      path = path.replace(`{${param.name}}`, encodeURIComponent(String(value)));
    } else if (Array.isArray(value)) {
      for (const item of value) query.append(param.name, String(item));
    } else {
      query.set(param.name, String(value));
    }
  }
  if (/\{[^}]+\}/.test(path)) return { error: "Parâmetro de caminho ausente." };
  const qs = query.toString();
  return `${EVO_BASE_URL}${path}${qs ? `?${qs}` : ""}`;
}

/** Corta a resposta no teto, preferindo cortar ITENS de lista a cortar texto no meio. */
export function capOutput(data: unknown): unknown {
  const size = (v: unknown) => JSON.stringify(v)?.length ?? 0;
  if (size(data) <= MAX_OUTPUT_CHARS) return data;
  const list = Array.isArray(data) ? data : null;
  if (list) {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (size(list.slice(0, mid)) <= MAX_OUTPUT_CHARS - 300) lo = mid;
      else hi = mid - 1;
    }
    return {
      aviso: `Resposta grande: mostrando ${lo} de ${list.length} itens. Use take/skip (ou um filtro/período menor) para ver o resto.`,
      itens: list.slice(0, lo)
    };
  }
  return {
    aviso: "Resposta grande demais; cortada. Use filtros, take/skip ou um período menor.",
    parcial: JSON.stringify(data).slice(0, MAX_OUTPUT_CHARS - 300)
  };
}

async function callRoute(route: EvoRoute, args: Args, access: EvoAccess): Promise<ToolResult> {
  const url = buildEvoUrl(route, args, access);
  if (typeof url !== "string") return fail(url.error);
  try {
    const body = await safeFetch(url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: access.authorization },
      timeoutMs: HOP_TIMEOUT_MS,
      maxBytes: MAX_BYTES
    });
    if (!body.trim()) return ok({ resultado: null });
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return fail("A EVO respondeu algo que não é JSON.");
    }
    return ok(capOutput(maskPersonalData(parsed)));
  } catch (error) {
    // Nunca o corpo do erro da EVO: ele pode trazer dado de aluno.
    if (error instanceof OutboundError) {
      if (error.status === 401) return fail("A EVO recusou a credencial desta academia (401). Confira DNS e Secret Key.");
      if (error.status === 403) return fail("O token da EVO desta academia não tem permissão para esta rota (403). Peça a liberação à W12.");
      if (error.status === 404) return fail("A EVO não encontrou o registro pedido (404).");
      if (error.status === 400) return fail("A EVO recusou os parâmetros (400). Confira formatos e obrigatórios.");
      return fail(`Falha ao consultar a EVO: ${error.message}`);
    }
    return fail("Falha ao processar a resposta da EVO.");
  }
}

export function registerEvoApiTools(server: McpServer, access: EvoAccess): void {
  for (const route of EVO_ROUTES) {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const param of route.params) if (!ownedByTenant(param, access)) shape[param.name] = zodOf(param);
    server.registerTool(
      route.tool,
      {
        description: `[EVO ${route.tag || "API"}] ${route.summary} — GET ${route.path}. Somente leitura; dados pessoais de alunos vêm mascarados.`,
        inputSchema: shape
      },
      async (args: Args) => callRoute(route, args ?? {}, access)
    );
  }
}
