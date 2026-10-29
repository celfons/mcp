import { describe, it, expect } from "vitest";
import worker from "../src/server";

/**
 * /esquina/* é repassado ao Worker esquina-social pelo service binding, com a
 * requisição intacta (o JWT do Access vai junto e é validado de novo lá).
 */
function envWith(esquina?: { fetch: (r: Request) => Promise<Response> }) {
  return { ESQUINA: esquina } as unknown as Env;
}
const ctx = {} as ExecutionContext;

describe("rota /esquina", () => {
  it("repassa a requisição inteira ao binding", async () => {
    const seen: Request[] = [];
    const env = envWith({ fetch: async (r) => (seen.push(r), new Response("ok-esquina")) });
    const req = new Request("https://mcp-social.example.workers.dev/esquina/mcp/publisher", {
      method: "POST",
      headers: { "cf-access-jwt-assertion": "jwt" },
      body: "{}"
    });
    const res = await worker.fetch!(req as any, env, ctx);
    expect(await res.text()).toBe("ok-esquina");
    expect(seen[0]).toBe(req);
  });

  it("cobre o prefixo exato e não captura prefixos parecidos", async () => {
    let calls = 0;
    const env = envWith({ fetch: async () => (calls++, new Response("x")) });
    await worker.fetch!(new Request("https://h/esquina") as any, env, ctx);
    await worker.fetch!(new Request("https://h/esquinas/mcp") as any, env, ctx);
    expect(calls).toBe(1);
  });

  it("sem o binding responde 503", async () => {
    const res = await worker.fetch!(new Request("https://h/esquina/painel") as any, envWith(), ctx);
    expect(res.status).toBe(503);
  });
});
