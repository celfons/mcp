import { parseManifest, type ManifestParseResult, type TenantManifest } from "../manifest";

/**
 * O PRESET da EVO (W12) — o sistema de gestão de academia.
 *
 * Por que um preset, e não um manifesto colado por academia. O manifesto por
 * tenant existe para a API que só aquele cliente tem: um ERP feito sob medida,
 * cujo contrato ninguém além dele conhece. A EVO é o oposto — é uma API FIXA,
 * a mesma para todas as academias que a usam. Cadastrar 250 linhas de JSON por
 * academia produziria divergência entre clientes que deveriam ser idênticos e,
 * pior, nenhum lugar onde corrigir todo mundo quando a W12 mudar um campo.
 *
 * Este arquivo é esse lugar. Ele não é um caminho alternativo de gravação: ele
 * EMITE um manifesto e o passa pelo mesmo `parseManifest`, então o preset não
 * consegue produzir nada que o gateway não aceitaria de um JSON colado à mão.
 * A fronteira continua sendo uma só.
 *
 * ## O que a EVO obriga, e como cada obrigação é atendida
 *
 * 1. **Auth é Basic**, DNS da unidade como usuário e a secret key como senha
 *    (`securitySchemes.Basic` no swagger). Vira `auth: { type: "header" }` com
 *    o valor já montado — o esquema do manifesto não precisa saber o que é
 *    Basic.
 *
 * 2. **Só a busca de cliente é endereçável por telefone.** `/members/basic`
 *    aceita `phone`; `/receivables` keya por `memberId` e
 *    `/activities/schedule` por `idMember`. Como a plataforma só conhece o
 *    telefone verificado, as duas últimas usam o salto `resolve` — é por isso
 *    que ele existe.
 *
 * 3. **O telefone da plataforma não é o telefone da EVO.** Chega `wa_id` da
 *    Meta (E.164 com DDI, `5534999530186`); a EVO modela o DDI como campo
 *    separado do número (`TelefoneApiViewModel.ddi`), o que diz que o número
 *    está guardado em formato local. Daí `transform: "br_local"` em todo
 *    `identityParam`. **É a suposição mais frágil deste arquivo** — ver
 *    "Verificar na ativação", abaixo.
 *
 * 4. **A forma da resposta não é confiável no swagger.** `/members/basic` está
 *    declarado como objeto mas aceita `take`/`skip`, o que é uma lista;
 *    `/receivables` embrulha em `{ qtde, list, lista }` com dois nomes para a
 *    mesma coisa. Daí os candidatos em `root` e em `resolve.extract`.
 *
 * 5. **`/members/basic` em vez de `/api/v2/members`** — e não é preferência de
 *    estilo. O v2 devolve `cpf`, `document`, `address`, `zipCode`,
 *    `birthDate`, `photoUrl`; o basic não tem nenhum deles. Projeção estreita
 *    protege o prompt, mas o que não sai da EVO não precisa de projeção: é uma
 *    camada de PII a menos atravessando o fio (P-8 do lado da plataforma).
 *
 * ## O que este preset deliberadamente NÃO faz
 *
 * **Escrita.** Matricular em aula (`POST /activities/schedule/enroll`), criar
 * prospect, agendar experimental — todos existem na EVO e nenhum entra aqui. O
 * ADR-0036 §2.3 contrata LEITURA, e é essa contratação que dispensa reserva de
 * idempotência: a entrega do turno é at-least-once, então um turno reentregue
 * repete a consulta. Repetir leitura custa tempo; repetir matrícula cria duas.
 * Escrita é outra feature, e ela reabre o P-3.
 *
 * ## Verificar na ativação (não dá para saber daqui)
 *
 * - **Semântica do filtro `phone`** em `/members/basic`: exato, parcial, com ou
 *   sem máscara? Se a academia guardar o número COM DDI, o transform correto é
 *   `digits` — trocar é uma linha em `PHONE_TRANSFORM`.
 * - **`idBranch`** numa rede multi-unidade: passe-o em `EvoPresetInput` para
 *   pinar a unidade daquele tenant. Sem ele, a EVO responde pelo escopo do
 *   token.
 * - **Latência p95** de `/members/basic` + `/receivables`: os dois saltos têm
 *   de caber em `timeoutMs`, que fica abaixo do teto do backend (4 s).
 */

/** O host da API de integração da EVO — o mesmo `servers[0].url` do swagger. */
export const EVO_BASE_URL = "https://evo-integracao-api.w12app.com.br";

/**
 * A normalização do telefone antes de ele virar filtro na EVO. Ver o item 3 do
 * cabeçalho: é a suposição a revisar primeiro quando uma academia ativar e
 * nenhuma consulta escopada achar ninguém.
 */
const PHONE_TRANSFORM = "br_local" as const;

/** Onde a chave interna do aluno é lida na resposta de `/members/basic`. */
const MEMBER_ID_CANDIDATES = ["[0].idMember", "idMember", "list[0].idMember"];

/** O salto que troca telefone verificado por `idMember`, reusado por três ferramentas. */
const memberResolve = (into: string) => ({
  path: "/api/v1/members/basic",
  param: "phone",
  query: { take: "1" },
  extract: MEMBER_ID_CANDIDATES,
  into
});

/**
 * O parâmetro de identidade, idêntico em toda ferramenta `customer`.
 *
 * O nome é `phone` porque é assim que a EVO chama o filtro em `/members/basic`,
 * e nas ferramentas SEM salto de resolução esse nome vai direto para o fio. Um
 * nome diferente (`telefone`, digamos) não daria erro: a EVO ignoraria o
 * parâmetro desconhecido e responderia a busca SEM filtro — com `take=1`, o
 * primeiro aluno da academia, devolvido a quem quer que tenha perguntado. Um
 * vazamento entre clientes do mesmo tenant produzido por uma diferença de
 * grafia, sem uma linha de erro em lugar nenhum.
 *
 * A plataforma não se importa com o nome: ela escreve o identificador no
 * parâmetro que o `identityParam` nomear (ADR-0036 §2). O que ela exige é que a
 * ferramenta o DECLARE — e é `evoToolPolicy()` que mantém os dois lados
 * dizendo o mesmo nome.
 */
const IDENTITY_PARAM_NAME = "phone";

const IDENTITY_PARAM = {
  name: IDENTITY_PARAM_NAME,
  in: "query" as const,
  required: true,
  description: "Telefone do cliente — escrito pela plataforma, nunca pelo modelo.",
  transform: PHONE_TRANSFORM
};

/**
 * Que classe de consulta esta academia anuncia.
 *
 * `"business"` existe para a ativação que só quer preço, plano e grade — a
 * primeira que a maioria das academias vai querer. As consultas sobre o ALUNO
 * (plano dele, cobranças, aulas marcadas) simplesmente não são anunciadas, e
 * com isso o telefone do cliente **nunca sai do perímetro**: o dever de aviso
 * do ADR-0036 (o identificador saindo para um servidor de terceiro) some junto,
 * porque o fato que o originava deixa de acontecer.
 *
 * Dava para chegar perto disso só pela `tool_policy` do lado da plataforma —
 * consulta sem regra é inchamável, e o modelo nem a vê. Mas ela seguiria sendo
 * ANUNCIADA e recusada a cada turno, somando em `scope_refused/unclassified`:
 * a métrica que existe para gritar "o dono esqueceu de classificar" passaria a
 * gritar num estado que é intencional. Alerta falso é o que ensina a ignorar
 * alerta — então o desligamento acontece onde a consulta nasce.
 */
export type EvoToolSet = "all" | "business";

export interface EvoPresetInput {
  /** O mesmo id sob o qual o manifesto é gravado no KV. */
  tenantId: string;
  /** Nome legível da academia. Vai para o nome do servidor MCP, nunca para o prompt. */
  label?: string;
  /** O DNS da unidade na EVO — o "usuário" do Basic. */
  dns: string;
  /** A secret key da EVO — a "senha" do Basic. Vale 2 anos a partir da emissão. */
  secretKey: string;
  /** Unidade a pinar numa rede multi-unidade. Ausente = o escopo do próprio token. */
  idBranch?: number;
  /** Orçamento de parede da ferramenta INTEIRA (os dois saltos). */
  timeoutMs?: number;
  /** Que classe de consulta anunciar. Default `"all"`. */
  include?: EvoToolSet;
}

/** Basic auth em base64, sobre os bytes UTF-8 (e não sobre code points). */
export function basicAuthValue(user: string, password: string): string {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

/**
 * Monta o manifesto EVO deste tenant e o valida.
 *
 * Devolve `ManifestParseResult` — e não o manifesto direto — de propósito: se um
 * dia uma mudança aqui produzir algo que o esquema recusa, o erro aparece na
 * gravação, com nome, em vez de na primeira pergunta de um cliente.
 */
export function buildEvoManifest(input: EvoPresetInput): ManifestParseResult {
  const branch = input.idBranch === undefined ? {} : { idBranch: String(input.idBranch) };
  const label = input.label?.trim() || "EVO";
  // A filtragem é por `scope` declarado, e não por uma segunda lista de nomes:
  // uma consulta nova entra na classe dela e o recorte a acompanha sozinho. Uma
  // lista paralela seria mais um documento para esquecer de atualizar.
  const keep = (scope: string): boolean => input.include !== "business" || scope === "business";

  return parseManifest({
    tenantId: input.tenantId,
    label,
    baseUrl: EVO_BASE_URL,
    auth: {
      type: "header",
      name: "Authorization",
      value: basicAuthValue(input.dns, input.secretKey)
    },
    // Abaixo do teto de 4 s que o backend concede a uma chamada, com folga para
    // os dois saltos das ferramentas que resolvem.
    timeoutMs: input.timeoutMs ?? 3400,
    tools: [
      // ---- Escopadas no aluno -------------------------------------------
      {
        name: "evo_meu_cadastro",
        description: "Situação do cadastro do aluno na academia: nome, status, unidade e último acesso.",
        path: "/api/v1/members/basic",
        scope: "customer",
        identityParam: IDENTITY_PARAM_NAME,
        params: [IDENTITY_PARAM],
        query: { take: "1", ...branch },
        // O swagger declara objeto; a busca paginada devolve lista. Cobre as duas.
        root: ["[0]", "$"],
        fields: [
          { path: "firstName", label: "Nome" },
          { path: "membershipStatus", label: "Situação do plano" },
          { path: "status", label: "Status do cadastro" },
          { path: "branchName", label: "Unidade" },
          { path: "accessBlocked", label: "Acesso bloqueado" },
          { path: "blockedReason", label: "Motivo do bloqueio" },
          { path: "lastAccessDate", label: "Último acesso" }
        ],
        maxChars: 700
      },
      {
        name: "evo_meu_plano",
        description: "Plano contratado pelo aluno: nome, vigência, situação, próxima cobrança e valor.",
        path: "/api/v1/members/basic",
        scope: "customer",
        identityParam: IDENTITY_PARAM_NAME,
        params: [IDENTITY_PARAM],
        query: { take: "1", ...branch },
        // `MembersBasicApiViewModel.memberships` já vem embutido, então o plano
        // NÃO precisa de salto: uma consulta, keyada pelo telefone.
        root: ["[0]", "$"],
        fields: [
          { path: "memberships[].name", label: "Plano" },
          { path: "memberships[].membershipStatus", label: "Situação" },
          { path: "memberships[].startDate", label: "Início" },
          { path: "memberships[].endDate", label: "Término" },
          { path: "memberships[].nextCharge", label: "Próxima cobrança" },
          { path: "memberships[].valueNextMonth", label: "Valor" }
        ],
        maxChars: 900
      },
      {
        name: "evo_minhas_cobrancas",
        description: "Cobranças do aluno: descrição, vencimento, valor e situação de pagamento.",
        path: "/api/v1/receivables",
        scope: "customer",
        identityParam: IDENTITY_PARAM_NAME,
        params: [IDENTITY_PARAM],
        query: { take: "10", ...branch },
        resolve: memberResolve("memberId"),
        // `ReceivablesApiViewModelListGridComQtdeViewModel` traz `list` e `lista`
        // — a EVO preenche um ou outro conforme a rota.
        root: ["list", "lista", "$"],
        fields: [
          { path: "[].description", label: "Cobrança" },
          { path: "[].dueDate", label: "Vencimento" },
          { path: "[].ammount", label: "Valor" },
          { path: "[].status.name", label: "Situação" }
        ],
        maxChars: 1200
      },
      {
        name: "evo_meus_servicos",
        description: "Serviços que o aluno contratou além do plano (avaliação, personal, day use).",
        path: "/api/v1/members/services",
        scope: "customer",
        identityParam: IDENTITY_PARAM_NAME,
        params: [IDENTITY_PARAM],
        query: { ...branch },
        resolve: memberResolve("idMember"),
        root: ["$"],
        fields: [{ path: "[].nameService", label: "Serviço" }],
        maxChars: 600
      },
      {
        name: "evo_minha_frequencia",
        description: "Quando o aluno entrou na academia — histórico de acessos dele.",
        path: "/api/v1/entries",
        scope: "customer",
        identityParam: IDENTITY_PARAM_NAME,
        params: [
          IDENTITY_PARAM,
          {
            name: "registerDateStart",
            in: "query",
            description: "Início do período no formato AAAA-MM-DD, quando o cliente citar um."
          }
        ],
        query: { take: "20" },
        resolve: memberResolve("idMember"),
        root: ["$"],
        // `EntradasResumoApiViewModel` traz `nameMember`, `nameProspect` e
        // `nameEmployee`, e sem `idMember` esta rota devolve as entradas de TODO
        // MUNDO com nome. A resolução garante o filtro; não projetar os nomes é
        // a segunda camada — é o histórico do próprio dono do telefone, então
        // nenhum nome precisa viajar para a resposta fazer sentido.
        fields: [
          { path: "[].date", label: "Entrada" },
          { path: "[].entryType", label: "Tipo" }
        ],
        maxChars: 900
      },
      {
        name: "evo_minhas_aulas",
        description: "Aulas em que o aluno está inscrito, com data, horário e professor.",
        path: "/api/v1/activities/schedule",
        scope: "customer",
        identityParam: IDENTITY_PARAM_NAME,
        params: [IDENTITY_PARAM],
        query: { take: "10", ...branch },
        resolve: memberResolve("idMember"),
        root: ["$"],
        fields: [
          { path: "[].name", label: "Aula" },
          { path: "[].activityDate", label: "Data" },
          { path: "[].startTime", label: "Início" },
          { path: "[].instructor", label: "Professor" },
          { path: "[].statusName", label: "Situação" }
        ],
        maxChars: 1200
      },

      // ---- Sobre o NEGÓCIO — não falam de pessoa alguma -------------------
      {
        name: "evo_planos_e_precos",
        description: "Planos vendidos pela academia, com valor, duração e descrição.",
        path: "/api/v3/membership",
        scope: "business",
        params: [
          { name: "name", in: "query", description: "Filtra planos por nome, quando o cliente citar um." }
        ],
        query: { active: "true", take: "20", ...branch },
        root: ["$"],
        fields: [
          { path: "[].nameMembership", label: "Plano" },
          { path: "[].value", label: "Valor" },
          { path: "[].duration", label: "Duração" },
          { path: "[].durationType", label: "Unidade" },
          { path: "[].maxAmountInstallments", label: "Parcelas" }
        ],
        maxChars: 1500
      },
      {
        name: "evo_servicos_e_precos",
        description: "Serviços avulsos da academia (avaliação, personal, day use) e seus valores.",
        path: "/api/v1/service",
        scope: "business",
        params: [
          { name: "name", in: "query", description: "Filtra serviços por nome, quando o cliente citar um." }
        ],
        query: { active: "true", take: "20", ...branch },
        root: ["$"],
        fields: [
          { path: "[].nameService", label: "Serviço" },
          { path: "[].value", label: "Valor" },
          { path: "[].maxAmountInstallments", label: "Parcelas" }
        ],
        maxChars: 1200
      }
    ].filter((tool) => keep(tool.scope))
  });
}

export type ToolRule = { scope: "customer"; identityParam: string } | { scope: "business" };
export type ToolPolicyDocument = { tools: Record<string, ToolRule> };

/**
 * A `tool_policy` para colar em
 * `POST /api/admin/tenants/{tenantId}/mcp-server` da plataforma.
 *
 * Ela é DERIVADA do manifesto que acabou de ser montado — não reconstruída a
 * partir da mesma receita. A diferença importa: os dois documentos moram em
 * repositórios diferentes e têm de concordar (consulta anunciada aqui e não
 * classificada lá nasce inchamável, e o dono só descobre pela métrica), e
 * derivar torna a divergência **inexprimível** em vez de vigiada por um teste.
 * É o método do ADR-0033, e foi o que o recorte por classe cobrou na prática:
 * uma segunda receita teria de aprender o filtro sozinha, e a versão que
 * esquecesse dele emitiria regra para consulta que nem existe.
 *
 * ⚠ **O dialeto é o da BORDA da plataforma, não o do banco dela.** São dois, e
 * eles não são iguais: a API admin recebe `identityParam` em camelCase e sem
 * `version`; o `serializeToolPolicy` de lá é que converte para
 * `{version:1, …, identity_param}` ao gravar. Emitir a forma persistida faria a
 * primeira ativação bater num 400 de validação — e a versão anterior deste
 * arquivo fazia exatamente isso. O que este preset promete é um documento
 * COLÁVEL; um que precisa de tradução manual não cumpre a promessa e reabre a
 * transcrição que ele existe para eliminar.
 */
export function evoToolPolicy(manifest: TenantManifest): ToolPolicyDocument {
  const tools: Record<string, ToolRule> = {};
  for (const tool of manifest.tools) {
    tools[tool.name] =
      tool.scope === "customer"
        ? { scope: "customer", identityParam: tool.identityParam ?? IDENTITY_PARAM_NAME }
        : { scope: "business" };
  }
  return { tools };
}
