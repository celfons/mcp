import { parseManifest, type ManifestParseResult, type TenantManifest } from "../manifest";

/**
 * O PRESET do CARRO (`celfons/carro`) — o marketplace de carros usados.
 *
 * Por que ele existe, e por que aqui. O `celfons/carro` e o `celfons/whatsapp`
 * são dois produtos, e o encontro deles é um só momento: **quando dá match, a
 * compradora é levada a uma conversa no WhatsApp atendida pela plataforma de
 * agentes**, e essa conversa não vale nada se o agente não souber de que carro
 * ela está falando. O dado tem de chegar AO VIVO, dentro do turno — anúncio muda
 * de preço, sai do ar, é vendido.
 *
 * A alternativa era a plataforma aprender o carro: um cliente HTTP, um contrato,
 * um segredo, uma migração de tabela e um caminho de leitura a manter em dia com
 * um repositório que ela não versiona. Este arquivo é a recusa disso. Ele
 * descreve a API do carro como ferramentas MCP, e a plataforma não ganha uma
 * linha de código do carro: para ela, isto aqui é um servidor MCP como qualquer
 * outro, com a proteção que ela já tem (seleção por LLM, política de escopo,
 * sobrescrita do identificador pelo telefone verificado, orçamento de tempo,
 * sanitização, métricas de degradação) valendo sem alteração nenhuma.
 *
 * Como o preset da EVO, ele **não é um caminho de gravação paralelo**: ele EMITE
 * um manifesto e o passa pelo mesmo `parseManifest`, então não consegue produzir
 * nada que o gateway não aceitaria de um JSON colado à mão. A fronteira continua
 * sendo uma só.
 *
 * ## O que o carro obriga, e como cada obrigação é atendida
 *
 * 1. **Auth é bearer com o `CHATBOT_TOKEN`.** É o mesmo segredo que o carro
 *    exige em `exigirCredencialDoAtendimento`, e a rota de leitura é
 *    **fail-closed sem ele**: `CHATBOT_TOKEN` vazio no ambiente do carro nega
 *    tudo, nunca "aceita porque não há segredo". Do nosso lado isso significa
 *    que um preset gravado sem token não degrada em consulta aberta — degrada em
 *    401, que é o desfecho certo.
 *
 * 2. **O telefone vai COM DDI.** Ver `IDENTITY_TRANSFORM`, abaixo. É a única
 *    decisão deste arquivo que diverge do preset da EVO, e a que erra em
 *    silêncio se estiver errada.
 *
 * 3. **A leitura do lead já é endereçável pelo telefone verificado**, então não
 *    há `resolve`. O salto de resolução existe para APIs que keyam por um id
 *    interno (`/receivables?memberId=`); aqui a rota aceita o telefone
 *    diretamente, e um salto a mais seria latência sem contrapartida.
 *
 * 4. **A resposta do lead é `{ "lead": … }` ou `{ "lead": null }`.** Daí
 *    `root: ["lead"]`, com **um candidato só**: o envelope é conhecido e
 *    estável, então não há forma a adivinhar. (Os vários candidatos do preset da
 *    EVO existem porque lá a resposta pode vir como objeto ou como lista, em
 *    `list` ou em `lista` — aqui, não.) Sem lead nenhum campo declarado é
 *    encontrado e o gateway responde "Nenhum dado encontrado para esta
 *    consulta." — a degradação certa: o agente segue a conversa sabendo que não
 *    achou, em vez de o leg cair ou de o envelope escorrer para o prompt.
 *
 * ## O que este preset deliberadamente NÃO faz
 *
 * **Escrita.** O carro tem `POST /api/handoffs/matches/:matchId` (abrir a
 * ponte), `POST /api/handoffs/resgatar` (retirar o dossiê) e o webhook de
 * triagem. Nenhum entra aqui. O ADR-0036 §2.3 contrata LEITURA, e é essa
 * contratação que dispensa a reserva de idempotência: a entrega do turno é
 * at-least-once, então um turno reentregue repete a consulta. Repetir leitura
 * custa tempo; repetir a retirada de um dossiê consome um código de referência.
 *
 * **O dossiê.** `POST /api/handoffs/resgatar` devolve nome, telefone, citações
 * da compradora e a classe de prontidão — é o pacote do **atendimento humano**,
 * e o produto já decidiu que ele é *puxado* com um código, sob dupla
 * autorização. Nada disso tem razão para entrar no prompt de um LLM: o agente
 * está falando COM a compradora, e não precisa do que o carro sabe sobre ela
 * para conversar sobre o carro.
 *
 * ## Verificar na ativação (não dá para saber daqui)
 *
 * - **`GET /api/handoffs/lead?telefone=` ainda não existe no `main` do carro**
 *   (conferido em `b46728a`: há `/leads`, a listagem interna paginada, e
 *   `/resgatar`). O caminho, o envelope `{lead:…}` e os nomes de campo abaixo
 *   vieram do contrato acordado com a fatia que a está criando. Se a ativação
 *   der 404, é esta rota que ainda não subiu — não o preset.
 * - **`triagem.status`**: o dossiê do carro chama a mesma coisa de
 *   `triagem.completude` (`completa`/`parcial`/`ausente`). Se a rota emitir
 *   `completude`, esta única linha da projeção some **sem erro nenhum** — é o
 *   modo de falha de todo caminho de campo errado.
 * - **Latência p95** de `/api/handoffs/lead`: tem de caber em `timeoutMs`, que
 *   fica abaixo do teto do backend (4 s).
 */

/** O host do Worker do carro — o mesmo que serve a API pública do marketplace. */
export const CARRO_BASE_URL = "https://carro.marcelfons.workers.dev";

/**
 * A normalização do telefone antes de ele virar filtro no carro.
 *
 * **`digits`, e não `br_local`** — é aqui que este preset diverge do da EVO, e a
 * divergência é a coisa mais importante do arquivo. Chega o `wa_id` da Meta:
 * E.164 em dígitos, com DDI e sem `+` (`5534999530186`). O carro guarda o
 * telefone da compradora em `users.phone_e164` — **com DDI**, como o nome da
 * coluna diz. `digits` tira máscara, `+`, espaço e parêntese e entrega
 * exatamente o que está gravado lá.
 *
 * `br_local` (o transform da EVO, que existe porque ERP brasileiro modela o DDI
 * como campo separado) cortaria o `55` e a busca casaria **zero registros**. E o
 * modo de falha é o pior possível: nada quebra, o leg degrada em `empty_result`,
 * e a conclusão de quem olha é "a integração não funciona".
 *
 * **É a suposição nº 1 a revisar** se nenhuma consulta achar ninguém — trocar é
 * uma linha aqui.
 */
const IDENTITY_TRANSFORM = "digits" as const;

/**
 * O parâmetro de identidade, idêntico em toda ferramenta `customer`.
 *
 * O nome é `telefone` porque é assim que o carro chama o filtro, e ele vai
 * direto para o fio. Uma **constante única** porque a divergência de grafia
 * entre este manifesto e a `tool_policy` do outro lado é invisível: a plataforma
 * não escreve o telefone verificado no parâmetro "certo", escreve no que a
 * política **nomear** (ADR-0036 §2). Se a política dissesse `phone` e o
 * manifesto declarasse `telefone`, o argumento chegaria com o nome errado e a
 * ferramenta sairia **sem filtro de identidade**.
 *
 * Hoje o que segura essa borda é `required: true` — o gateway recusa a chamada
 * em `missingRequired` antes de tocar o fio, e o desfecho é uma frase, não um
 * vazamento. Mas isso é um freio **acidental**: bastaria alguém tornar o
 * parâmetro opcional para a consulta sair até o carro sem dizer de quem ela é, e
 * aí o que responde é a rota, não nós. Derivar os dois documentos da mesma
 * constante torna a divergência **inexprimível** em vez de vigiada — é o método
 * do ADR-0033, e é `carroToolPolicy()` que mantém os dois lados dizendo o mesmo
 * nome.
 */
const IDENTITY_PARAM_NAME = "telefone";

const IDENTITY_PARAM = {
  name: IDENTITY_PARAM_NAME,
  in: "query" as const,
  required: true,
  description: "Telefone do cliente — escrito pela plataforma, nunca pelo modelo.",
  transform: IDENTITY_TRANSFORM
};

export interface CarroPresetInput {
  /** O mesmo id sob o qual o manifesto é gravado no KV. */
  tenantId: string;
  /** Nome legível do tenant. Vai para o nome do servidor MCP, nunca para o prompt. */
  label?: string;
  /** O `CHATBOT_TOKEN` do carro — a credencial do atendimento. Sem ela a rota nega tudo. */
  chatbotToken: string;
  /** Host alternativo (um ambiente de teste do carro). Ausente = produção. */
  baseUrl?: string;
  /** Orçamento de parede da ferramenta. Ausente = o default abaixo. */
  timeoutMs?: number;
}

/**
 * Monta o manifesto do carro deste tenant e o valida.
 *
 * Devolve `ManifestParseResult` — e não o manifesto direto — de propósito: se um
 * dia uma mudança aqui produzir algo que o esquema recusa, o erro aparece na
 * gravação, com nome, em vez de na primeira pergunta de uma compradora.
 */
export function buildCarroManifest(input: CarroPresetInput): ManifestParseResult {
  return parseManifest({
    tenantId: input.tenantId,
    label: input.label?.trim() || "Carro",
    baseUrl: input.baseUrl ?? CARRO_BASE_URL,
    // O `CHATBOT_TOKEN` do carro. Fica no manifesto (cifrado em repouso pelo KV
    // do Worker) e nunca volta numa resposta admin — ver `getManifest`.
    auth: { type: "bearer", token: input.chatbotToken },
    // Mais folgado que o teto do esquema (3500) e bem abaixo do `MCP_TIMEOUT_MS`
    // (4 s) do backend. Menor que os 3400 da EVO porque aqui é **um salto só**,
    // sem resolução — e o tempo que esta consulta não gasta é tempo que o turno
    // usa para a chamada de LLM que vem depois dela.
    timeoutMs: input.timeoutMs ?? 2500,
    tools: [
      // ---- O coração: o carro do match desta compradora -------------------
      {
        name: "carro_lead_do_comprador",
        description:
          "O carro pelo qual esta cliente entrou em contato: marca, modelo, versão, ano, km, preço, cidade e a situação do anúncio.",
        method: "GET",
        path: "/api/handoffs/lead",
        scope: "customer",
        identityParam: IDENTITY_PARAM_NAME,
        params: [IDENTITY_PARAM],
        // `{ "lead": … }` ou `{ "lead": null }` — um candidato só, porque o
        // envelope é conhecido (item 4 do cabeçalho).
        root: ["lead"],
        // A allowlist do que o agente pode dizer em voz alta. O que ficou de
        // fora ficou por razão, não por esquecimento: `handoff_id` e `match_id`
        // são chave interna (o modelo não tem o que fazer com elas, e uma chave
        // no prompt é uma chave que pode ser repetida ao cliente),
        // `codigo_expira_em` e `consentimento` são metadado de processo, e o
        // bloco `contato` é a PII da própria pessoa com quem o agente já está
        // falando.
        fields: [
          { path: "veiculo.marca", label: "Marca" },
          { path: "veiculo.modelo", label: "Modelo" },
          { path: "veiculo.versao", label: "Versão" },
          { path: "veiculo.ano", label: "Ano" },
          { path: "veiculo.km", label: "Km" },
          // O rótulo carrega a UNIDADE porque a projeção não tem formatador: ela
          // emite o escalar como veio. "Preço: 11990000" é como um agente cota um
          // carro de R$ 119.900,00 na casa dos milhões.
          { path: "veiculo.preco_centavos", label: "Preço (em centavos de real)" },
          { path: "veiculo.cidade", label: "Cidade" },
          { path: "veiculo.uf", label: "UF" },
          { path: "anuncio.status", label: "Situação do anúncio" },
          { path: "triagem.status", label: "Situação da triagem" }
        ],
        maxChars: 700
      },

      // ---- Sobre o ANÚNCIO — o que já é público no marketplace -------------
      {
        name: "carro_anuncio_publico",
        description:
          "Detalhes de um anúncio publicado, pelo id: versão, câmbio, combustível, cor, estado, preço e localização.",
        method: "GET",
        // `/publico` serve **só** anúncio `publicado`: rascunho, em análise,
        // pausado, vendido e recusado respondem 404 igual a id inexistente. O
        // agente não consegue detalhar um carro que saiu do ar — que é a regra
        // do marketplace, herdada de graça.
        path: "/api/listings/{id}/publico",
        // `business` e não `customer`: a resposta não fala de pessoa alguma, é a
        // mesma projeção que qualquer visitante do site vê. E escopo `business`
        // **não pode** declarar `identityParam` — o esquema recusa a contradição
        // em vez de resolvê-la em silêncio.
        scope: "business",
        params: [
          {
            name: "id",
            in: "path" as const,
            required: true,
            description: "Id do anúncio, como aparece no link do carro."
          }
        ],
        root: ["anuncio"],
        // Três ausências deliberadas nesta lista:
        //
        //  · `placa_mascarada`, `fotos` e qualquer coisa de posição — PII e
        //    ruído; a coordenada nem existe nesta projeção, e a placa não tem o
        //    que fazer numa conversa;
        //  · `descricao` — é texto livre que o VENDEDOR escreveu. Texto de
        //    terceiro que entra no prompt é superfície de injeção, e o agente
        //    não precisa dele para detalhar o veículo;
        //  · `historico`, `aviso_cautela` e `preco_referencia_centavos` — no
        //    contrato do carro, `historico: null` significa "não consultado" e
        //    `[]` significa "consultado, nada encontrado", e a projeção não
        //    distingue os dois: ela emitiria nada nos dois casos. Um agente que
        //    não vê restrição nenhuma soa como quem disse que não há — e a
        //    Regra 26 de lá é exatamente que **silêncio nunca vira boa notícia**.
        //    Preço de referência e aviso de cautela são a mesma classe: leitura
        //    do mercado, que o marketplace renderiza com a copy dele.
        fields: [
          { path: "marca", label: "Marca" },
          { path: "modelo", label: "Modelo" },
          { path: "versao", label: "Versão" },
          { path: "ano", label: "Ano" },
          { path: "km", label: "Km" },
          { path: "preco_centavos", label: "Preço (em centavos de real)" },
          { path: "cambio", label: "Câmbio" },
          { path: "combustivel", label: "Combustível" },
          { path: "cor", label: "Cor" },
          { path: "estado_geral", label: "Estado geral" },
          { path: "cidade", label: "Cidade" },
          { path: "uf", label: "UF" },
          { path: "aceita_proposta", label: "Aceita proposta" },
          { path: "aceita_troca", label: "Aceita troca" },
          { path: "verificado", label: "Placa verificada" }
        ],
        maxChars: 900
      }
    ]
  });
}

export type ToolRule = { scope: "customer"; identityParam: string } | { scope: "business" };
export type ToolPolicyDocument = { tools: Record<string, ToolRule> };

/**
 * A `tool_policy` para colar em
 * `PUT /api/admin/tenants/{tenantId}/mcp-server` da plataforma.
 *
 * Ela é DERIVADA do manifesto que acabou de ser montado — não reconstruída a
 * partir da mesma receita. A diferença importa: os dois documentos moram em
 * repositórios diferentes e têm de concordar (consulta anunciada aqui e não
 * classificada lá nasce inchamável, e o dono só descobre pela métrica), e
 * derivar torna a divergência **inexprimível** em vez de vigiada por um teste.
 *
 * ⚠ **O dialeto é o da BORDA da plataforma, não o do banco dela.** São dois, e
 * eles não são iguais: a API admin recebe `identityParam` em camelCase e sem
 * `version`; o `serializeToolPolicy` de lá é que converte para
 * `{version:1, …, identity_param}` ao gravar. Emitir a forma persistida faria a
 * primeira ativação bater num 400 de validação. O que este preset promete é um
 * documento COLÁVEL; um que precisa de tradução manual não cumpre a promessa e
 * reabre a transcrição que ele existe para eliminar.
 */
export function carroToolPolicy(manifest: TenantManifest): ToolPolicyDocument {
  const tools: Record<string, ToolRule> = {};
  for (const tool of manifest.tools) {
    tools[tool.name] =
      tool.scope === "customer"
        ? { scope: "customer", identityParam: tool.identityParam ?? IDENTITY_PARAM_NAME }
        : { scope: "business" };
  }
  return { tools };
}
