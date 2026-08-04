import { describe, it, expect } from "vitest";
import { authorize } from "../src/gateway/auth";
import { fleetCredentials } from "../src/gateway/tenant";
import { ENDPOINT_POLICY, tenantCallableEndpoints } from "../src/gateway/toolInventory";

// ---------------------------------------------------------------------------
// Os guards da fronteira. Cada um foi VISTO VERMELHO antes de entrar — sabotando
// a linha que ele protege — porque guard que nunca falhou não é guard, é
// decoração que passa a impressão de cobertura.
//
// O que eles travam, e por quê (ver `docs/FOUNDATION.md`):
//   §1 escopo estrutural  → nada entra sem prova, e prova de plataforma exige tenant
//   §2 um dono da credencial → resolução de frota RECUSA chamada com tenant
//   §3 nada alcança o cliente → nenhum endpoint é chamável por tenant hoje
//   §4 inventário fechado → endpoint sem entrada quebra
//   §5 read/write declarados → classe explícita, nunca inferida do nome
// ---------------------------------------------------------------------------

const ENV = { GATEWAY_PLATFORM_SECRET: "s3cr3t-da-plataforma" } as unknown as Env;

const req = (headers: Record<string, string> = {}): Request =>
  new Request("https://gateway.example/mcp", { headers });

describe("§1 · fronteira: nada entra sem prova", () => {
  it("recusa requisição sem nenhuma prova — o default é fechado", () => {
    const r = authorize(req(), ENV);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("no_proof");
  });

  it("aceita o operador quando o Access injetou o cabeçalho no edge", () => {
    const r = authorize(req({ "Cf-Access-Jwt-Assertion": "jwt-que-o-access-emitiu" }), ENV);
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.caller.kind).toBe("operator");
    // Operador não escolhe tenant: se pudesse, o header seria escalada de escopo
    // por digitação — o portal é console de execução, não seletor de cliente.
    expect(r.ok === true && r.caller.tenantId).toBeNull();
  });

  it("IGNORA o header de tenant vindo de um operador", () => {
    const r = authorize(req({ "Cf-Access-Jwt-Assertion": "jwt", "X-Tenant-Id": "acme" }), ENV);
    expect(r.ok === true && r.caller.tenantId).toBeNull();
  });

  it("recusa segredo errado SEM cair para o caminho do operador", () => {
    // A queda seria o defeito: transformaria "segredo inválido" em "tenta como
    // humano", que é o oposto de fail-closed.
    const r = authorize(req({ Authorization: "Bearer errado", "Cf-Access-Jwt-Assertion": "jwt" }), ENV);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("bad_platform_secret");
  });

  it("recusa a plataforma sem tenant — ela SEMPRE age em nome de alguém", () => {
    const r = authorize(req({ Authorization: `Bearer ${ENV.GATEWAY_PLATFORM_SECRET}` }), ENV);
    expect(r.ok === false && r.reason).toBe("missing_tenant");
  });

  it("recusa tenant de forma livre — a borda estreita a forma, não cada consumidor", () => {
    const bad = ["../outro", "a b", "x".repeat(65), "acme;drop"];
    for (const t of bad) {
      const r = authorize(req({ Authorization: `Bearer ${ENV.GATEWAY_PLATFORM_SECRET}`, "X-Tenant-Id": t }), ENV);
      expect(r.ok === false && r.reason, `aceitou tenant malformado: ${t}`).toBe("malformed_tenant");
    }
  });

  it("recusa a plataforma quando o gateway não tem segredo configurado", () => {
    // Sem segredo, "aceitar sem prova" seria a falha silenciosa clássica.
    const r = authorize(req({ Authorization: "Bearer qualquer", "X-Tenant-Id": "acme" }), {} as unknown as Env);
    expect(r.ok === false && r.reason).toBe("gateway_not_configured");
  });

  it("aceita a plataforma com segredo e tenant bem-formados", () => {
    const r = authorize(req({ Authorization: `Bearer ${ENV.GATEWAY_PLATFORM_SECRET}`, "X-Tenant-Id": "acme_1" }), ENV);
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.caller).toEqual({ kind: "platform", tenantId: "acme_1" });
  });
});

describe("§2 · credencial tem um dono", () => {
  it("a resolução de FROTA recusa qualquer chamada com tenant", () => {
    // É o ponto mais importante do arquivo: devolver o env de frota para uma
    // chamada de tenant faria o agente do tenant A operar as contas de quem for
    // dono dos secrets. Segunda barreira, depois do inventário.
    expect(fleetCredentials(ENV, { caller: "platform", tenantId: "acme" })).toBeNull();
  });

  it("a resolução de frota serve o operador", () => {
    expect(fleetCredentials(ENV, { caller: "operator", tenantId: null })).toBe(ENV);
  });
});

describe("§3/§4/§5 · inventário fechado", () => {
  it("nenhum endpoint é chamável por tenant hoje — a lista vazia é o estado correto", () => {
    // Não é lacuna: as credenciais são de frota (§2). Quando UM endpoint virar
    // chamável, esta asserção falha e obriga quem mudou a justificar por escrito.
    expect(tenantCallableEndpoints()).toEqual([]);
  });

  it("o endpoint de WhatsApp jamais é chamável por tenant (§3)", () => {
    // Exclusão permanente: enviar ao cliente final contorna o motor de
    // conformidade inteiro da plataforma.
    expect(ENDPOINT_POLICY["/mcp/whatsapp"].tenantCallable).toBe(false);
  });

  it("toda entrada declara classe e razão escrita de verdade", () => {
    const fracas = Object.entries(ENDPOINT_POLICY)
      .filter(([, p]) => p.why.trim().length < 40 || !/^\((?:R|W)\)/.test(p.why.trim()))
      .map(([path]) => path);
    expect(
      fracas,
      "entrada sem razão escrita ou sem a tag da classe — uma linha que ninguém lê não protege nada",
    ).toEqual([]);
  });

  it("todo endpoint com tool de escrita está declarado como `write`", () => {
    // §5: a classe é declarada, nunca inferida. Só a família de relatórios do
    // GA4 é leitura pura.
    const leitura = Object.entries(ENDPOINT_POLICY)
      .filter(([, p]) => p.toolClass === "read")
      .map(([path]) => path);
    expect(leitura).toEqual(["/mcp/google-analytics"]);
  });
});
