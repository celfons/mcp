import { describe, it, expect, vi, afterEach } from "vitest";
import { applyTransform, parseManifest } from "../src/tenant/manifest";
import { readScalar, resolveProjectionRoot } from "../src/tenant/project";
import { runTool } from "../src/tenant/gateway";

// ---------------------------------------------------------------------------
// As quatro capacidades que a integração com a EVO exigiu do gateway, e os
// testes que provam que cada uma fecha o buraco que a motivou.
//
// A ordem é a ordem do dano:
//
//  1. RESOLUÇÃO — o salto `telefone → idMember`. O teste que importa aqui não é
//     o do caminho feliz: é o de que uma resolução VAZIA aborta a ferramenta.
//     Sem ele, `/receivables` sairia sem `memberId` e devolveria o financeiro
//     da academia inteira, dentro do prompt de um agente falando com um cliente
//     qualquer. É o vazamento entre clientes do mesmo tenant que o ADR-0036
//     existe para fechar, reaberto por um caminho novo.
//  2. TRANSFORM — o telefone que a plataforma escreve não é o que o ERP guarda.
//     A falha é silenciosa (zero resultados, nada vermelho), então tem de haver
//     teste.
//  3. RAIZ — envelope de paginação e swagger que declara objeto onde vem lista.
//  4. QUERY FIXA — `idBranch` fora do alcance do modelo.
// ---------------------------------------------------------------------------

const BASE = "https://evo.example.test";

/** Manifesto mínimo com uma ferramenta que RESOLVE antes de consultar. */
const withResolve = (extra: Record<string, unknown> = {}) =>
  parseManifest({
    tenantId: "tnt_gym",
    label: "Academia",
    baseUrl: BASE,
    auth: { type: "header", name: "Authorization", value: "Basic ZG5zOmtleQ==" },
    timeoutMs: 3000,
    tools: [
      {
        name: "minhas_cobrancas",
        description: "Cobranças do aluno",
        path: "/api/v1/receivables",
        scope: "customer",
        identityParam: "telefone",
        params: [{ name: "telefone", in: "query", required: true, transform: "br_local" }],
        query: { take: "10", idBranch: "7" },
        resolve: {
          path: "/api/v1/members/basic",
          param: "phone",
          query: { take: "1" },
          extract: ["[0].idMember", "idMember"],
          into: "memberId"
        },
        root: ["list", "lista", "$"],
        fields: [
          { path: "[].description", label: "Cobrança" },
          { path: "[].ammount", label: "Valor" }
        ],
        ...extra
      }
    ]
  });

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

// --- 1 · O salto de resolução ----------------------------------------------

describe("resolução: identidade verificada → chave interna", () => {
  const parsed = withResolve();
  const manifest = parsed.ok ? parsed.manifest : null;
  const tool = manifest?.tools[0];

  it("busca o cadastro pelo telefone e usa a chave resolvida na consulta principal", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json([{ idMember: 9182, firstName: "Ana" }]))
      .mockResolvedValueOnce(json({ qtde: 1, list: [{ description: "Mensalidade", ammount: 149.9 }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTool(manifest!, tool!, { telefone: "5534999530186" });

    const [resolveUrl] = fetchMock.mock.calls[0];
    const [mainUrl] = fetchMock.mock.calls[1];
    // O salto leva o telefone JÁ normalizado, no parâmetro que o manifesto nomeou.
    expect(resolveUrl).toBe(`${BASE}/api/v1/members/basic?take=1&phone=34999530186`);
    // A consulta principal leva a chave RESOLVIDA — e não o telefone, que foi
    // consumido pelo salto.
    expect(mainUrl).toBe(`${BASE}/api/v1/receivables?take=10&idBranch=7&memberId=9182`);
    expect(mainUrl).not.toContain("telefone");
    expect(result.content[0].text).toBe("Cobrança: Mensalidade · Valor: 149.9");
  });

  it("resolução vazia ABORTA — a consulta principal não acontece", async () => {
    // É o teste que justifica o arquivo. Um `/receivables` sem `memberId`
    // devolve o financeiro de todos os alunos da academia, e ele chegaria ao
    // prompt de um agente falando com quem não é aluno nenhum.
    const fetchMock = vi.fn().mockResolvedValueOnce(json([]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTool(manifest!, tool!, { telefone: "5534999530186" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toMatch(/Nenhum cadastro encontrado/);
  });

  it("resposta de forma inesperada no salto também aborta, em vez de seguir sem a chave", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ mensagem: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTool(manifest!, tool!, { telefone: "5534999530186" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toMatch(/Nenhum cadastro encontrado/);
  });

  it("falha de rede no salto não vira consulta sem chave", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTool(manifest!, tool!, { telefone: "5534999530186" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/500/);
  });

  it("o modelo não alcança a chave resolvida: argumento com o nome de `into` é ignorado", async () => {
    // `memberId` não é parâmetro declarado, então o `inputSchema` nem o anuncia
    // — e o esquema recusa um manifesto que o declarasse. Este teste prova o
    // efeito: mesmo passando o argumento na mão, quem manda é a resolução.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json([{ idMember: 9182 }]))
      .mockResolvedValueOnce(json({ list: [{ description: "X", ammount: 1 }] }));
    vi.stubGlobal("fetch", fetchMock);

    await runTool(manifest!, tool!, { telefone: "5534999530186", memberId: "1" });

    expect(fetchMock.mock.calls[1][0]).toContain("memberId=9182");
    expect(fetchMock.mock.calls[1][0]).not.toContain("memberId=1");
  });

  it("os dois saltos dividem UM orçamento — o segundo recebe o que sobrou", async () => {
    let clock = 1_000;
    const fetchMock = vi
      .fn()
      // O primeiro salto "gasta" 2s do relógio injetado.
      .mockImplementationOnce(async () => {
        clock += 2000;
        return json([{ idMember: 5 }]);
      })
      .mockResolvedValueOnce(json({ list: [{ description: "X", ammount: 1 }] }));
    vi.stubGlobal("fetch", fetchMock);

    await runTool(manifest!, tool!, { telefone: "5534999530186" }, () => clock);

    // `timeoutMs` é o orçamento da ferramenta inteira (3000), não de cada salto:
    // o segundo vale o que sobrou, e não outros 3000. Sem isto, o pior caso é a
    // soma dos saltos contra a parede de 4s que o backend concede à chamada.
    expect(fetchMock.mock.calls[0][1].signal).toBeDefined();
    const segundoTimeout = fetchMock.mock.calls[1][1];
    expect(segundoTimeout.signal).toBeDefined();
    expect(clock - 1000).toBe(2000);
  });
});

// --- 2 · Normalização do identificador --------------------------------------

describe("transform do identificador", () => {
  it("br_local tira o DDI de um E.164 brasileiro", () => {
    expect(applyTransform("5534999530186", "br_local")).toBe("34999530186");
    expect(applyTransform("553499530186", "br_local")).toBe("3499530186");
  });

  it("br_local NÃO estraga um número que já está local", () => {
    // DDD 55 (Santa Maria/RS) começa igual ao DDI e tem 11 dígitos. Cortar dois
    // aqui seria quebrar um cadastro que estava certo — é o que a janela de
    // comprimento impede.
    expect(applyTransform("55999998888", "br_local")).toBe("55999998888");
    expect(applyTransform("34999530186", "br_local")).toBe("34999530186");
  });

  it("br_local remove máscara antes de decidir", () => {
    expect(applyTransform("+55 (34) 99953-0186", "br_local")).toBe("34999530186");
  });

  it("digits só limpa, sem tocar no DDI", () => {
    expect(applyTransform("+55 (34) 99953-0186", "digits")).toBe("5534999530186");
  });

  it("sem transform declarado, o valor passa intacto", () => {
    expect(applyTransform("+5534999530186")).toBe("+5534999530186");
  });
});

// --- 3 · Onde a projeção lê -------------------------------------------------

describe("raiz da projeção", () => {
  it("desce no envelope de paginação", () => {
    expect(resolveProjectionRoot({ qtde: 1, list: [{ a: 1 }] }, ["list", "lista", "$"])).toEqual([{ a: 1 }]);
  });

  it("pula o candidato que existe mas está vazio", () => {
    // A EVO preenche `list` numa rota e `lista` noutra. Parar no primeiro que
    // existe deixaria o dado no candidato seguinte, sem ninguém notar.
    expect(resolveProjectionRoot({ list: [], lista: [{ a: 2 }] }, ["list", "lista"])).toEqual([{ a: 2 }]);
  });

  it("cobre objeto-ou-lista com um candidato só", () => {
    // O swagger da EVO declara `/members/basic` como objeto; a busca paginada
    // devolve lista. `["[0]", "$"]` atende as duas sem adivinhar em runtime.
    expect(resolveProjectionRoot([{ nome: "Ana" }], ["[0]", "$"])).toEqual({ nome: "Ana" });
    expect(resolveProjectionRoot({ nome: "Ana" }, ["[0]", "$"])).toEqual({ nome: "Ana" });
  });

  it("lista vazia não vira raiz, e a projeção diz que não achou", () => {
    expect(resolveProjectionRoot([], ["[0]", "$"])).toBeUndefined();
  });

  it("sem raiz declarada, a resposta inteira é a raiz", () => {
    expect(resolveProjectionRoot({ a: 1 })).toEqual({ a: 1 });
  });

  it("readScalar recusa estrutura — o que sai dele vira valor de query", () => {
    expect(readScalar({ id: 7 }, "id")).toBe("7");
    expect(readScalar({ id: { n: 7 } }, "id")).toBeNull();
    expect(readScalar([{ id: 7 }], "[0].id")).toBe("7");
    expect(readScalar(7, "$")).toBe("7");
  });
});

// --- 4 · Query fixa ---------------------------------------------------------

describe("query fixa", () => {
  it("viaja em toda chamada e não é declarada ao modelo", async () => {
    const parsed = withResolve();
    const manifest = parsed.ok ? parsed.manifest : null;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json([{ idMember: 1 }]))
      .mockResolvedValueOnce(json({ list: [{ description: "X", ammount: 1 }] }));
    vi.stubGlobal("fetch", fetchMock);

    await runTool(manifest!, manifest!.tools[0], { telefone: "5534999530186" });

    expect(fetchMock.mock.calls[1][0]).toContain("idBranch=7");
    // `idBranch` não está em `params`, então não entra no `inputSchema` — o
    // modelo não tem como propor a unidade de outra academia.
    expect(manifest!.tools[0].params.map((p) => p.name)).toEqual(["telefone"]);
  });
});

// --- 5 · O que o esquema recusa ---------------------------------------------

describe("o esquema recusa a configuração contraditória", () => {
  const base = {
    tenantId: "t",
    label: "L",
    baseUrl: BASE,
    tools: [
      {
        name: "x",
        description: "d",
        path: "/a",
        scope: "customer",
        identityParam: "telefone",
        params: [{ name: "telefone", in: "query", required: true }],
        fields: [{ path: "a", label: "A" }]
      }
    ]
  };
  const withTool = (patch: Record<string, unknown>) =>
    parseManifest({ ...base, tools: [{ ...base.tools[0], ...patch }] });

  it("resolve em ferramenta business", () => {
    const r = parseManifest({
      ...base,
      tools: [
        {
          name: "x",
          description: "d",
          path: "/a",
          scope: "business",
          params: [],
          fields: [{ path: "a", label: "A" }],
          resolve: { path: "/r", param: "phone", extract: ["id"], into: "k" }
        }
      ]
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/resolve só existe em escopo customer/);
  });

  it("`into` colidindo com parâmetro que o modelo alcança", () => {
    const r = withTool({
      params: [
        { name: "telefone", in: "query", required: true },
        { name: "memberId", in: "query" }
      ],
      resolve: { path: "/r", param: "phone", extract: ["id"], into: "memberId" }
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/colide/);
  });

  it("`into` colidindo com a query fixa", () => {
    const r = withTool({
      query: { memberId: "1" },
      resolve: { path: "/r", param: "phone", extract: ["id"], into: "memberId" }
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/colide/);
  });

  it("query fixa disputando chave com parâmetro", () => {
    const r = withTool({ query: { telefone: "x" } });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/query fixa e em params/);
  });

  it("placeholder no path do salto de resolução", () => {
    const r = withTool({
      resolve: { path: "/r/{id}", param: "phone", extract: ["id"], into: "k" }
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/resolve.path não aceita/);
  });
});
