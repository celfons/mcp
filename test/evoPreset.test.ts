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
    const policy = evoToolPolicy();

    expect(Object.keys(policy.tools).sort()).toEqual(built.manifest.tools.map((t) => t.name).sort());
    for (const tool of built.manifest.tools) {
      const rule = policy.tools[tool.name];
      expect(rule.scope).toBe(tool.scope);
      if (rule.scope === "customer") expect(rule.identity_param).toBe(tool.identityParam);
    }
    expect(policy.version).toBe(1);
  });

  it("a policy não é escrita à mão: some junto se a ferramenta sumir", () => {
    const policy = evoToolPolicy();
    expect(Object.keys(policy.tools).length).toBe(preset().ok ? (preset() as { ok: true; manifest: { tools: unknown[] } }).manifest.tools.length : -1);
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

  it("evo_grade_de_aulas é business: consulta sem identidade nenhuma", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json([{ name: "Spinning", activityDate: "2026-08-07", startTime: "07:00", instructor: "Léo", capacity: 20, ocupation: 12 }]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTool(manifest!, tool("evo_grade_de_aulas"), { date: "2026-08-07" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("onlyAvailables=true");
    expect(url).toContain("date=2026-08-07");
    expect(url).not.toContain("phone");
    expect(result.content[0].text).toContain("Aula: Spinning");
  });

  it("aluno sem cadastro na EVO não vira consulta ao financeiro da academia inteira", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json([]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTool(manifest!, tool("evo_minhas_cobrancas"), { phone: "5511900000000" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toMatch(/Nenhum cadastro encontrado/);
  });
});
