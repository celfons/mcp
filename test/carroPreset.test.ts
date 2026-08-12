import { describe, it, expect, vi, afterEach } from "vitest";
import { buildCarroManifest, carroToolPolicy, CARRO_BASE_URL } from "../src/tenant/presets/carro";
import { runTool } from "../src/tenant/gateway";

// ---------------------------------------------------------------------------
// O preset do CARRO (`celfons/carro`) — o marketplace de carros usados.
//
// O encaixe: quando dá match, a compradora é levada a uma conversa no WhatsApp
// atendida pela plataforma (`celfons/whatsapp`), que precisa ler o dado do carro
// AO VIVO, dentro do turno. Este preset é a ponte — e é o que faz a plataforma
// não ganhar uma linha de código do carro.
//
// Um preset é um gerador de manifesto, então há duas coisas que podem dar errado
// nele, e as duas são invisíveis até uma compradora perguntar:
//
//  1. **Ele emite algo que o esquema recusaria** — o tenant é cadastrado e a
//     ferramenta simplesmente não existe. Por isso `buildCarroManifest` devolve
//     `ManifestParseResult` e não o manifesto: a validação é o retorno.
//  2. **Ele discorda da `tool_policy`** que a plataforma grava do outro lado.
//     Ferramenta `customer` aqui e ausente lá nasce inchamável
//     (`unclassified`), e o dono só descobre pela métrica. Os dois documentos
//     saem do MESMO lugar, e este arquivo prova que continuam concordando.
//
// O terceiro risco é do DOMÍNIO, e é o mais caro: um erro de digitação num
// caminho de campo produz projeção vazia — silenciosa. Os caminhos abaixo vieram
// do contrato do carro (`DossieBase.veiculo`/`anuncio` em
// `api/src/dominios/handoff/dossie.ts` e `AnuncioPublico` em
// `packages/shared/src/contratos/listing.ts`).
// ---------------------------------------------------------------------------

const CHATBOT_TOKEN = "token-do-chatbot-do-carro";

const preset = (extra: Record<string, unknown> = {}) =>
  buildCarroManifest({ tenantId: "tnt_carro", chatbotToken: CHATBOT_TOKEN, ...extra });

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

/** O `wa_id` que a Meta entrega: E.164 em dígitos, com DDI e sem `+`. */
const WA_ID = "5534999530186";

/**
 * Uma resposta realista de `GET /api/handoffs/lead` — com tudo que o carro
 * devolve, inclusive o que NÃO pode chegar ao prompt.
 */
const LEAD = {
  lead: {
    handoff_id: "hnd_01JABCDEF",
    match_id: "mtc_01JXYZ",
    codigo_expira_em: "2026-08-13T18:00:00.000Z",
    consentimento: { registrado_em: "2026-08-12T10:00:00.000Z", versao: "v3" },
    veiculo: {
      listing_id: "lst_01JHONDA",
      marca: "Honda",
      modelo: "Civic",
      versao: "EXL 2.0",
      ano: 2019,
      km: 61000,
      preco_centavos: 11990000,
      cidade: "Uberlândia",
      uf: "MG"
    },
    anuncio: { listing_id: "lst_01JHONDA", status: "publicado" },
    contato: { primeiro_nome: "Camila", telefone_e164: "+5534999530186", cidade: "Uberlândia", uf: "MG" },
    triagem: { status: "concluida", coletado_em: "2026-08-12T10:05:00.000Z" }
  }
};


describe("o preset emite um manifesto que o esquema aceita", () => {
  it("valida inteiro, e a única classe de escopo é a amarrada ao cliente", () => {
    const built = preset();
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    // Só `customer`, e isso é o desenho: toda consulta deste preset fala de UMA
    // pessoa e é amarrada ao telefone que a plataforma verificou. Uma ferramenta
    // `business` aqui seria uma consulta que o MODELO endereça — foi assim que a
    // do anúncio público caiu no gate.
    expect(built.manifest.tools.map((t) => t.scope)).toEqual(["customer"]);
    expect(built.manifest.baseUrl).toBe(CARRO_BASE_URL);
  });

  it("autentica com o CHATBOT_TOKEN do carro em bearer — a rota de leitura é fail-closed sem ele", () => {
    const built = preset();
    if (!built.ok) throw new Error(built.error);
    expect(built.manifest.auth).toEqual({ type: "bearer", token: CHATBOT_TOKEN });
  });

  it("toda ferramenta customer DECLARA o parâmetro de identidade, e ele é `telefone`", () => {
    // A condição 3 do ADR-0036: regra `customer` cuja tool não declara o
    // `identityParam` é inchamável. Anunciá-la seria prometer uma consulta que o
    // backend recusa.
    const built = preset();
    if (!built.ok) throw new Error(built.error);
    for (const tool of built.manifest.tools) {
      if (tool.scope !== "customer") continue;
      expect(tool.identityParam).toBe("telefone");
      expect(tool.params.map((p) => p.name)).toContain("telefone");
    }
  });

  it("o telefone é normalizado com `digits` — NUNCA `br_local`, que comeria o DDI", () => {
    // Esta é a diferença que separa este preset do da EVO, e é a suposição nº 1
    // a revisar se nenhuma consulta achar ninguém. Chega o `wa_id` da Meta
    // (E.164 em dígitos, com DDI) e o carro guarda o telefone em
    // `users.phone_e164`, COM DDI. `br_local` cortaria o `55` e casaria zero
    // registros, em silêncio.
    const built = preset();
    if (!built.ok) throw new Error(built.error);
    for (const tool of built.manifest.tools) {
      if (tool.scope !== "customer") continue;
      const identidade = tool.params.find((p) => p.name === tool.identityParam);
      expect(identidade?.transform).toBe("digits");
      expect(identidade?.required).toBe(true);
      expect(identidade?.in).toBe("query");
    }
  });

  it("nenhuma ferramenta business carrega identidade", () => {
    const built = preset();
    if (!built.ok) throw new Error(built.error);
    for (const tool of built.manifest.tools) {
      if (tool.scope !== "business") continue;
      expect(tool.identityParam).toBeUndefined();
      expect(tool.params.map((p) => p.name)).not.toContain("telefone");
    }
  });

  it("é somente LEITURA — o ADR-0036 §2.3 é o que dispensa a reserva de idempotência", () => {
    // Um turno reentregue REPETE a consulta. Repetir leitura custa tempo; repetir
    // escrita cria duas. Se alguém acrescentar uma escrita aqui sem abrir a outra
    // feature, este teste é quem avisa.
    const built = preset();
    if (!built.ok) throw new Error(built.error);
    for (const tool of built.manifest.tools) expect(tool.method).toBe("GET");
  });

  it("INVENTÁRIO FECHADO: só este caminho, e nada mais", () => {
    // A allowlist é o desenho. Uma ferramenta nova que apareça aqui sem revisão
    // quebra este teste — que é o ponto: "já que estamos integrados, aproveita e
    // expõe também…" é como uma rota de listagem interna acaba no prompt de um
    // agente que fala com o público.
    //
    // A pergunta para uma rota nova: a resposta fala de UMA pessoa amarrada ao
    // telefone verificado, e o texto dela é saneado por quem sabe que é de
    // terceiro?
    const PERMITIDOS = ["/api/handoffs/lead"];

    const built = preset();
    if (!built.ok) throw new Error(built.error);
    expect(built.manifest.tools.map((t) => t.path).sort()).toEqual([...PERMITIDOS].sort());
    expect(built.manifest.tools).toHaveLength(1);
  });

  it("NÃO expõe o anúncio público — a ausência é decisão de segurança, não esquecimento", () => {
    // O gate de segurança derrubou `carro_anuncio_publico`. Ela parecia
    // inofensiva (é a mesma projeção que qualquer visitante do site vê) e não
    // era: `marca`/`modelo`/`versao`/`cor`/`cidade` são texto livre do VENDEDOR,
    // publicados sem moderação, e do outro lado entram num bloco que o prompt
    // chama de fato do sistema de registro do negócio — contando como lastro.
    // Injeção em forma de FATO, que nenhuma regra de "ignore instruções" pega.
    //
    // O `carro_lead_do_comprador` carrega os mesmos campos e sobrevive porque o
    // texto é saneado na origem e o alcance é o vendedor de UM anúncio — o que
    // deu match. Abrir o `id` ao modelo estenderia isso a qualquer anunciante.
    //
    // Este teste existe para que a reintrodução seja uma DECISÃO, com este
    // comentário na frente de quem a tomar, e não um "faltou".
    const built = preset();
    if (!built.ok) throw new Error(built.error);
    expect(built.manifest.tools.map((t) => t.name)).not.toContain("carro_anuncio_publico");
    expect(built.manifest.tools.some((t) => t.path.includes("/listings/"))).toBe(false);
    expect(built.manifest.tools.some((t) => t.scope === "business")).toBe(false);
  });

  it("não existe salto de resolução: a leitura já é endereçável pelo telefone verificado", () => {
    const built = preset();
    if (!built.ok) throw new Error(built.error);
    for (const tool of built.manifest.tools) expect(tool.resolve).toBeUndefined();
  });

  it("nenhum campo de PII, chave interna ou metadado de consentimento é projetado", () => {
    // O que o agente pode dizer em voz alta é uma lista, não uma sobra. Chave
    // interna (`handoff_id`, `match_id`) não tem razão para entrar no prompt de
    // um LLM; `codigo_expira_em` e `consentimento` são metadado de processo; e a
    // placa, o telefone e a coordenada são PII que a resposta não precisa.
    const PROIBIDOS = [
      "placa",
      "plate",
      "cpf",
      "email",
      "telefone",
      "phone",
      "lat",
      "lon",
      "handoff_id",
      "match_id",
      "codigo_expira_em",
      "consentimento",
      "contato"
    ];

    const built = preset();
    if (!built.ok) throw new Error(built.error);
    const projetados = built.manifest.tools.flatMap((t) => t.fields.map((f) => f.path.toLowerCase()));
    for (const proibido of PROIBIDOS) {
      expect(projetados.filter((p) => p.includes(proibido))).toEqual([]);
    }
  });

  it("cabe no teto do esquema e no orçamento que o backend concede a uma chamada", () => {
    // O esquema recusa acima de 3500; o `MCP_TIMEOUT_MS` da plataforma é 4000.
    // Um manifesto acima disso seria abortado lá, e o dono veria `timeout` sem
    // entender por quê.
    const built = preset();
    if (!built.ok) throw new Error(built.error);
    expect(built.manifest.timeoutMs).toBeLessThan(3500);
    expect(built.manifest.timeoutMs).toBeLessThan(4000);
  });

  it("aceita sobrescrever base e timeout sem deixar de validar", () => {
    const built = preset({ baseUrl: "https://carro-dev.example.com", timeoutMs: 1200, label: "Carro DEV" });
    if (!built.ok) throw new Error(built.error);
    expect(built.manifest.baseUrl).toBe("https://carro-dev.example.com");
    expect(built.manifest.timeoutMs).toBe(1200);
    expect(built.manifest.label).toBe("Carro DEV");
  });
});

describe("o preset e a tool_policy da plataforma não podem divergir", () => {
  it("mesma lista de ferramentas, mesmo escopo, mesmo parâmetro de identidade", () => {
    const built = preset();
    if (!built.ok) throw new Error(built.error);
    const policy = carroToolPolicy(built.manifest);

    expect(Object.keys(policy.tools).sort()).toEqual(built.manifest.tools.map((t) => t.name).sort());
    for (const tool of built.manifest.tools) {
      const rule = policy.tools[tool.name];
      expect(rule.scope).toBe(tool.scope);
      if (rule.scope === "customer") expect(rule.identityParam).toBe(tool.identityParam);
    }
  });

  it("fala o dialeto da BORDA da plataforma, não o do banco dela", () => {
    // A API admin recebe `identityParam` em camelCase e SEM `version`; o
    // `serializeToolPolicy` de lá é que converte para `{version:1, …,
    // identity_param}` ao gravar. Emitir a forma persistida faz a primeira
    // ativação bater num 400 — e um documento que precisa de tradução manual não
    // é colável, que é a única coisa que ele promete.
    const built = preset();
    if (!built.ok) throw new Error(built.error);
    const policy = carroToolPolicy(built.manifest);

    expect(policy).not.toHaveProperty("version");
    expect(policy.tools.carro_lead_do_comprador).toEqual({
      scope: "customer",
      identityParam: "telefone"
    });
    expect(Object.keys(policy.tools)).toEqual(["carro_lead_do_comprador"]);
    expect(JSON.stringify(policy)).not.toContain("identity_param");
  });
});

describe("as ferramentas contra respostas no formato real do carro", () => {
  const built = preset();
  const manifest = built.ok ? built.manifest : null;
  const tool = (name: string) => manifest!.tools.find((t) => t.name === name)!;

  it("carro_lead_do_comprador manda o telefone COM DDI — a prova de que `digits` não comeu o 55", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(LEAD));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTool(manifest!, tool("carro_lead_do_comprador"), { telefone: WA_ID });

    const [url, init] = fetchMock.mock.calls[0];
    // A URL EXATA. `br_local` produziria `telefone=34999530186` e casaria zero
    // registros em `users.phone_e164`, sem uma linha de erro em lugar nenhum.
    expect(url).toBe(`${CARRO_BASE_URL}/api/handoffs/lead?telefone=5534999530186`);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${CHATBOT_TOKEN}`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain("Modelo: Civic");
  });

  it("o `digits` tira a máscara e preserva o DDI mesmo quando o número chega formatado", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(LEAD));
    vi.stubGlobal("fetch", fetchMock);

    await runTool(manifest!, tool("carro_lead_do_comprador"), { telefone: "+55 (34) 99953-0186" });

    expect(fetchMock.mock.calls[0][0]).toBe(`${CARRO_BASE_URL}/api/handoffs/lead?telefone=5534999530186`);
  });

});
