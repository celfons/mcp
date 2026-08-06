import { describe, it, expect } from "vitest";
import { putManifest, deleteManifest, getManifest, secretsMatch, putEvoPreset } from "../src/tenant/admin";
import { parseManifest } from "../src/tenant/manifest";
import { hashToken } from "../src/tenant/store";

// ---------------------------------------------------------------------------
// A rota de administração dos manifestos (celfons/whatsapp#1327).
//
// O que ela existe para impedir, e é o que estes testes falsificam:
//
//  1. GRAVAR MANIFESTO INVÁLIDO. O `parseManifest` já recusava inteiro — mas só
//     rodava na LEITURA. JSON quebrado entrava calado pelo painel e a falha
//     aparecia depois, como um agente respondendo sem o dado.
//  2. VAZAR CREDENCIAL. O GET devolve o manifesto sem a credencial da API do
//     cliente: só se ela existe.
//  3. FICAR ABERTA. Sem `ADMIN_TOKEN` configurado a rota responde 503 —
//     ausência de credencial nunca vira "aberto".
// ---------------------------------------------------------------------------

const ADMIN = "segredo-de-admin-com-tamanho";
const TOKEN = "token-do-tenant-1234567890";

const manifest = (tenantId = "tnt_1") => ({
  tenantId,
  label: "ERP da Loja",
  baseUrl: "https://api.cliente.com",
  auth: { type: "bearer", token: "credencial-do-cliente" },
  tools: [
    {
      name: "consultar_pedido",
      description: "Status do pedido",
      method: "GET",
      path: "/pedidos/{orderId}",
      scope: "customer",
      identityParam: "telefone",
      params: [
        { name: "orderId", in: "path", required: true },
        { name: "telefone", in: "query", required: true }
      ],
      fields: [{ path: "status", label: "Status" }]
    }
  ]
});

/** KV de mentira que registra o que foi gravado. */
const fakeKv = () => {
  const data = new Map<string, string>();
  return {
    data,
    put: async (key: string, value: string) => void data.set(key, value),
    get: async (key: string, type?: string) => {
      const raw = data.get(key);
      if (raw === undefined) return null;
      return type === "json" ? JSON.parse(raw) : raw;
    },
    delete: async (key: string) => void data.delete(key)
  };
};

/**
 * `null` significa "ADMIN_TOKEN ausente". Não use `undefined` aqui: passar
 * `undefined` a um parâmetro com valor default dispara o DEFAULT em JS, e o
 * teste do 503 passaria com a rota aberta — foi o que aconteceu na primeira
 * versão deste arquivo.
 */
const envWith = (kv: ReturnType<typeof fakeKv>, adminToken: string | null = ADMIN) =>
  ({ TENANT_MANIFESTS: kv, ...(adminToken === null ? {} : { ADMIN_TOKEN: adminToken }) }) as unknown as Env;

const req = (body: unknown, token: string | null = ADMIN) =>
  new Request("https://gw.test/admin/tenants/tnt_1/manifest", {
    method: "PUT",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body)
  });

describe("autorização", () => {
  it("sem ADMIN_TOKEN configurado, a rota fica fechada em 503 — nunca aberta", async () => {
    const kv = fakeKv();
    const result = await putManifest(req({ manifest: manifest() }), envWith(kv, null), "tnt_1");
    expect(result.status).toBe(503);
    expect(kv.data.size).toBe(0);
  });

  it("recusa token errado ou ausente, sem gravar", async () => {
    const kv = fakeKv();
    expect((await putManifest(req({ manifest: manifest() }, null), envWith(kv), "tnt_1")).status).toBe(401);
    expect((await putManifest(req({ manifest: manifest() }, "errado-mas-do-tamanho-certo"), envWith(kv), "tnt_1")).status).toBe(401);
    expect(kv.data.size).toBe(0);
  });

  it("compara em tempo constante", () => {
    expect(secretsMatch("abc", "abc")).toBe(true);
    expect(secretsMatch("abc", "abd")).toBe(false);
    expect(secretsMatch("abc", "abcd")).toBe(false);
  });
});

describe("gravação", () => {
  it("grava manifesto e índice do token — as duas chaves, que só servem juntas", async () => {
    const kv = fakeKv();
    const result = await putManifest(req({ manifest: manifest(), token: TOKEN }), envWith(kv), "tnt_1");

    expect(result.status).toBe(200);
    expect(kv.data.get("tenant-manifest:tnt_1")).toContain("consultar_pedido");
    expect(kv.data.get(`tenant-token:${await hashToken(TOKEN)}`)).toBe("tnt_1");
    // O token em claro não aparece em chave nenhuma.
    expect([...kv.data.keys()].join("|")).not.toContain(TOKEN);
    expect(result.body.tokenIndexed).toBe(true);
  });

  it("devolve o escopo por ferramenta — é o que o portal confere contra o tool_policy", async () => {
    const kv = fakeKv();
    const result = await putManifest(req({ manifest: manifest(), token: TOKEN }), envWith(kv), "tnt_1");
    expect(result.body.tools).toEqual([{ name: "consultar_pedido", scope: "customer" }]);
  });

  it("recusa manifesto inválido com motivo NOMEADO e não grava nada", async () => {
    const kv = fakeKv();
    const bad = manifest();
    // Ferramenta customer sem o parâmetro de identidade declarado: o backend a
    // recusaria e o turno seguiria sem lastro, calado.
    bad.tools[0].params = [{ name: "orderId", in: "path", required: true }];

    const result = await putManifest(req({ manifest: bad }), envWith(kv), "tnt_1");
    expect(result.status).toBe(400);
    expect(String(result.body.error)).toMatch(/identityParam/);
    expect(kv.data.size).toBe(0);
  });

  it("recusa manifesto cujo tenantId não casa com o da URL", async () => {
    const kv = fakeKv();
    const result = await putManifest(req({ manifest: manifest("tnt_outro") }), envWith(kv), "tnt_1");
    expect(result.status).toBe(400);
    expect(kv.data.size).toBe(0);
  });

  it("recusa corpo que não é JSON", async () => {
    const kv = fakeKv();
    const request = new Request("https://gw.test/admin/tenants/tnt_1/manifest", {
      method: "PUT",
      headers: { Authorization: `Bearer ${ADMIN}` },
      body: "isto não é json"
    });
    expect((await putManifest(request, envWith(kv), "tnt_1")).status).toBe(400);
    expect(kv.data.size).toBe(0);
  });

  it("recusa token curto demais", async () => {
    const kv = fakeKv();
    const result = await putManifest(req({ manifest: manifest(), token: "curto" }), envWith(kv), "tnt_1");
    expect(result.status).toBe(400);
    expect(kv.data.size).toBe(0);
  });

  it("aceita gravar manifesto sem token — trocar endpoint não obriga a rotacionar", async () => {
    const kv = fakeKv();
    const result = await putManifest(req({ manifest: manifest() }), envWith(kv), "tnt_1");
    expect(result.status).toBe(200);
    expect(result.body.tokenIndexed).toBe(false);
    expect(kv.data.has("tenant-manifest:tnt_1")).toBe(true);
  });
});

describe("leitura e remoção", () => {
  it("o GET não devolve a credencial da API do cliente", async () => {
    const kv = fakeKv();
    await putManifest(req({ manifest: manifest() }), envWith(kv), "tnt_1");

    const result = await getManifest(
      new Request("https://gw.test/admin/tenants/tnt_1/manifest", {
        headers: { Authorization: `Bearer ${ADMIN}` }
      }),
      envWith(kv),
      "tnt_1"
    );

    expect(result.status).toBe(200);
    expect(JSON.stringify(result.body)).not.toContain("credencial-do-cliente");
    expect(JSON.stringify(result.body)).toContain("consultar_pedido");
    expect((result.body.manifest as { auth: { configured: boolean } }).auth.configured).toBe(true);
  });

  it("o GET de um tenant sem manifesto é 404", async () => {
    const kv = fakeKv();
    const result = await getManifest(
      new Request("https://gw.test/admin/tenants/tnt_x/manifest", {
        headers: { Authorization: `Bearer ${ADMIN}` }
      }),
      envWith(kv),
      "tnt_x"
    );
    expect(result.status).toBe(404);
  });

  it("o DELETE torna o tenant inalcançável", async () => {
    const kv = fakeKv();
    await putManifest(req({ manifest: manifest(), token: TOKEN }), envWith(kv), "tnt_1");

    await deleteManifest(
      new Request("https://gw.test/admin/tenants/tnt_1/manifest", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${ADMIN}` }
      }),
      envWith(kv),
      "tnt_1"
    );

    expect(kv.data.has("tenant-manifest:tnt_1")).toBe(false);
    // O índice fica: a chave dele é o hash, e o hash só se obtém do token. Sem
    // manifesto ele não alcança nada — é inerte, e varrer o KV para achá-lo
    // seria a listagem que este desenho não tem.
    expect(kv.data.has(`tenant-token:${await hashToken(TOKEN)}`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A rota de PRESET (`PUT /admin/tenants/:id/preset/evo`).
//
// Ela é um atalho de ATIVAÇÃO, não um caminho de gravação paralelo — e essa
// distinção é o que estes testes cobram. Um preset que gravasse sem passar pelo
// `parseManifest` seria a volta do problema que a rota irmã resolveu, com outra
// roupa.
//
// O segundo risco é próprio dela: ela guarda a credencial da EVO. Uma resposta
// que a devolvesse a poria em log de operador, em histórico de terminal e em
// print de tela.
// ---------------------------------------------------------------------------

const presetReq = (body: unknown, token: string | null = ADMIN) =>
  new Request("https://gw.test/admin/tenants/tnt_gym/preset/evo", {
    method: "PUT",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body)
  });

const EVO_BODY = { dns: "minhaacademia", secretKey: "chave-da-evo", idBranch: 4, token: TOKEN };

describe("ativação por preset da EVO", () => {
  it("grava manifesto e índice do token, e devolve a tool_policy da plataforma", async () => {
    const kv = fakeKv();
    const result = await putEvoPreset(presetReq(EVO_BODY), envWith(kv), "tnt_gym");

    expect(result.status).toBe(200);
    expect(kv.data.has("tenant-manifest:tnt_gym")).toBe(true);
    expect(kv.data.get(`tenant-token:${await hashToken(TOKEN)}`)).toBe("tnt_gym");

    // O manifesto gravado é LEGÍVEL pelo mesmo parser da leitura — se não fosse,
    // o tenant seria cadastrado e responderia 500 na primeira pergunta.
    const gravado = parseManifest(JSON.parse(kv.data.get("tenant-manifest:tnt_gym")!));
    expect(gravado.ok).toBe(true);

    // A policy sai daqui pronta para colar na plataforma: transcrevê-la à mão é
    // como uma ferramenta acaba `unclassified` e inchamável sem ninguém ver.
    const body = result.body as { toolPolicy: { version: number; tools: Record<string, unknown> } };
    expect(body.toolPolicy.version).toBe(1);
    expect(Object.keys(body.toolPolicy.tools)).toContain("evo_minhas_cobrancas");
  });

  it("a resposta NUNCA carrega a credencial da EVO", async () => {
    const kv = fakeKv();
    const result = await putEvoPreset(presetReq(EVO_BODY), envWith(kv), "tnt_gym");
    const serializado = JSON.stringify(result.body);
    expect(serializado).not.toContain("chave-da-evo");
    expect(serializado).not.toContain(TOKEN);
    expect(serializado).not.toContain("Basic ");
  });

  it("o tenantId vem da URL, nunca do corpo", async () => {
    const kv = fakeKv();
    await putEvoPreset(presetReq({ ...EVO_BODY, tenantId: "tnt_outro" }), envWith(kv), "tnt_gym");
    expect(kv.data.has("tenant-manifest:tnt_gym")).toBe(true);
    expect(kv.data.has("tenant-manifest:tnt_outro")).toBe(false);
  });

  it("recusa sem credencial da EVO, sem gravar", async () => {
    const kv = fakeKv();
    const semDns = await putEvoPreset(presetReq({ secretKey: "x", token: TOKEN }), envWith(kv), "tnt_gym");
    const semKey = await putEvoPreset(presetReq({ dns: "x", token: TOKEN }), envWith(kv), "tnt_gym");
    expect(semDns.status).toBe(400);
    expect(semKey.status).toBe(400);
    expect(kv.data.size).toBe(0);
  });

  it("recusa idBranch que não é inteiro", async () => {
    const kv = fakeKv();
    const result = await putEvoPreset(presetReq({ ...EVO_BODY, idBranch: "4" }), envWith(kv), "tnt_gym");
    expect(result.status).toBe(400);
    expect(kv.data.size).toBe(0);
  });

  it("herda a autorização da rota irmã — fechada sem ADMIN_TOKEN, 401 com token errado", async () => {
    const kv = fakeKv();
    expect((await putEvoPreset(presetReq(EVO_BODY), envWith(kv, null), "tnt_gym")).status).toBe(503);
    expect((await putEvoPreset(presetReq(EVO_BODY, "errado-mas-do-tamanho-certo"), envWith(kv), "tnt_gym")).status).toBe(401);
    expect(kv.data.size).toBe(0);
  });
});
