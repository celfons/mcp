import { z } from "zod";

/**
 * O MANIFESTO de um tenant: qual API do cliente, quais endpoints viram
 * ferramentas MCP, quais parâmetros elas aceitam e quais campos da resposta
 * podem entrar no prompt.
 *
 * Este arquivo é a fronteira do gateway. Tudo que a plataforma anuncia,
 * chama e devolve ao modelo nasce daqui, e por isso o esquema é estreito de
 * propósito: um manifesto inválido é recusado inteiro, nunca aplicado pela
 * metade. Meio manifesto aplicado é a pior falha possível aqui — uma ferramenta
 * anunciada sem a projeção de campos entregaria o JSON cru do cliente ao
 * modelo, com margem, custo interno e dado de terceiro dentro.
 *
 * Duas regras existem para casar com o contrato do BACKEND (ADR-0036), e não por
 * gosto:
 *
 *  1. Ferramenta de escopo `customer` PRECISA declarar o parâmetro de identidade
 *     entre os seus parâmetros. O backend recusa (`identityParam_missing`) a
 *     ferramenta que não o declara no `inputSchema`, então um manifesto que
 *     escapasse daqui produziria uma ferramenta anunciada e nunca chamável.
 *  2. Ferramenta de escopo `business` NÃO pode ter parâmetro de identidade — a
 *     contradição é recusada em vez de resolvida em silêncio.
 */

/** Onde o parâmetro entra na requisição ao cliente. */
export const ParamLocationSchema = z.enum(["path", "query", "header"]);

const NameSchema = z
  .string()
  .min(1)
  .max(64)
  // O mesmo formato que o backend aceita em nome de ferramenta; nome fora disso
  // é recusado lá (`unclassified`) e a ferramenta nunca seria chamável.
  .regex(/^[A-Za-z0-9_.-]+$/, "nome deve casar com [A-Za-z0-9_.-]");

export const ParamSchema = z.object({
  name: NameSchema,
  in: ParamLocationSchema,
  required: z.boolean().optional(),
  description: z.string().max(200).optional()
});

/**
 * Um campo que PODE entrar no prompt. Nada fora desta lista viaja.
 *
 * `path` aceita notação de ponto e índice (`items[0].nome`). O `label` é o que o
 * modelo lê — o nome interno do campo do cliente costuma ser críptico
 * (`dt_prev_ent`) e não ajuda ninguém.
 */
export const FieldSchema = z.object({
  path: z.string().min(1).max(120),
  label: z.string().min(1).max(60)
});

export const ToolSchema = z
  .object({
    name: NameSchema,
    description: z.string().min(1).max(200),
    method: z.enum(["GET", "POST"]).default("GET"),
    /** Caminho relativo à `baseUrl`; `{param}` é substituído por parâmetro `in: "path"`. */
    path: z.string().min(1).max(300),
    scope: z.enum(["customer", "business"]),
    /** Só para `customer`: o parâmetro que o backend sobrescreve com o telefone verificado. */
    identityParam: NameSchema.optional(),
    params: z.array(ParamSchema).max(12).default([]),
    fields: z.array(FieldSchema).min(1).max(20),
    /** Teto do texto devolvido. O backend corta em ~2000; ficar abaixo evita corte no meio. */
    maxChars: z.number().int().min(100).max(1800).default(1200)
  })
  .superRefine((tool, ctx) => {
    const names = tool.params.map((p) => p.name);
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: "custom", message: `ferramenta "${tool.name}": parâmetro duplicado` });
    }
    if (tool.scope === "customer") {
      if (!tool.identityParam) {
        ctx.addIssue({
          code: "custom",
          message: `ferramenta "${tool.name}": escopo customer exige identityParam`
        });
      } else if (!names.includes(tool.identityParam)) {
        // O backend confere isto no `inputSchema` anunciado e recusa a chamada.
        // Recusar aqui evita anunciar uma ferramenta que nunca poderia ser usada.
        ctx.addIssue({
          code: "custom",
          message: `ferramenta "${tool.name}": identityParam "${tool.identityParam}" não está em params`
        });
      }
    } else if (tool.identityParam) {
      ctx.addIssue({
        code: "custom",
        message: `ferramenta "${tool.name}": escopo business não pode ter identityParam`
      });
    }
    // Todo `{placeholder}` do path tem de existir como parâmetro de path, senão a
    // URL montada carregaria a chave literal e a API do cliente responderia 404
    // sem que ninguém entendesse por quê.
    const pathParams = new Set(
      tool.params.filter((p) => p.in === "path").map((p) => p.name)
    );
    for (const match of tool.path.matchAll(/\{([^}]+)\}/g)) {
      if (!pathParams.has(match[1])) {
        ctx.addIssue({
          code: "custom",
          message: `ferramenta "${tool.name}": {${match[1]}} no path não tem parâmetro correspondente`
        });
      }
    }
  });

export const AuthSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("bearer"), token: z.string().min(1) }),
  z.object({ type: z.literal("header"), name: NameSchema, value: z.string().min(1) })
]);

export const ManifestSchema = z.object({
  tenantId: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  /** Base da API do cliente. `https` e destino público são exigidos no uso (safeUrl). */
  baseUrl: z.string().url(),
  auth: AuthSchema.default({ type: "none" }),
  tools: z.array(ToolSchema).min(1).max(24),
  /** Teto por chamada à API do cliente. Abaixo dos 4s que o backend concede ao leg. */
  timeoutMs: z.number().int().min(500).max(3500).default(3000)
});

export type TenantManifest = z.infer<typeof ManifestSchema>;
export type TenantTool = z.infer<typeof ToolSchema>;
export type TenantParam = z.infer<typeof ParamSchema>;

export type ManifestParseResult =
  | { ok: true; manifest: TenantManifest }
  | { ok: false; error: string };

/**
 * Valida um manifesto. Recusa INTEIRO em qualquer problema: uma ferramenta
 * podre não é descartada em silêncio, porque um manifesto que "quase" carrega é
 * um manifesto cuja metade ausente ninguém vai notar até um cliente perguntar
 * algo que deixou de ser respondido.
 */
export function parseManifest(raw: unknown): ManifestParseResult {
  const parsed = ManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first ? `${first.path.join(".")}: ${first.message}` : "manifesto inválido" };
  }
  const names = parsed.data.tools.map((t) => t.name);
  if (new Set(names).size !== names.length) {
    return { ok: false, error: "nomes de ferramenta duplicados no manifesto" };
  }
  return { ok: true, manifest: parsed.data };
}
