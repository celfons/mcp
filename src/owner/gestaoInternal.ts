import { createMcpHandler } from "agents/mcp/server";
import { resolveTenant } from "../tenant/store";
import { evoAccessFromManifest } from "./evoGestao";
import { createGestaoServer } from "./gestaoServer";

/**
 * A gestão da academia pela LIGAÇÃO INTERNA (celfons/whatsapp → este Worker).
 *
 * Quem chama aqui é o Worker `whatsapp`, que já autenticou o dono com o login
 * dele (código no WhatsApp / senha, via OAuth do conector) e sabe de qual
 * academia ele é. Ele repassa a chamada MCP com o MESMO token da academia que
 * já guarda cifrado para o gateway do agente (`Authorization: Bearer …`). O
 * token resolve UM tenant — a mesma regra de `/mcp/tenant` —, e daí sai o
 * servidor da gestão, não as ferramentas do agente.
 *
 * Por que isto não abre a gestão a qualquer um com o token: este handler só é
 * alcançável pela entrypoint nomeada `GestaoGateway` (src/index.ts). Entrypoint
 * nomeada não tem rota pública — só um service binding que a declare
 * (`entrypoint = "GestaoGateway"`) chega nela. O `fetch` público deste Worker
 * nunca chama esta função. O token sozinho, vindo da internet, continua abrindo
 * só `/mcp/tenant`, como hoje.
 */
export const GESTAO_INTERNAL_PATH = "/mcp/gestao";

const json = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } });

/** Motivo → status + frase. Nenhuma conta ao chamador o que existe do outro lado. */
const REFUSAL: Record<string, { status: number; message: string }> = {
  no_store: { status: 503, message: "Gestão não está configurada neste ambiente." },
  no_token: { status: 401, message: "Authorization: Bearer <token> é obrigatório." },
  unknown_token: { status: 401, message: "Token não reconhecido." },
  no_manifest: { status: 404, message: "Academia sem integração cadastrada." },
  invalid_manifest: { status: 500, message: "O manifesto desta academia está inválido." }
};

export async function handleGestaoInternal(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  if (path !== GESTAO_INTERNAL_PATH) return json(404, "Rota desconhecida.");

  // O tenant é resolvido ANTES de qualquer ferramenta ser montada.
  const resolved = await resolveTenant(request, env);
  if (!resolved.ok) {
    const refusal = REFUSAL[resolved.reason];
    return json(refusal.status, refusal.message);
  }
  const access = evoAccessFromManifest(resolved.tenant.manifest);
  if (!access) return json(404, "Esta academia não está integrada à EVO.");

  return createMcpHandler(() => createGestaoServer(resolved.tenant, access, env), { route: GESTAO_INTERNAL_PATH })(
    request,
    env,
    ctx
  );
}
