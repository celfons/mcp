import { WorkerEntrypoint } from "cloudflare:workers";
import worker from "./server";
import { handleGestaoInternal } from "./owner/gestaoInternal";

/**
 * Ponto de entrada do Worker (o `main` do wrangler).
 *
 * - `default`: o `fetch` público, com todas as rotas de `server.ts`.
 * - `GestaoGateway`: entrypoint NOMEADA, sem rota pública. Só um service binding
 *   que a declare chega nela — no `whatsapp`:
 *
 *     [[services]]
 *     binding = "MCP_GESTAO"
 *     service = "mcp-social"
 *     entrypoint = "GestaoGateway"
 *
 *   É isso que faz o token da academia abrir a GESTÃO só pela ligação interna:
 *   da internet, o mesmo token continua abrindo só `/mcp/tenant`.
 *
 * Este arquivo existe à parte de `server.ts` porque `cloudflare:workers` só
 * existe no runtime; os testes importam `server.ts` e `gestaoInternal.ts`.
 */
export class GestaoGateway extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    return handleGestaoInternal(request, this.env, this.ctx);
  }
}

export default worker;
