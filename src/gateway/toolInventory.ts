/**
 * O inventário fechado dos endpoints — quem pode chamá-los, e por quê.
 *
 * REGRA DA FUNDAÇÃO §4: nada entra sem entrada declarada, e a entrada carrega a
 * RAZÃO escrita. É a catraca no NASCIMENTO (travar a morte é indecidível;
 * travar o nascimento não), e a razão é o que impede o inventário de virar
 * carimbo — quem adiciona responde "quem é o dono deste dado?" antes do merge,
 * não três anos depois.
 *
 * REGRA DA FUNDAÇÃO §5: `read` e `write` são classes separadas, declaradas, não
 * inferidas do nome. Erro de leitura mostra dado errado; erro de escrita muda o
 * mundo de outra pessoa — publica um post, gasta orçamento, altera um pedido —
 * e nem sempre é reversível.
 *
 * REGRA DA FUNDAÇÃO §3, e é a que decide o caso mais perigoso deste arquivo:
 * nenhuma tool alcança o cliente final. O endpoint de WhatsApp existe para a
 * operação PRÓPRIA e é `tenantCallable: false` — um agente com acesso a
 * `whatsapp_send_message` contorna, numa chamada, o motor de conformidade
 * inteiro da plataforma (opt-out fail-closed, teto diário por número, regime de
 * canal, auditoria por envio). Não é "usar com cuidado": é um caminho paralelo,
 * e caminho paralelo é o que se descobre depois que o número foi banido.
 *
 * ADVERTÊNCIA DE ESCRITA (herdada de quem pagou por ela): o comentário aqui
 * explica POR QUÊ; ele nunca repete um número que o teste já verifica. No
 * sistema irmão, dois inventários passaram meses verdes com a prosa mentindo —
 * a asserção travava 4, o texto dizia 5. Duas fontes de verdade para o mesmo
 * fato, e a que ninguém checa deriva.
 */

/** O que a família de tools faz com o mundo. Fechado — vira tag de métrica. */
export type ToolClass = "read" | "write";

export interface EndpointPolicy {
  /**
   * `false` = existe só para a operação própria (operador via Access), nunca
   * para um turno de cliente. Ver §3.
   */
  readonly tenantCallable: boolean;
  /** A classe mais PERMISSIVA presente no endpoint — `write` contamina o conjunto. */
  readonly toolClass: ToolClass;
  /** Por que este endpoint existe, e por que com esta permissão. Mínimo 40 chars. */
  readonly why: string;
}

/**
 * Um endpoint por linha. Endpoint novo em `SERVERS` sem entrada aqui quebra o
 * CI — é isso que torna a regra verificável em vez de recomendada.
 */
export const ENDPOINT_POLICY: Record<string, EndpointPolicy> = {
  "/mcp": {
    tenantCallable: false,
    toolClass: "write",
    why: "(W) O agregado registra TODAS as famílias, inclusive as de escrita e a do canal de WhatsApp. Um endpoint que muda de superfície quando alguém adiciona um módulo não pode ser apontado para um tenant — a permissão dele passaria a incluir o que ninguém revisou. Operação própria apenas; um tenant recebe o endpoint estreito do provedor que ele contratou.",
  },
  "/mcp/instagram": {
    tenantCallable: false,
    toolClass: "write",
    why: "(W) Publica e altera conteúdo numa conta comercial. Escrita irreversível na presença pública de um negócio, e hoje sobre credencial de FROTA — nenhum tenant pode alcançá-la enquanto a credencial não for resolvida por tenant.",
  },
  "/mcp/facebook": {
    tenantCallable: false,
    toolClass: "write",
    why: "(W) Mesma classe do Instagram: publica em Página, sobre credencial de frota. Escrita na presença pública do negócio.",
  },
  "/mcp/x": {
    tenantCallable: false,
    toolClass: "write",
    why: "(W) Publica e apaga posts com token de usuário. Escrita pública e irreversível, sobre credencial de frota.",
  },
  "/mcp/whatsapp": {
    tenantCallable: false,
    toolClass: "write",
    why: "(W) EXCLUSÃO PERMANENTE do conjunto chamável por tenant (fundação §3): envia mensagem ao cliente final e, com isso, contorna o motor de conformidade da plataforma — opt-out fail-closed, teto por número, regime de canal, auditoria. Existe aqui para a operação própria; a plataforma jamais deve apontar um tenant para este endpoint.",
  },
  "/mcp/google": {
    tenantCallable: false,
    toolClass: "write",
    why: "(W) Agregado de quatro famílias Google, incluindo Ads — que GASTA DINHEIRO. Mesma objeção do `/mcp`: superfície que cresce sem revisão não pode carregar permissão de tenant.",
  },
  "/mcp/google-business": {
    tenantCallable: false,
    toolClass: "write",
    why: "(W) Responde avaliações e publica posts na ficha do Google — escrita pública em nome do negócio, sobre credencial de frota.",
  },
  "/mcp/youtube": {
    tenantCallable: false,
    toolClass: "write",
    why: "(W) Opera canal e vídeos com credencial de frota. Escrita pública.",
  },
  "/mcp/google-ads": {
    tenantCallable: false,
    toolClass: "write",
    why: "(W) Cria e altera campanhas: a única família aqui cujo erro CUSTA DINHEIRO diretamente, e onde 'reverter' não devolve a verba gasta. Operação própria, sempre.",
  },
  "/mcp/google-analytics": {
    tenantCallable: false,
    toolClass: "read",
    why: "(R) Só relatórios (Data API e Admin API de leitura). É a família de menor risco do repositório e, por isso, a candidata natural ao primeiro caso de leitura por tenant — QUANDO a credencial for resolvida por tenant, e não antes.",
  },
};

/** Os endpoints que um tenant pode alcançar hoje. Ver §3 — a lista vazia é o estado correto. */
export const tenantCallableEndpoints = (): readonly string[] =>
  Object.entries(ENDPOINT_POLICY)
    .filter(([, p]) => p.tenantCallable)
    .map(([path]) => path)
    .sort();
