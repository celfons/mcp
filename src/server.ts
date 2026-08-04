import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { authorize, unauthorized } from "./gateway/auth";
import { resolveCredentials } from "./gateway/tenant";
import { ENDPOINT_POLICY } from "./gateway/toolInventory";
import { registerFacebookTools } from "./social/facebook";
import { registerInstagramTools } from "./social/instagram";
import { registerTwitterTools } from "./social/twitter";
import { registerWhatsappTools } from "./social/whatsapp";
import { registerGoogleBusinessTools } from "./social/google-business";
import { registerYoutubeTools } from "./social/youtube";
import { registerGoogleAdsTools } from "./social/google-ads";
import { registerGoogleAnalyticsTools } from "./social/google-analytics";

const VERSION = "2.0.0";

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

export default {
  fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const path = pathname.replace(/\/+$/, "") || "/mcp";

    // Só as rotas de MCP passam por aqui; o resto (o portal SPA) é servido pelos
    // assets e fica sob a política de Access do domínio.
    if (!path.startsWith("/mcp")) {
      return new Response("Not found", { status: 404 });
    }

    // FRONTEIRA (fundação §1). Antes de qualquer coisa — antes até de decidir se
    // o endpoint existe. Responder 404 "endpoint desconhecido" a quem não se
    // autenticou entrega de graça o mapa da superfície a quem só achou a URL.
    const auth = authorize(request, env);
    if (!auth.ok) {
      console.log(JSON.stringify({ event: "gateway.unauthorized", reason: auth.reason, path }));
      return unauthorized();
    }

    const policy = ENDPOINT_POLICY[path];
    if (!(path in SERVERS) || policy === undefined) {
      // Autenticado e ainda assim inexistente: agora o 404 é informação útil
      // para quem tem direito a ela, e não reconhecimento para um estranho.
      return new Response(JSON.stringify({ error: "Unknown MCP endpoint" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }

    // ESCOPO (fundação §3). Um tenant só alcança endpoint declarado como
    // chamável por tenant. Hoje nenhum é — e a recusa aqui é o que faz disso um
    // fato verificável, em vez de uma intenção escrita na documentação.
    if (auth.caller.kind === "platform" && !policy.tenantCallable) {
      console.log(
        JSON.stringify({ event: "gateway.endpoint_not_tenant_callable", path, tenantId: auth.caller.tenantId })
      );
      return new Response(JSON.stringify({ error: "endpoint not available for tenant calls" }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    }

    // CREDENCIAL (fundação §2). As tools nunca leem `env` direto: leem o que o
    // resolvedor devolveu para ESTE chamador. Hoje a resolução é de frota e
    // recusa qualquer chamada com tenant — por isso a linha abaixo é a segunda
    // barreira, e não a primeira.
    const toolEnv = resolveCredentials(env, { caller: auth.caller.kind, tenantId: auth.caller.tenantId });
    if (toolEnv === null) {
      console.log(JSON.stringify({ event: "gateway.no_credentials", path, caller: auth.caller.kind }));
      return new Response(JSON.stringify({ error: "no credentials for this caller" }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    }

    // A fábrica roda uma vez por requisição; `toolEnv` é capturado deste closure
    // porque o handler MCP só repassa contexto de protocolo para ela.
    return createMcpHandler(() => createServer(path, toolEnv), { route: path })(request, env, ctx);
  }
} satisfies ExportedHandler<Env>;
