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

/**
 * Normalização aplicada ao valor ANTES de ele entrar na requisição ao cliente.
 *
 * Existe por um desencontro que não é hipótese: o identificador que a plataforma
 * escreve no `identityParam` é o `wa_id` da Meta — E.164 em dígitos, com DDI e
 * sem `+` (`5534999530186`). ERP brasileiro guarda o telefone em formato LOCAL,
 * e a própria EVO prova isso ao modelar o DDI como campo separado do número
 * (`TelefoneApiViewModel.ddi`). Sem transformação, a busca casa zero registros —
 * e o modo de falha é o pior possível: nada quebra, o leg degrada em
 * `empty_result`, e o dono conclui que "a integração não funciona" sem nenhum
 * sinal apontando a causa.
 *
 *  · `digits`   — só os dígitos (tira máscara, `+`, espaço, parêntese).
 *  · `br_local` — `digits` e, quando o resultado tem 12–13 dígitos começando em
 *    `55`, remove o DDI. A janela de comprimento é o que impede um número local
 *    de DDD 55 (Santa Maria/RS, 11 dígitos) de perder os dois primeiros.
 */
export const ParamTransformSchema = z.enum(["digits", "br_local"]);

export const ParamSchema = z.object({
  name: NameSchema,
  in: ParamLocationSchema,
  required: z.boolean().optional(),
  description: z.string().max(200).optional(),
  transform: ParamTransformSchema.optional()
});

/**
 * Um campo que PODE entrar no prompt. Nada fora desta lista viaja.
 *
 * `path` aceita notação de ponto e índice (`items[0].nome`). O `label` é o que o
 * modelo lê — o nome interno do campo do cliente costuma ser críptico
 * (`dt_prev_ent`) e não ajuda ninguém.
 */
export const FieldSchema = z.object({
  /**
   * Caminho do campo. Aceita ponto e índice (`entrega.previsao`, `itens[0].nome`)
   * e, para lista, o caminho de REPETIÇÃO `produtos[].nome` — que projeta todos
   * os itens, agrupados numa linha por item.
   *
   * A repetição é o que faz uma ferramenta de BUSCA funcionar: sem ela, quem
   * cadastra teria de declarar `produtos[0]`, `produtos[1]`… um índice por vez,
   * e a lista some quando o cliente devolve mais do que alguém declarou.
   */
  path: z.string().min(1).max(120),
  label: z.string().min(1).max(60)
});

/** Um caminho de leitura na resposta do cliente. */
const PathSchema = z.string().min(1).max(120);

/** Em `root` e em `resolve.extract`: "a própria resposta, sem descer". */
export const ROOT_SELF = "$";

/**
 * O salto de RESOLUÇÃO: `telefone verificado → chave interna do cliente`, feito
 * pelo gateway antes da consulta principal.
 *
 * Ele existe porque, sem ele, metade das consultas escopadas por cliente é
 * inexprimível. A plataforma só sabe o telefone (é o que ela verifica no
 * ingresso do canal), e a maioria das APIs de ERP keya por um id interno —
 * `/receivables?memberId=`, `/activities/schedule?idMember=`. O ADR-0036 proíbe
 * ENCADEAR ferramentas, mas o que ele proíbe é o laço de decisão da LLM
 * (chamar → ler → decidir de novo); daqui sai UM `tools/call`, e os dois saltos
 * HTTP são determinísticos, dentro do mesmo orçamento de tempo.
 *
 * E a amarra fica mais FORTE, não mais fraca. O limite conhecido nº 1 do
 * ADR-0036 é que a plataforma prova o *envio* da identidade, não o *respeito* a
 * ela: hoje o `idMember` viajaria como argumento que o modelo tirou do texto do
 * cliente. Com o salto, ele é DERIVADO do telefone verificado pelo próprio
 * gateway, e o modelo não tem como propô-lo — o método do ADR-0033 (isolamento
 * por derivação, não por validação) aplicado aqui.
 *
 * Três propriedades são estruturais, e nenhuma é configurável:
 *  1. o valor enviado é SEMPRE o `identityParam` da ferramenta (pós-transform).
 *     Não há campo para escolher outro: se houvesse, o modelo escolheria;
 *  2. `into` não pode colidir com parâmetro declarado — o valor resolvido não
 *     disputa precedência com nada que o modelo alcance;
 *  3. resolução VAZIA aborta a ferramenta. A consulta principal NÃO acontece —
 *     `/receivables` sem `memberId` devolveria o financeiro da academia inteira,
 *     que é o vazamento que este arquivo existe para impedir.
 */
export const ResolveSchema = z.object({
  /** Caminho da consulta de resolução, relativo à `baseUrl`. Sem `{placeholder}`. */
  path: z.string().min(1).max(300),
  /** Nome do parâmetro de query que recebe o identificador verificado (ex.: `phone`). */
  param: NameSchema,
  /** Query fixa do salto de resolução (ex.: `take=1`). Do autor do manifesto, não do modelo. */
  query: z.record(NameSchema, z.string().max(200)).optional(),
  /**
   * Onde ler a chave interna na resposta, em ordem de tentativa. Candidatos
   * porque o swagger da EVO declara `/members/basic` como objeto e a busca
   * paginada devolve lista — declarar `["[0].idMember", "idMember"]` cobre as
   * duas formas sem adivinhação em runtime.
   */
  extract: z.array(PathSchema).min(1).max(4),
  /** Nome do parâmetro de query da consulta PRINCIPAL que recebe a chave resolvida. */
  into: NameSchema
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
    /**
     * Query FIXA, escrita no manifesto e fora do alcance do modelo — `idBranch`
     * da unidade, `active=true`, `take=20`. Sem isto, pinar a unidade de uma
     * academia exigiria declarar `idBranch` como parâmetro, e um parâmetro é
     * exatamente o que o modelo preenche a partir do texto do cliente.
     */
    query: z.record(NameSchema, z.string().max(200)).default({}),
    /**
     * Onde, dentro da resposta, mora o que a projeção deve ler — em ordem de
     * tentativa. `"$"` é a resposta inteira; ausente equivale a `["$"]`.
     *
     * Um envelope de paginação (`{ qtde, list: [...] }`, que é o que
     * `/api/v1/receivables` devolve) tornaria todo `path` do `fields` prefixado
     * com `list.`, e a alternância `list`/`lista` da EVO exigiria dois
     * manifestos. Aqui é uma linha.
     */
    root: z.array(PathSchema).min(1).max(4).optional(),
    resolve: ResolveSchema.optional(),
    fields: z.array(FieldSchema).min(1).max(20),
    /**
     * Teto do texto devolvido. O backend corta em ~2000; ficar abaixo evita corte
     * no meio.
     */
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

    // Query fixa não pode disputar chave com parâmetro `in: "query"`: qualquer
    // regra de precedência aqui seria uma que o próximo leitor teria de adivinhar.
    const queryParams = new Set(
      tool.params.filter((p) => p.in === "query").map((p) => p.name)
    );
    for (const key of Object.keys(tool.query)) {
      if (queryParams.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: `ferramenta "${tool.name}": "${key}" está em query fixa e em params ao mesmo tempo`
        });
      }
    }

    if (tool.resolve) {
      // Resolução SÓ em ferramenta escopada por cliente: ela existe para derivar
      // a chave interna a partir da identidade verificada, e numa ferramenta
      // `business` não há identidade — o salto pegaria o `identityParam` que a
      // regra proíbe existir.
      if (tool.scope !== "customer") {
        ctx.addIssue({
          code: "custom",
          message: `ferramenta "${tool.name}": resolve só existe em escopo customer`
        });
      }
      // O destino do valor resolvido não pode ser alcançável pelo modelo, nem
      // pela query fixa: um só dono para aquela chave.
      if (queryParams.has(tool.resolve.into) || tool.query[tool.resolve.into] !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: `ferramenta "${tool.name}": resolve.into "${tool.resolve.into}" colide com um parâmetro ou com a query fixa`
        });
      }
      // O salto monta a URL só com query; um `{placeholder}` ficaria literal.
      for (const match of tool.resolve.path.matchAll(/\{([^}]+)\}/g)) {
        ctx.addIssue({
          code: "custom",
          message: `ferramenta "${tool.name}": resolve.path não aceita {${match[1]}}`
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
export type TenantResolve = z.infer<typeof ResolveSchema>;
export type ParamTransform = z.infer<typeof ParamTransformSchema>;

/**
 * Aplica a normalização declarada no parâmetro. Pura e total — o valor sai
 * sempre string, e string vazia significa "não mande este parâmetro".
 */
export function applyTransform(value: string, transform?: ParamTransform): string {
  if (!transform) return value;
  const digits = value.replace(/\D+/g, "");
  if (transform === "digits") return digits;
  // `br_local`: 12–13 dígitos começando em `55` é E.164 brasileiro (DDI + DDD de
  // 2 + assinante de 8 ou 9). Fora dessa janela o número já está local, e cortar
  // dois dígitos dele seria estragar um cadastro que estava certo — é o caso do
  // DDD 55, que tem 11 dígitos e começa igual.
  if (digits.length >= 12 && digits.length <= 13 && digits.startsWith("55")) {
    return digits.slice(2);
  }
  return digits;
}

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
