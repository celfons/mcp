import { McpServer } from "@modelcontextprotocol/server";
import { registerTenantTools } from "../tenant/gateway";
import type { ResolvedTenant } from "../tenant/store";
import { registerEvoGestaoTools, type EvoAccess } from "./evoGestao";

export const GESTAO_VERSION = "2.0.0";

/**
 * O servidor MCP da GESTÃO de uma academia: as consultas agregadas da EVO e a
 * vitrine (planos, preços, grade). As consultas do ALUNO ficam de fora: elas
 * preencheriam o telefone de quem chama, e o dono não é aluno.
 *
 * Um só lugar que monta este servidor, para as duas portas que o abrem — o
 * login do Access (`/mcp/gestao/<tenantId>`) e a ligação interna com o token da
 * academia (`GestaoGateway`). Duas montagens seriam duas listas de ferramentas
 * divergindo em silêncio.
 */
export function createGestaoServer(tenant: ResolvedTenant, access: EvoAccess, env: Env): McpServer {
  const server = new McpServer({
    name: `Gestão da academia — ${tenant.manifest.label}`,
    version: GESTAO_VERSION
  });
  registerEvoGestaoTools(server, access);
  registerTenantTools(
    server,
    { ...tenant.manifest, tools: tenant.manifest.tools.filter((tool) => tool.scope === "business") },
    env.TENANT_MANIFESTS ?? undefined
  );
  return server;
}
