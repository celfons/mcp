import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { registerFacebookTools } from "./social/facebook";
import { registerInstagramTools } from "./social/instagram";
import { registerTwitterTools } from "./social/twitter";
import { registerWhatsappTools } from "./social/whatsapp";
import { registerGoogleBusinessTools } from "./social/google-business";
import { registerYoutubeTools } from "./social/youtube";
import { registerGoogleAdsTools } from "./social/google-ads";
import { registerGoogleAnalyticsTools } from "./social/google-analytics";
import { registerTenantTools } from "./tenant/gateway";
import { resolveTenant, type ResolvedTenant } from "./tenant/store";

const VERSION = "2.0.0";

/**
 * O endpoint do gateway por tenant (celfons/whatsapp#1324).
 *
 * Ele é diferente de todos os outros deste Worker, e a diferença é a razão de
 * existir: as ferramentas não são fixas no código — são SINTETIZADAS do
 * manifesto do tenant que está chamando, resolvido pelo token da requisição.
 * Por isso ele não aparece no mapa `SERVERS` abaixo (que é estático) e é tratado
 * antes dele no `fetch`.
 */
const TENANT_PATH = "/mcp/tenant";

type Registrar = (server: McpServer, env: Env) => void;

/** One MCP endpoint per social network, plus an aggregate at /mcp. */
const SERVERS: Record<
  string,
  { name: string; description: string; register: Registrar[] }
> = {
  "/mcp": {
    name: "Social MCP Portal",
    description: "Every social and Google tool in a single endpoint",
    register: [
      registerInstagramTools,
      registerFacebookTools,
      registerTwitterTools,
      registerWhatsappTools,
      registerGoogleBusinessTools,
      registerYoutubeTools,
      registerGoogleAdsTools,
      registerGoogleAnalyticsTools
    ]
  },
  "/mcp/instagram": {
    name: "Instagram MCP Server",
    description: "Instagram Graph API tools",
    register: [registerInstagramTools]
  },
  "/mcp/facebook": {
    name: "Facebook MCP Server",
    description: "Facebook Pages Graph API tools",
    register: [registerFacebookTools]
  },
  "/mcp/x": {
    name: "X (Twitter) MCP Server",
    description: "X API v2 tools",
    register: [registerTwitterTools]
  },
  "/mcp/whatsapp": {
    name: "WhatsApp MCP Server",
    description: "WhatsApp Cloud API tools",
    register: [registerWhatsappTools]
  },
  "/mcp/google": {
    name: "Google MCP Server",
    description: "Business Profile, YouTube, Ads and Analytics in one endpoint",
    register: [
      registerGoogleBusinessTools,
      registerYoutubeTools,
      registerGoogleAdsTools,
      registerGoogleAnalyticsTools
    ]
  },
  "/mcp/google-business": {
    name: "Google Business Profile MCP Server",
    description: "Listings, reviews and posts on Google Business Profile",
    register: [registerGoogleBusinessTools]
  },
  "/mcp/youtube": {
    name: "YouTube MCP Server",
    description: "YouTube Data API v3 tools",
    register: [registerYoutubeTools]
  },
  "/mcp/google-ads": {
    name: "Google Ads MCP Server",
    description: "Campaigns, keywords and GAQL reports",
    register: [registerGoogleAdsTools]
  },
  "/mcp/google-analytics": {
    name: "Google Analytics (GA4) MCP Server",
    description: "GA4 Data API and Admin API reports",
    register: [registerGoogleAnalyticsTools]
  }
};

/**
 * O servidor do gateway: só as ferramentas DESTE tenant, e nenhuma das sociais.
 *
 * Não há `ping` aqui de propósito. O `ping` das outras rotas relata quais
 * credenciais estão configuradas — informação de operação, inofensiva num
 * endpoint nosso e indevida num endpoint que um tenant alcança.
 */
function createTenantServer(tenant: ResolvedTenant) {
  const server = new McpServer({
    name: `Tenant API Gateway — ${tenant.manifest.label}`,
    version: VERSION
  });
  registerTenantTools(server, tenant.manifest);
  return server;
}

function createServer(path: string, env: Env) {
  const config = SERVERS[path] ?? SERVERS["/mcp"];
  const server = new McpServer({ name: config.name, version: VERSION });

  server.registerTool(
    "ping",
    {
      description:
        "Health check: confirms the server is up and reports which credentials are configured.",
      inputSchema: { name: z.string().optional() }
    },
    async ({ name }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              server: config.name,
              version: VERSION,
              greeting: `Hello, ${name ?? "World"}!`,
              credentials: {
                instagram: hasSecret(env, "INSTAGRAM_ACCESS_TOKEN"),
                facebook: hasSecret(env, "FACEBOOK_ACCESS_TOKEN"),
                x: hasSecret(env, "X_BEARER_TOKEN"),
                xUserContext: hasSecret(env, "X_USER_ACCESS_TOKEN"),
                whatsapp: hasSecret(env, "WHATSAPP_ACCESS_TOKEN"),
                whatsappPhoneNumberId: hasSecret(
                  env,
                  "WHATSAPP_PHONE_NUMBER_ID"
                ),
                google:
                  hasSecret(env, "GOOGLE_REFRESH_TOKEN") ||
                  hasSecret(env, "GOOGLE_ACCESS_TOKEN"),
                youtubeApiKey: hasSecret(env, "YOUTUBE_API_KEY"),
                googleAdsDeveloperToken: hasSecret(
                  env,
                  "GOOGLE_ADS_DEVELOPER_TOKEN"
                ),
                ga4PropertyId: hasSecret(env, "GA4_PROPERTY_ID")
              }
            },
            null,
            2
          )
        }
      ]
    })
  );

  for (const register of config.register) register(server, env);

  return server;
}

function hasSecret(env: Env, key: string): boolean {
  const value = (env as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0;
}

/** Motivo → status + frase. Nenhuma delas conta ao chamador o que existe do outro lado. */
const TENANT_REFUSAL: Record<string, { status: number; message: string }> = {
  no_store: { status: 503, message: "Gateway por tenant não está configurado neste ambiente." },
  no_token: { status: 401, message: "Authorization: Bearer <token> é obrigatório." },
  unknown_token: { status: 401, message: "Token não reconhecido." },
  no_manifest: { status: 404, message: "Nenhum manifesto cadastrado para este tenant." },
  invalid_manifest: { status: 500, message: "O manifesto deste tenant está inválido." }
};

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const path = pathname.replace(/\/+$/, "") || "/mcp";

    if (path === TENANT_PATH) {
      // O tenant é resolvido ANTES de qualquer ferramenta ser montada: anunciar
      // uma ferramenta antes de saber de quem ela é seria não ter isolamento.
      const resolved = await resolveTenant(request, env);
      if (!resolved.ok) {
        const refusal = TENANT_REFUSAL[resolved.reason];
        return new Response(JSON.stringify({ error: refusal.message }), {
          status: refusal.status,
          headers: { "Content-Type": "application/json" }
        });
      }
      return createMcpHandler(() => createTenantServer(resolved.tenant), { route: TENANT_PATH })(
        request,
        env,
        ctx
      );
    }

    if (!(path in SERVERS) && path.startsWith("/mcp")) {
      return new Response(
        JSON.stringify({
          error: "Unknown MCP endpoint",
          available: [...Object.keys(SERVERS), TENANT_PATH]
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // The factory runs once per request; `env` is captured from this closure
    // because the MCP handler only passes protocol context to it.
    return createMcpHandler(() => createServer(path, env), { route: path })(
      request,
      env,
      ctx
    );
  }
} satisfies ExportedHandler<Env>;
