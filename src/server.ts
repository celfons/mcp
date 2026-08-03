import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { registerFacebookTools } from "./social/facebook";
import { registerInstagramTools } from "./social/instagram";
import { registerTwitterTools } from "./social/twitter";

const VERSION = "2.0.0";

type Registrar = (server: McpServer, env: Env) => void;

/** One MCP endpoint per social network, plus an aggregate at /mcp. */
const SERVERS: Record<
  string,
  { name: string; description: string; register: Registrar[] }
> = {
  "/mcp": {
    name: "Social MCP Portal",
    description: "Instagram, Facebook and X tools in a single endpoint",
    register: [registerInstagramTools, registerFacebookTools, registerTwitterTools]
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
                xUserContext: hasSecret(env, "X_USER_ACCESS_TOKEN")
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

    if (!(path in SERVERS) && path.startsWith("/mcp")) {
      return new Response(
        JSON.stringify({
          error: "Unknown MCP endpoint",
          available: Object.keys(SERVERS)
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
