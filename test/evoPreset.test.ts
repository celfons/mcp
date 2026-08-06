import { describe, it, expect, vi, afterEach } from "vitest";
import { buildEvoManifest, evoToolPolicy, basicAuthValue, EVO_BASE_URL } from "../src/tenant/presets/evo";
import { runTool } from "../src/tenant/gateway";

// ---------------------------------------------------------------------------
// O preset da EVO.
//
// Um preset é um gerador de manifesto, então há exatamente duas coisas que
// podem dar errado nele, e as duas são invisíveis até um cliente perguntar:
//
//  1. **Ele emite algo que o esquema recusaria.** Aí a academia é cadastrada e
//     a ferramenta simplesmente não existe. Por isso `buildEvoManifest` devolve
//     `ManifestParseResult` e não o manifesto: a validação é o retorno.
//  2. **Ele discorda da `tool_policy`** que a plataforma grava do outro lado.
//     Uma ferramenta `customer` aqui e ausente lá nasce inchamável
//     (`unclassified`), e o dono só descobre pela métrica. Os dois documentos
//     saem do MESMO lugar, e este arquivo prova que continuam concordando.
//
// O resto é o contrato da EVO propriamente dito: os caminhos e os nomes de
// campo vieram do swagger (`servers[0].url`, `MembersBasicApiViewModel`,
// `ReceivablesApiViewModelListGridComQtdeViewModel`, `ContratosResumoApiViewModel`),
// e um erro de digitação neles produz projeção vazia — silenciosa.
// ---------------------------------------------------------------------------

const preset = (extra: Record<string, unknown> = {}) =>
  buildEvoManifest({ tenantId: "tnt_gym", dns: "minhaacademia", secretKey: "chave-secreta", ...extra });

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe("o preset emite um manifesto que o esquema aceita", () => {
  it("valida inteiro, com as duas classes de escopo", () => {
    const built = preset();
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const scopes = built.manifest.tools.map((t) => t.scope);
    expect(scopes).toContain("customer");
    expect(scopes).toContain("business");
    expect(built.manifest.baseUrl).toBe(EVO_BASE_URL);
  });

  it("toda ferramenta customer DECLARA o parâmetro de identidade", () => {
    // A condição 3 do ADR-0036: regra `customer` cuja tool não declara o
    // `identityParam` é inchamável. Anunciá-la seria prometer uma consulta que
    // o backend recusa.
    const built = preset();
    if (!built.ok) throw new Error(built.error);
    for (const tool of built.manifest.tools) {
      if (tool.scope !== "customer") continue;
      expect(tool.identityParam).toBe("phone");
      expect(tool.params.map((p) => p.name)).toContain("phone");
      // E ele é normalizado — sem isto a busca casa zero registros, em silêncio.
      expect(tool.params.find((p) => p.name === "phone")?.transform).toBe("br_local");
    }
  });

  it("nenhuma ferramenta business carrega identidade", () => {
    const built = preset();
    if (!built.ok) throw new Error(built.error);
    for (const tool of built.manifest.tools) {
      if (tool.scope !== "business") continue;
      expect(tool.identityParam).toBeUndefined();
      expect(tool.params.map((p) => p.name)).not.toContain("phone");
    }
  });

  it("é somente LEITURA — o ADR-0036 §2.3 é o que dispensa a reserva de idempotência", () => {
    // Um turno reentregue REPETE a consulta. Repetir leitura custa tempo;
    // repetir matrícula cria duas. Se alguém acrescentar uma escrita aqui sem
    // abrir a outra feature, este teste é quem avisa.
    const built = preset();
    if (!built.ok) throw new Error(built.error);
    for (const tool of built.manifest.tools) {
      expect(tool.method).toBe("GET");
    }
  });

  it("A REGRA: ou fala do cliente que perguntou, ou é plano e preço — não há terceira classe", () => {
    // Esta é a fronteira do produto, e ela é mais estreita do que "é GET".
    //
    // Duas classes, e só duas:
    //   (a) `customer` — a resposta fala da pessoa amarrada ao telefone
    //       verificado. O que é dela, ela pode ver;
    //   (b) `business` — SÓ a tabela de preço. Plano e serviço, com valor.
    //
    // O que ficou de fora não ficou por ser perigoso: grade de aulas,
    // modalidades, endereço, horário, convênios e a loja são todos inofensivos.
    // Ficaram de fora porque a regra é uma allowlist, e allowlist que aceita
    // "isso também é inofensivo" deixa de ser allowlist em três meses. Fora
    // isso, quase tudo dessa lista é quase estático — mora mais barato no
    // contexto que o dono escreve no portal, sem custar uma consulta viva e uma
    // chamada de LLM por turno.
    //
    // Consulta nova de negócio: ou entra nesta lista com o preço no meio, ou
    // não entra.
    const PRECO = ["/api/v3/membership", "/api/v1/service"];

    const built = preset();
    if (!built.ok) throw new Error(built.error);

    for (const tool of built.manifest.tools) {
      if (tool.scope === "customer") continue;
      expect(PRECO).toContain(tool.path);
    }
  });

  it("nenhuma rota do INVENTÁRIO PROIBIDO entra no preset", () => {
    // "É GET, então é seguro" é a intuição errada, e a EVO tem os
    // contraexemplos prontos. Todas as rotas abaixo são GET, todas são leitura
    // em HTTP, e nenhuma pode chegar perto do prompt de um agente que fala com
    // um cliente. O verbo não classifica nada — quem aparece na RESPOSTA
    // classifica.
    //
    // Este inventário é fechado e existe para o dia em que alguém quiser
    // "aproveitar que já está integrado". Uma rota nova só entra depois de
    // passar pelas duas perguntas: a resposta fala de UMA pessoa amarrada ao
    // telefone verificado, ou fala do negócio? E, se for do negócio, o dono
    // poria isso na vitrine?
    const PROIBIDAS = [
      // Devolve link de redefinição de senha. É GET, e entrega a conta de alguém.
      "/api/v1/members/resetPassword",
      // Lista de inadimplentes da academia inteira, com nome.
      "/api/v1/receivables/debtors",
      // Cartões de crédito do aluno.
      "/creditcard",
      // Cupons de desconto — o agente distribuiria os códigos.
      "/api/v1/voucher",
      // Base de clientes inteira.
      "/api/v2/management/activeclients",
      "/api/v2/management/not-renewed",
      "/api/v2/management/prospects",
      "/api/v2/members/active-members",
      // Financeiro e operação do dono: contas a pagar, bancos, centros de custo.
      "/api/v1/payables",
      "/api/v1/bank-accounts",
      "/api/v1/costcenter",
      "/api/v1/revenuecenter",
      "/api/v1/receivables/receivables-conciliation",
      // Funcionários e permissões.
      "/api/v2/employees",
      "/api/v1/employees/permissions",
      // Credenciais e configuração de cobrança.
      "/api/v1/configuration/gateway-form-token",
      "/api/v2/configuration/gateway",
      "/api/v2/webhook",
      // GET que gera cobrança — leitura no verbo, efeito no mundo.
      "/api/v1/pix/qr-code",
      // Ficha completa: cpf, documento, endereço, nascimento, foto.
      "/api/v2/members"
    ];

    const built = preset();
    if (!built.ok) throw new Error(built.error);
    const rotas = built.manifest.tools.flatMap((t) => [t.path, t.resolve?.path ?? ""]);

    for (const proibida of PROIBIDAS) {
      expect(rotas.filter((r) => r.includes(proibida))).toEqual([]);
    }
  });

  it("toda consulta que a EVO devolveria SEM filtro é amarrada ou não existe", () => {
    // `/receivables` e `/entries` respondem pela academia inteira quando o
    // filtro de aluno falta. A regra estrutural: consulta `customer` que não
    // consegue ser endereçada pelo telefone TEM de resolver — e a resolução
    // aborta quando não acha, então não há caminho em que a consulta saia sem
    // amarra.
    const built = preset();
    if (!built.ok) throw new Error(built.error);

    const semFiltroDevolveTudo = ["/api/v1/receivables", "/api/v1/entries", "/api/v1/members/services"];
    for (const tool of built.manifest.tools) {
      if (!semFiltroDevolveTudo.includes(tool.path)) continue;
      expect(tool.scope).toBe("customer");
      expect(tool.resolve).toBeDefined();
    }
  });

  it("não vaza PII que a consulta não precisa", () => {
    // `/api/v2/members` devolveria cpf, document, address, zipCode, birthDate e
    // photoUrl. O preset usa `/members/basic`, que não os tem — e nenhum campo
    // desses é projetado em lugar nenhum.
    const built = preset();
    if (!built.ok) throw new Error(built.error);
    const projected = built.manifest.tools.flatMap((t) => t.fields.map((f) => f.path.toLowerCase()));
    for (const proibido of ["cpf", "document", "birthdate", "zipcode", "photourl", "address"]) {
      expect(projected.filter((p) => p.includes(proibido) && !p.startsWith("address"))).toEqual([]);
    }
    for (const tool of built.manifest.tools) {
      if (tool.scope === "customer") expect(tool.path).not.toContain("/api/v2/members");
    }
  });

  it("pina a unidade por query fixa, fora do alcance do modelo", () => {
    const built = preset({ idBranch: 12 });
    if (!built.ok) throw new Error(built.error);
    const cadastro = built.manifest.tools.find((t) => t.name === "evo_meu_cadastro");
    expect(cadastro?.query.idBranch).toBe("12");
    // Se `idBranch` fosse parâmetro, o modelo poderia propor a unidade de outra
    // academia a partir do texto do cliente.
    expect(cadastro?.params.map((p) => p.name)).not.toContain("idBranch");
  });

  it("sem idBranch, nenhuma chave vazia entra na query", () => {
    const built = preset();
    if (!built.ok) throw new Error(built.error);
    for (const tool of built.manifest.tools) {
      expect(Object.keys(tool.query)).not.toContain("idBranch");
    }
  });

  it("cabe no orçamento que o backend concede a uma chamada", () => {
    // `MCP_TIMEOUT_MS` do lado da plataforma é 4000. Um manifesto acima disso
    // seria abortado lá, e o dono veria `timeout` sem entender por quê.
    const built = preset();
    if (!built.ok) throw new Error(built.error);
    expect(built.manifest.timeoutMs).toBeLessThan(4000);
  });
});

describe("o preset e a tool_policy da plataforma não podem divergir", () => {
  it("mesma lista de ferramentas, mesmo escopo, mesmo parâmetro de identidade", () => {
    const built = preset();
    if (!built.ok) throw new Error(built.error);
    const policy = evoToolPolicy(built.manifest);

    expect(Object.keys(policy.tools).sort()).toEqual(built.manifest.tools.map((t) => t.name).sort());
    for (const tool of built.manifest.tools) {
      const rule = policy.tools[tool.name];
      expect(rule.scope).toBe(tool.scope);
      if (rule.scope === "customer") expect(rule.identityParam).toBe(tool.identityParam);
    }
  });

  it("fala o dialeto da BORDA da plataforma, não o do banco dela", () => {
    // São dois dialetos, e eles não são iguais: a API admin recebe
    // `identityParam` em camelCase e sem `version`; o `serializeToolPolicy` de
    // lá é que converte para a forma persistida ao gravar. Emitir a forma do
    // banco faz a primeira ativação bater num 400 — e um documento que precisa
    // de tradução manual não é colável, que é a única coisa que ele promete.
    const built = preset();
    if (!built.ok) throw new Error(built.error);
    const policy = evoToolPolicy(built.manifest);

    expect(policy).not.toHaveProperty("version");
    const cliente = policy.tools.evo_meu_plano;
    expect(cliente).toEqual({ scope: "customer", identityParam: "phone" });
    expect(JSON.stringify(policy)).not.toContain("identity_param");
  });

  it("a policy acompanha o recorte: não descreve consulta que o tenant não anuncia", () => {
    // A policy é DERIVADA do manifesto, não reconstruída da mesma receita — se
    // fosse reconstruída, ela teria de aprender o filtro por conta própria, e a
    // versão que esquecesse dele classificaria consultas que não existem.
    const built = preset({ include: "business" });
    if (!built.ok) throw new Error(built.error);
    const policy = evoToolPolicy(built.manifest);

    expect(Object.keys(policy.tools)).not.toContain("evo_minhas_cobrancas");
    expect(Object.values(policy.tools).every((r) => r.scope === "business")).toBe(true);
  });
});

describe("recorte por classe de consulta", () => {
  it('include "business" anuncia só as consultas sobre o negócio', () => {
    const built = preset({ include: "business" });
    if (!built.ok) throw new Error(built.error);

    expect(built.manifest.tools.map((t) => t.name)).toEqual([
      "evo_planos_e_precos",
      "evo_servicos_e_precos"
    ]);
  });

  it("nesse modo, o telefone do cliente NUNCA sai do perímetro", () => {
    // É a consequência que justifica o recorte: sem consulta escopada no aluno,
    // não há identificador viajando para um servidor de terceiro — e o dever de
    // aviso do ADR-0036 some porque o fato que o originava deixa de acontecer.
    const built = preset({ include: "business" });
    if (!built.ok) throw new Error(built.error);

    for (const tool of built.manifest.tools) {
      expect(tool.scope).toBe("business");
      expect(tool.identityParam).toBeUndefined();
      expect(tool.resolve).toBeUndefined();
      expect(tool.params.map((p) => p.name)).not.toContain("phone");
    }
  });

  it("o default continua sendo tudo — o recorte é opt-in", () => {
    const todas = preset();
    if (!todas.ok) throw new Error(todas.error);
    expect(todas.manifest.tools.length).toBe(8);
    expect(todas.manifest.tools.some((t) => t.scope === "customer")).toBe(true);
    expect(preset({ include: "all" }).ok).toBe(true);
  });

  it("o recorte não muda nada nas consultas que ficam", () => {
    const todas = preset({ idBranch: 3 });
    const soNegocio = preset({ idBranch: 3, include: "business" });
    if (!todas.ok || !soNegocio.ok) throw new Error("preset inválido");

    for (const tool of soNegocio.manifest.tools) {
      expect(tool).toEqual(todas.manifest.tools.find((t) => t.name === tool.name));
    }
  });
});

describe("autenticação Basic da EVO", () => {
  it("monta o cabeçalho com DNS como usuário e a secret key como senha", () => {
    expect(basicAuthValue("minhaacademia", "chave")).toBe(`Basic ${btoa("minhaacademia:chave")}`);
  });

  it("sobrevive a caractere não-ASCII na credencial", () => {
    // `btoa` cru estoura em code point > 255; a conversão passa pelos bytes UTF-8.
    expect(() => basicAuthValue("açaí", "señha")).not.toThrow();
  });

  it("o manifesto carrega o Basic pronto, e o gateway o envia na chamada", async () => {
    const built = preset();
    if (!built.ok) throw new Error(built.error);
    const planos = built.manifest.tools.find((t) => t.name === "evo_planos_e_precos")!;

    const fetchMock = vi.fn().mockResolvedValue(json([{ nameMembership: "Mensal", value: 99.9 }]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTool(built.manifest, planos, {});

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${EVO_BASE_URL}/api/v3/membership?active=true&take=20`);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      basicAuthValue("minhaacademia", "chave-secreta")
    );
    expect(result.content[0].text).toContain("Plano: Mensal");
    expect(result.content[0].text).toContain("Valor: 99.9");
  });
});

describe("as ferramentas contra respostas no formato real da EVO", () => {
  const built = preset({ idBranch: 3 });
  const manifest = built.ok ? built.manifest : null;
  const tool = (name: string) => manifest!.tools.find((t) => t.name === name)!;

  it("evo_meu_plano responde num salto só — memberships vem embutido em /members/basic", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json([
        {
          idMember: 41,
          firstName: "Ana",
          memberships: [
            {
              name: "Plano Anual",
              membershipStatus: "Ativo",
              startDate: "2026-01-10T00:00:00",
              endDate: "2027-01-10T00:00:00",
              nextCharge: "2026-09-10T00:00:00",
              valueNextMonth: 129.9
            }
          ]
        }
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTool(manifest!, tool("evo_meu_plano"), { phone: "5534999530186" });

    // UM salto: o plano não precisa de resolução, e é isso que o mantém barato.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${EVO_BASE_URL}/api/v1/members/basic?take=1&idBranch=3&phone=34999530186`
    );
    expect(result.content[0].text).toContain("Plano: Plano Anual");
    expect(result.content[0].text).toContain("Valor: 129.9");
  });

  it("evo_meu_cadastro lê a resposta venha ela como objeto ou como lista", async () => {
    const corpo = { firstName: "Ana", membershipStatus: "Ativo", branchName: "Centro" };

    for (const resposta of [corpo, [corpo]]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(resposta)));
      const result = await runTool(manifest!, tool("evo_meu_cadastro"), { phone: "5534999530186" });
      expect(result.content[0].text).toContain("Nome: Ana");
      expect(result.content[0].text).toContain("Unidade: Centro");
    }
  });

  it("evo_minhas_cobrancas resolve o idMember e desce no envelope de paginação", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json([{ idMember: 41 }]))
      .mockResolvedValueOnce(
        json({
          qtde: 2,
          list: [
            { description: "Mensalidade 08/2026", dueDate: "2026-08-10", ammount: 129.9, status: { id: 1, name: "Em aberto" } },
            { description: "Mensalidade 07/2026", dueDate: "2026-07-10", ammount: 129.9, status: { id: 2, name: "Pago" } }
          ]
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTool(manifest!, tool("evo_minhas_cobrancas"), { phone: "5534999530186" });

    expect(fetchMock.mock.calls[1][0]).toBe(
      `${EVO_BASE_URL}/api/v1/receivables?take=10&idBranch=3&memberId=41`
    );
    // Uma linha por cobrança, com os campos daquela cobrança juntos: agrupar por
    // campo deixaria o modelo parear vencimento com o valor errado.
    const linhas = result.content[0].text.split("\n");
    expect(linhas[0]).toBe("Cobrança: Mensalidade 08/2026 · Vencimento: 2026-08-10 · Valor: 129.9 · Situação: Em aberto");
    expect(linhas).toHaveLength(2);
  });

  it("evo_servicos_e_precos é business: consulta sem identidade nenhuma", () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json([{ nameService: "Avaliação física", value: 80, maxAmountInstallments: 1 }]));
    vi.stubGlobal("fetch", fetchMock);

    return runTool(manifest!, tool("evo_servicos_e_precos"), { name: "avalia" }).then((result) => {
      // Um salto só, e nenhum telefone no fio: consulta de negócio não fala de
      // pessoa alguma, então não há a quem amarrar nem o que resolver.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain("active=true");
      expect(url).toContain("name=avalia");
      expect(url).not.toContain("phone");
      expect(url).not.toContain("idMember");
      expect(result.content[0].text).toContain("Serviço: Avaliação física");
    });
  });

  it("aluno sem cadastro na EVO não vira consulta ao financeiro da academia inteira", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json([]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTool(manifest!, tool("evo_minhas_cobrancas"), { phone: "5511900000000" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toMatch(/Nenhum cadastro encontrado/);
  });
});
