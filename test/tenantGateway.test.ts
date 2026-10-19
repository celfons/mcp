import { describe, it, expect, vi, afterEach } from "vitest";
import { parseManifest } from "../src/tenant/manifest";
import { checkOutboundUrl, safeFetch, OutboundError } from "../src/tenant/safeUrl";
import { project, readPath, parseRepeatPath } from "../src/tenant/project";
import { resolveTenant, hashToken, readBearer } from "../src/tenant/store";
import { runTool, asStringArgs } from "../src/tenant/gateway";
import { buildEvoManifest, EVO_PRESET_VERSION } from "../src/tenant/presets/evo";

// ---------------------------------------------------------------------------
// O gateway por tenant (celfons/whatsapp#1324).
//
// A ordem dos blocos é a ordem do risco. O primeiro é o ISOLAMENTO: ao viver
// fora da plataforma, este Worker perde o `INV-TENANT-SCOPE` e o guard
// estrutural que o cobra lá — o que sobra é a regra escrita em `store.ts` e
// estes testes. Um erro de escopo aqui cruza clientes, e nenhum teste do
// backend veria.
//
// Depois vêm as três coisas que decidem o que chega ao PROMPT de um agente:
// SSRF (para onde este Worker pode requisitar), projeção (o que da resposta do
// cliente pode viajar) e mensagem de erro (que não pode ecoar o corpo do
// cliente de volta ao modelo).
// ---------------------------------------------------------------------------

const TOKEN_A = "token-do-tenant-a-1234567890";
const TOKEN_B = "token-do-tenant-b-0987654321";

const manifestFor = (tenantId: string, host: string) => ({
  tenantId,
  label: `ERP ${tenantId}`,
  baseUrl: `https://${host}`,
  auth: { type: "bearer", token: `segredo-${tenantId}` },
  tools: [
    {
      name: "consultar_pedido",
      description: "Status do pedido do cliente",
      method: "GET",
      path: "/pedidos/{orderId}",
      scope: "customer",
      identityParam: "telefone",
      params: [
        { name: "orderId", in: "path", required: true },
        { name: "telefone", in: "query", required: true }
      ],
      fields: [
        { path: "status", label: "Status" },
        { path: "previsao", label: "Previsão" }
      ]
    }
  ]
});

/** KV de mentira com as duas famílias de chave que o store usa. */
const fakeKv = (entries: Record<string, unknown>) => ({
  get: async (key: string, type?: string) => {
    const value = entries[key];
    if (value === undefined) return null;
    return type === "json" ? value : (value as string);
  }
});

const request = (token?: string) =>
  new Request("https://gateway.example.test/mcp/tenant", {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });

const envWith = async (tenants: Array<{ id: string; token: string; host: string }>) => {
  const entries: Record<string, unknown> = {};
  for (const t of tenants) {
    entries[`tenant-token:${await hashToken(t.token)}`] = t.id;
    entries[`tenant-manifest:${t.id}`] = manifestFor(t.id, t.host);
  }
  return { TENANT_MANIFESTS: fakeKv(entries) } as unknown as Env;
};

afterEach(() => vi.unstubAllGlobals());

// --- 1 · Isolamento ---------------------------------------------------------

describe("isolamento entre tenants", () => {
  it("o token de um tenant resolve o manifesto DELE, e só dele", async () => {
    const env = await envWith([
      { id: "tnt_a", token: TOKEN_A, host: "api-a.example.test" },
      { id: "tnt_b", token: TOKEN_B, host: "api-b.example.test" }
    ]);

    const a = await resolveTenant(request(TOKEN_A), env);
    const b = await resolveTenant(request(TOKEN_B), env);

    expect(a.ok && a.tenant.tenantId).toBe("tnt_a");
    expect(b.ok && b.tenant.tenantId).toBe("tnt_b");
    // O que mais importa: a credencial e a base de um NÃO aparecem para o outro.
    expect(a.ok && a.tenant.manifest.baseUrl).toBe("https://api-a.example.test");
    expect(a.ok && JSON.stringify(a.tenant.manifest)).not.toContain("tnt_b");
    expect(b.ok && JSON.stringify(b.tenant.manifest)).not.toContain("segredo-tnt_a");
  });

  it("falha fechado em cada passo, sem anunciar ferramenta nenhuma", async () => {
    const env = await envWith([{ id: "tnt_a", token: TOKEN_A, host: "api-a.example.test" }]);

    expect((await resolveTenant(request(), env)).ok).toBe(false);
    expect((await resolveTenant(request("token-desconhecido-000000"), env)).ok).toBe(false);
    // Sem KV o endpoint fica inerte em vez de improvisar.
    expect((await resolveTenant(request(TOKEN_A), {} as Env)).ok).toBe(false);
  });

  it("recusa manifesto cujo tenantId não casa com a chave sob a qual foi guardado", async () => {
    const env = {
      TENANT_MANIFESTS: fakeKv({
        [`tenant-token:${await hashToken(TOKEN_A)}`]: "tnt_a",
        // Gravado na chave de A, mas declarando ser B: é assim que um tenant
        // passa a responder pelo outro.
        "tenant-manifest:tnt_a": manifestFor("tnt_b", "api-b.example.test")
      })
    } as unknown as Env;

    const result = await resolveTenant(request(TOKEN_A), env);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe("invalid_manifest");
  });

  it("guarda o HASH do token, nunca o token", async () => {
    const digest = await hashToken(TOKEN_A);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(TOKEN_A);
  });

  it("ignora Authorization malformado ou curto demais", () => {
    expect(readBearer(new Request("https://x.test", { headers: { Authorization: "Basic abc" } }))).toBeNull();
    expect(readBearer(new Request("https://x.test", { headers: { Authorization: "Bearer curto" } }))).toBeNull();
    expect(readBearer(request(TOKEN_A))).toBe(TOKEN_A);
  });
});

// --- 2 · Manifesto ----------------------------------------------------------

// ---------------------------------------------------------------------------
// Manifesto de preset é DERIVADO do código: quando o preset muda, o gravado é
// regerado na leitura. É o que dispensa rota de admin e token para que uma
// consulta nova chegue a quem ativou antes dela.
// ---------------------------------------------------------------------------

describe("regeneração do manifesto de preset na leitura", () => {
  const evo = (overrides: Record<string, unknown> = {}) => {
    const built = buildEvoManifest({ tenantId: "tnt_gym", dns: "gavioes", secretKey: "chave", idBranch: 107 });
    if (!built.ok) throw new Error(built.error);
    return { ...built.manifest, ...overrides };
  };
  /** A ativação de ANTES: sem carimbo e sem as consultas que entraram depois. */
  const v1 = () => {
    const { preset: _semCarimbo, ...m } = evo();
    return { ...m, tools: m.tools.filter((t) => !["evo_modalidades", "evo_grade_de_aulas"].includes(t.name)) };
  };
  const kvWith = async (manifest: unknown) => {
    const entries = new Map<string, unknown>([
      [`tenant-token:${await hashToken(TOKEN_A)}`, "tnt_gym"],
      ["tenant-manifest:tnt_gym", manifest]
    ]);
    const puts: string[] = [];
    return {
      puts,
      get: async (key: string, type?: string) => {
        const value = entries.get(key);
        if (value === undefined) return null;
        return type === "json" ? value : (value as string);
      },
      put: async (key: string, value: string) => {
        puts.push(key);
        entries.set(key, JSON.parse(value));
      }
    };
  };

  it("manifesto da ativação antiga sai regerado com o preset atual, e é gravado de volta", async () => {
    const kv = await kvWith(v1());
    const resolved = await resolveTenant(request(TOKEN_A), { TENANT_MANIFESTS: kv } as unknown as Env);

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const nomes = resolved.tenant.manifest.tools.map((t) => t.name);
    expect(nomes).toContain("evo_modalidades");
    expect(nomes).toContain("evo_grade_de_aulas");
    expect(resolved.tenant.manifest.preset).toEqual({ name: "evo", version: EVO_PRESET_VERSION });
    // Credencial e unidade são as gravadas — ninguém digitou nada.
    expect(resolved.tenant.manifest.auth).toEqual(v1().auth);
    expect(resolved.tenant.manifest.tools.every((t) => t.query.idBranch === "107" || t.name === "evo_minha_frequencia")).toBe(true);
    expect(kv.puts).toEqual(["tenant-manifest:tnt_gym"]);
  });

  it("manifesto na versão corrente não é regravado a cada leitura", async () => {
    const kv = await kvWith(evo());
    const resolved = await resolveTenant(request(TOKEN_A), { TENANT_MANIFESTS: kv } as unknown as Env);
    expect(resolved.ok).toBe(true);
    expect(kv.puts).toEqual([]);
  });

  it("manifesto colado à mão nunca é tocado — regerar por cima apagaria o que o operador escreveu", async () => {
    const colado = manifestFor("tnt_gym", "api.cliente.com");
    const kv = await kvWith(colado);
    const resolved = await resolveTenant(request(TOKEN_A), { TENANT_MANIFESTS: kv } as unknown as Env);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.tenant.manifest.tools.map((t) => t.name)).toEqual(["consultar_pedido"]);
    expect(kv.puts).toEqual([]);
  });

  it("falha ao regravar não falha a requisição — o manifesto novo serve este turno", async () => {
    const kv = await kvWith(v1());
    kv.put = async () => {
      throw new Error("KV indisponível");
    };
    const resolved = await resolveTenant(request(TOKEN_A), { TENANT_MANIFESTS: kv } as unknown as Env);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.tenant.manifest.tools.map((t) => t.name)).toContain("evo_grade_de_aulas");
  });
});

describe("manifesto", () => {
  it("aceita um manifesto completo", () => {
    expect(parseManifest(manifestFor("tnt_a", "api.example.test")).ok).toBe(true);
  });

  it("exige que a ferramenta customer DECLARE o parâmetro de identidade", () => {
    // O backend recusa (`identityParam_missing`) a ferramenta que não o declara
    // no inputSchema: sem esta regra, anunciaríamos algo nunca chamável.
    const bad = manifestFor("tnt_a", "api.example.test");
    bad.tools[0].params = [{ name: "orderId", in: "path", required: true }];
    const result = parseManifest(bad);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/identityParam/);
  });

  it("recusa escopo business com parâmetro de identidade", () => {
    const bad = manifestFor("tnt_a", "api.example.test");
    bad.tools[0].scope = "business";
    expect(parseManifest(bad).ok).toBe(false);
  });

  it("recusa placeholder no path sem parâmetro correspondente", () => {
    const bad = manifestFor("tnt_a", "api.example.test");
    bad.tools[0].path = "/pedidos/{orderId}/{itemId}";
    const result = parseManifest(bad);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/itemId/);
  });

  it("recusa ferramenta sem campos declarados — seria devolver o JSON cru", () => {
    const bad = manifestFor("tnt_a", "api.example.test");
    bad.tools[0].fields = [];
    expect(parseManifest(bad).ok).toBe(false);
  });
});

// --- 3 · SSRF ---------------------------------------------------------------

describe("destino da chamada", () => {
  it("aceita https público e recusa o resto", () => {
    expect(checkOutboundUrl("https://api.cliente.com/pedidos").ok).toBe(true);
    for (const bad of [
      "http://api.cliente.com",
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://169.254.169.254/latest/meta-data",
      "https://10.0.0.5/x",
      "https://192.168.1.10/x",
      "https://172.16.0.9/x",
      "https://[::1]/x",
      "https://algo.internal/x",
      "file:///etc/passwd"
    ]) {
      expect(checkOutboundUrl(bad).ok, `${bad} deveria ser recusado`).toBe(false);
    }
  });

  it("não segue redirecionamento — seguir devolveria a escolha do destino ao outro lado", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 302 })));
    await expect(
      safeFetch("https://api.cliente.com/x", { method: "GET", headers: {}, timeoutMs: 1000 })
    ).rejects.toBeInstanceOf(OutboundError);
  });

  it("não devolve o corpo do erro do cliente — ele iria para o prompt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ erro: "cpf 123.456.789-00 não encontrado" }), { status: 500 }))
    );
    await expect(
      safeFetch("https://api.cliente.com/x", { method: "GET", headers: {}, timeoutMs: 1000 })
    ).rejects.toThrow(/respondeu 500$/);
  });

  it("corta resposta acima do teto de bytes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(5000), { status: 200 })));
    await expect(
      safeFetch("https://api.cliente.com/x", { method: "GET", headers: {}, timeoutMs: 1000, maxBytes: 1000 })
    ).rejects.toThrow(/grande demais/);
  });
});

// --- 4 · Projeção -----------------------------------------------------------

describe("projeção de campos", () => {
  it("lê caminho com ponto e índice", () => {
    const payload = { pedido: { itens: [{ nome: "Creatina" }] } };
    expect(readPath(payload, "pedido.itens[0].nome")).toBe("Creatina");
    expect(readPath(payload, "pedido.itens[9].nome")).toBeUndefined();
    expect(readPath(payload, "nada.aqui")).toBeUndefined();
  });

  it("leva SÓ o que foi declarado", () => {
    const payload = { status: "enviado", custo_interno: 12.5, margem: 0.4, cliente_cpf: "123" };
    const { text } = project(payload, [{ path: "status", label: "Status" }], 500);
    expect(text).toBe("Status: enviado");
    expect(text).not.toContain("12.5");
    expect(text).not.toContain("123");
  });

  it("não serializa objeto nem array — apontar para estrutura é cadastro errado", () => {
    const { text, missing } = project({ itens: [{ nome: "x" }] }, [{ path: "itens", label: "Itens" }], 500);
    expect(text).toBe("");
    expect(missing).toEqual(["itens"]);
  });

  it("corta em linha inteira, nunca no meio de um valor", () => {
    const payload = { a: "1234567890", b: "valor-que-nao-cabe" };
    const { text, truncated } = project(
      payload,
      [
        { path: "a", label: "A" },
        { path: "b", label: "B" }
      ],
      14
    );
    expect(text).toBe("A: 1234567890");
    expect(truncated).toBe(true);
    // O corte é entre linhas: nenhum valor aparece pela metade.
    expect(text.split("\n").every((line) => /^[^:]+: .+$/.test(line))).toBe(true);
  });
});

// --- 5 · Execução -----------------------------------------------------------

describe("execução da ferramenta", () => {
  const manifest = parseManifest(manifestFor("tnt_a", "api.cliente.com"));
  const tool = manifest.ok ? manifest.manifest.tools[0] : null;

  it("monta path, query e credencial, e devolve os campos projetados", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: "enviado", previsao: "amanhã", custo: 9 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTool(manifest.ok ? manifest.manifest : ({} as never), tool!, {
      orderId: "4471",
      telefone: "5511999"
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.cliente.com/pedidos/4471?telefone=5511999");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer segredo-tnt_a");
    expect(init.redirect).toBe("manual");
    expect(result.content[0].text).toBe("Status: enviado\nPrevisão: amanhã");
    expect(result.content[0].text).not.toContain("custo");
  });

  it("recusa antes de chamar quando falta parâmetro obrigatório", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await runTool(manifest.ok ? manifest.manifest : ({} as never), tool!, { orderId: "4471" });
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("responde em texto quando a API do cliente falha — o turno segue sem o bloco", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    const result = await runTool(manifest.ok ? manifest.manifest : ({} as never), tool!, {
      orderId: "1",
      telefone: "5511"
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/503/);
  });

  it("diz que não achou em vez de devolver vazio", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ outra_coisa: 1 }), { status: 200 })));
    const result = await runTool(manifest.ok ? manifest.manifest : ({} as never), tool!, {
      orderId: "1",
      telefone: "5511"
    });
    expect(result.content[0].text).toMatch(/Nenhum dado encontrado/);
  });

  it("descarta argumento que não é escalar", () => {
    expect(asStringArgs({ a: "x", b: 2, c: true, d: { nested: 1 }, e: ["x"] })).toEqual({
      a: "x",
      b: "2",
      c: "true"
    });
  });
});

// --- 6 · Projeção de LISTA (busca de catálogo) ------------------------------
//
// Sem caminho de repetição, uma ferramenta de busca voltava praticamente vazia:
// a resposta é `{ produtos: [...] }` e a projeção só lia folha escalar, então
// quem cadastrasse teria de declarar `produtos[0].nome`, `produtos[1].nome`, um
// índice por vez — e a lista sumia quando o cliente devolvia mais itens do que
// alguém teve paciência de declarar.
//
// É o que permite o agente SUGERIR a partir do catálogo do cliente: o bloco
// chega como texto no prompt e o modelo escolhe entre o que veio.

// ---------------------------------------------------------------------------
// O cache das consultas de NEGÓCIO.
//
// Três propriedades, e cada uma é uma linha de teste: (1) dentro da validade
// ninguém vai ao fio; (2) vencida e com a API fora, a resposta anterior sai com
// a idade declarada — e falha nunca é gravada; (3) consulta de CLIENTE nunca
// passa por aqui, nem quando alguém tenta declarar TTL nela.
// ---------------------------------------------------------------------------

describe("cache das consultas de negócio", () => {
  const withBusiness = (cacheTtlS?: number) =>
    parseManifest({
      ...manifestFor("tnt_a", "api.cliente.com"),
      tools: [
        ...manifestFor("tnt_a", "api.cliente.com").tools,
        {
          name: "tabela_precos",
          description: "Planos e valores",
          method: "GET",
          path: "/planos",
          scope: "business",
          params: [{ name: "nome", in: "query" }],
          fields: [{ path: "[].nome", label: "Plano" }, { path: "[].valor", label: "Valor" }],
          ...(cacheTtlS === undefined ? {} : { cacheTtlS })
        }
      ]
    });

  /** KV de mentira que registra puts e honra get. */
  const fakeCache = () => {
    const data = new Map<string, string>();
    return {
      data,
      get: async (key: string) => data.get(key) ?? null,
      put: async (key: string, value: string) => void data.set(key, value)
    };
  };

  const planos = (n: number) => new Response(JSON.stringify([{ nome: `Plano ${n}`, valor: 100 + n }]), { status: 200 });

  it("dentro da validade, a segunda consulta não vai ao fio", async () => {
    const built = withBusiness(600);
    if (!built.ok) throw new Error(built.error);
    const tool = built.manifest.tools.find((t) => t.name === "tabela_precos")!;
    const fetchMock = vi.fn().mockResolvedValueOnce(planos(1)).mockResolvedValueOnce(planos(2));
    vi.stubGlobal("fetch", fetchMock);
    const cache = fakeCache();
    let clock = 1_000_000;

    const primeira = await runTool(built.manifest, tool, {}, () => clock, cache);
    clock += 5 * 60_000;
    const segunda = await runTool(built.manifest, tool, {}, () => clock, cache);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(primeira.content[0].text).toBe("Plano: Plano 1 · Valor: 101");
    expect(segunda.content[0].text).toBe("Plano: Plano 1 · Valor: 101");
    // A chave carrega tenant e ferramenta: dois tenants nunca se enxergam.
    expect([...cache.data.keys()][0]).toMatch(/^tool-cache:tnt_a:tabela_precos:[0-9a-f]{64}$/);
  });

  it("vencida, consulta de novo — e argumento diferente é entrada diferente", async () => {
    const built = withBusiness(600);
    if (!built.ok) throw new Error(built.error);
    const tool = built.manifest.tools.find((t) => t.name === "tabela_precos")!;
    const fetchMock = vi.fn().mockResolvedValueOnce(planos(1)).mockResolvedValueOnce(planos(2)).mockResolvedValueOnce(planos(3));
    vi.stubGlobal("fetch", fetchMock);
    const cache = fakeCache();
    let clock = 1_000_000;

    await runTool(built.manifest, tool, {}, () => clock, cache);
    clock += 11 * 60_000;
    const vencida = await runTool(built.manifest, tool, {}, () => clock, cache);
    const outra = await runTool(built.manifest, tool, { nome: "vip" }, () => clock, cache);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(vencida.content[0].text).toBe("Plano: Plano 2 · Valor: 102");
    expect(outra.content[0].text).toBe("Plano: Plano 3 · Valor: 103");
    expect(cache.data.size).toBe(2);
  });

  it("vencida e com a API fora, serve a resposta anterior com a idade declarada — e não grava a falha", async () => {
    const built = withBusiness(600);
    if (!built.ok) throw new Error(built.error);
    const tool = built.manifest.tools.find((t) => t.name === "tabela_precos")!;
    const fetchMock = vi.fn().mockResolvedValueOnce(planos(1)).mockResolvedValue(new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const cache = fakeCache();
    let clock = 1_000_000;

    await runTool(built.manifest, tool, {}, () => clock, cache);
    const gravado = cache.data.get([...cache.data.keys()][0]);
    clock += 2 * 60 * 60_000;
    const result = await runTool(built.manifest, tool, {}, () => clock, cache);

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe(
      "Plano: Plano 1 · Valor: 101\nObservação: dados consultados há 2 h; o sistema da academia não respondeu agora."
    );
    expect(cache.data.get([...cache.data.keys()][0])).toBe(gravado);
  });

  it("passado o teto do vencido, a falha é a falha — resposta de ontem não vira preço de hoje", async () => {
    const built = withBusiness(600);
    if (!built.ok) throw new Error(built.error);
    const tool = built.manifest.tools.find((t) => t.name === "tabela_precos")!;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(planos(1)).mockResolvedValue(new Response("", { status: 503 })));
    const cache = fakeCache();
    let clock = 1_000_000;

    await runTool(built.manifest, tool, {}, () => clock, cache);
    clock += 25 * 60 * 60_000;
    const result = await runTool(built.manifest, tool, {}, () => clock, cache);

    expect(result.isError).toBe(true);
  });

  it("sem TTL declarado, ou sem cache injetado, toda chamada vai ao fio", async () => {
    const semTtl = withBusiness();
    if (!semTtl.ok) throw new Error(semTtl.error);
    const tool = semTtl.manifest.tools.find((t) => t.name === "tabela_precos")!;
    const fetchMock = vi.fn().mockResolvedValue(planos(1));
    vi.stubGlobal("fetch", fetchMock);
    const cache = fakeCache();

    await runTool(semTtl.manifest, tool, {}, Date.now, cache);
    await runTool(semTtl.manifest, tool, {}, Date.now, cache);
    expect(cache.data.size).toBe(0);

    const comTtl = withBusiness(600);
    if (!comTtl.ok) throw new Error(comTtl.error);
    await runTool(comTtl.manifest, comTtl.manifest.tools.find((t) => t.name === "tabela_precos")!, {});
    await runTool(comTtl.manifest, comTtl.manifest.tools.find((t) => t.name === "tabela_precos")!, {});
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("consulta de CLIENTE nunca é cacheada — o esquema recusa TTL fora de business", async () => {
    const tentativa = parseManifest({
      ...manifestFor("tnt_a", "api.cliente.com"),
      tools: [{ ...manifestFor("tnt_a", "api.cliente.com").tools[0], cacheTtlS: 600 }]
    });
    expect(tentativa.ok).toBe(false);
    if (!tentativa.ok) expect(tentativa.error).toMatch(/cacheTtlS só existe em escopo business/);

    // E a consulta de cliente de sempre, com cache injetado, segue sem gravar nada.
    const built = withBusiness(600);
    if (!built.ok) throw new Error(built.error);
    const cliente = built.manifest.tools.find((t) => t.name === "consultar_pedido")!;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 })));
    const cache = fakeCache();
    await runTool(built.manifest, cliente, { orderId: "1", telefone: "5511" }, Date.now, cache);
    expect(cache.data.size).toBe(0);
  });
});

describe("projeção de lista", () => {
  const payload = {
    produtos: [
      { nome: "Creatina", preco: "R$ 89", estoque: 3 },
      { nome: "Whey", preco: "R$ 149", estoque: 0 },
      { nome: "BCAA", preco: "R$ 59", estoque: 12 }
    ]
  };
  const fields = [
    { path: "produtos[].nome", label: "Produto" },
    { path: "produtos[].preco", label: "Preço" }
  ];

  it("projeta TODOS os itens, uma linha por item", () => {
    const { text } = project(payload, fields, 500);
    expect(text.split("\n")).toEqual([
      "Produto: Creatina · Preço: R$ 89",
      "Produto: Whey · Preço: R$ 149",
      "Produto: BCAA · Preço: R$ 59"
    ]);
  });

  it("agrupa POR ITEM, não por campo — preço colado no produto errado é a pior saída", () => {
    const { text } = project(payload, fields, 500);
    // Cada linha carrega o par completo; nada de "todos os nomes, depois todos
    // os preços", que daria ao modelo a chance de parear errado.
    for (const line of text.split("\n")) {
      expect(line).toMatch(/^Produto: .+ · Preço: .+$/);
    }
  });

  it("respeita o teto cortando em item inteiro", () => {
    const { text, truncated } = project(payload, fields, 40);
    expect(truncated).toBe(true);
    expect(text).toBe("Produto: Creatina · Preço: R$ 89");
  });

  it("convive com campo escalar na mesma projeção", () => {
    const { text } = project({ total: 3, ...payload }, [{ path: "total", label: "Encontrados" }, ...fields], 500);
    expect(text.split("\n")[0]).toBe("Encontrados: 3");
    expect(text.split("\n")).toHaveLength(4);
  });

  it("lista vazia ou ausente é reportada como campo faltando, não como linha vazia", () => {
    expect(project({ produtos: [] }, fields, 500).text).toBe("");
    expect(project({ produtos: [] }, fields, 500).missing).toContain("produtos[].nome");
    expect(project({}, fields, 500).text).toBe("");
  });

  it("pula item sem nenhum campo legível em vez de gastar o teto com linha vazia", () => {
    const { text } = project({ produtos: [{ outra: 1 }, { nome: "Whey", preco: "R$ 149" }] }, fields, 500);
    expect(text).toBe("Produto: Whey · Preço: R$ 149");
  });

  it("lê o caminho de repetição, incluindo aninhado", () => {
    expect(parseRepeatPath("produtos[].nome")).toEqual({ listPath: "produtos", leafPath: "nome" });
    expect(parseRepeatPath("dados.itens[].preco.valor")).toEqual({ listPath: "dados.itens", leafPath: "preco.valor" });
    expect(parseRepeatPath("status")).toBeNull();
  });

  it("continua NÃO serializando objeto — repetição não é porta dos fundos para JSON cru", () => {
    const { text } = project({ produtos: [{ nome: { pt: "Creatina" } }] }, [{ path: "produtos[].nome", label: "Produto" }], 500);
    expect(text).toBe("");
  });
});
