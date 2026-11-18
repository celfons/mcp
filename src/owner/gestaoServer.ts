import { McpServer } from "@modelcontextprotocol/server";
import { registerTenantTools } from "../tenant/gateway";
import type { ResolvedTenant } from "../tenant/store";
import { registerEvoGestaoTools, type EvoAccess } from "./evoGestao";
import { registerEvoApiTools } from "./evoApi";
import { registerMetaAdsTools, type MetaAdsScope } from "../social/meta-ads";

export const GESTAO_VERSION = "2.0.0";

/**
 * O servidor MCP da GESTÃO de uma academia: as consultas agregadas da EVO, a
 * API de leitura da EVO rota a rota (`evo_v*_*`) e a vitrine (planos, preços,
 * grade). As consultas do ALUNO ficam de fora: elas
 * preencheriam o telefone de quem chama, e o dono não é aluno.
 *
 * Um só lugar que monta este servidor, para as duas portas que o abrem — o
 * login do Access (`/mcp/gestao/<tenantId>`) e a ligação interna com o token da
 * academia (`GestaoGateway`). Duas montagens seriam duas listas de ferramentas
 * divergindo em silêncio.
 */
export function createGestaoServer(
  tenant: ResolvedTenant,
  access: EvoAccess,
  env: Env,
  metaAds: MetaAdsScope | null = null
): McpServer {
  const server = new McpServer({
    name: `Gestão da academia — ${tenant.manifest.label}`,
    version: GESTAO_VERSION
  });
  registerEvoGestaoTools(server, access);
  // Toda a API de leitura da EVO, uma ferramenta por rota GET, com dado pessoal
  // mascarado. Só aqui: o agente do WhatsApp (`/mcp/tenant`) não as recebe.
  registerEvoApiTools(server, access);
  // Anúncios da Meta da PRÓPRIA academia, quando cadastrados (src/tenant/metaAds.ts): presos à conta dela.
  if (metaAds) registerMetaAdsTools(server, env, metaAds);
  registerTenantTools(
    server,
    { ...tenant.manifest, tools: tenant.manifest.tools.filter((tool) => tool.scope === "business") },
    env.TENANT_MANIFESTS ?? undefined
  );
  return server;
}
