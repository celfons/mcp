/**
 * Shared helpers for the social MCP servers (Instagram, Facebook, X).
 *
 * Every platform tool ends up funnelled through `callJson`, so error handling,
 * timeouts and the shape of the MCP tool result stay identical across servers.
 */

export const DEFAULT_GRAPH_VERSION = "v21.0";

export const GRAPH_BASE = "https://graph.facebook.com";
export const X_BASE = "https://api.x.com/2";

/** MCP tool result shape (matches the SDK's expected `content` payload). */
export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export function ok(data: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2)
      }
    ]
  };
}

export function fail(message: string): ToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true
  };
}

/**
 * Reads a credential from the Worker env and fails loudly (but without leaking
 * the value) when it is missing. Store these with `wrangler secret put`.
 */
export function requireSecret(env: Env, key: keyof Env & string): string {
  const value = (env as Record<string, unknown>)[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new MissingSecretError(key);
  }
  return value;
}

export class MissingSecretError extends Error {
  constructor(public readonly key: string) {
    super(
      `Missing secret "${key}". Set it with: npx wrangler secret put ${key}`
    );
    this.name = "MissingSecretError";
  }
}

export function graphVersion(env: Env): string {
  const version = (env as Record<string, unknown>).GRAPH_API_VERSION;
  return typeof version === "string" && version.length > 0
    ? version
    : DEFAULT_GRAPH_VERSION;
}

type CallOptions = {
  method?: "GET" | "POST" | "DELETE";
  /** Query string parameters; `undefined`/`null` entries are dropped. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** JSON body, only used for POST requests. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Milliseconds before the upstream request is aborted. */
  timeoutMs?: number;
};

/**
 * Performs an HTTP call against a social API and normalises the response into
 * parsed JSON. Throws `ApiError` for non-2xx responses so each tool can render
 * a single, consistent error message.
 */
export async function callJson(
  url: string,
  options: CallOptions = {}
): Promise<unknown> {
  const { method = "GET", query, body, headers = {}, timeoutMs = 20_000 } =
    options;

  const target = new URL(url);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      target.searchParams.set(key, String(value));
    }
  }

  const init: RequestInit = {
    method,
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(timeoutMs)
  };

  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = {
      ...(init.headers as Record<string, string>),
      "Content-Type": "application/json"
    };
  }

  const response = await fetch(target.toString(), init);
  const text = await response.text();

  let parsed: unknown = text;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Leave the raw text in place — some error pages are not JSON.
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status, parsed);
  }

  return parsed;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly payload: unknown
  ) {
    super(`Upstream API error ${status}: ${describe(payload)}`);
    this.name = "ApiError";
  }
}

function describe(payload: unknown): string {
  if (typeof payload === "string") return payload.slice(0, 500);
  const record = payload as
    | { error?: { message?: string; type?: string }; detail?: string; title?: string }
    | undefined;
  return (
    record?.error?.message ??
    record?.detail ??
    record?.title ??
    JSON.stringify(payload ?? {}).slice(0, 500)
  );
}

/**
 * Wraps a tool handler so thrown errors become MCP error results instead of
 * blowing up the whole request.
 */
export function guard<A>(
  handler: (args: A) => Promise<ToolResult>
): (args: A) => Promise<ToolResult> {
  return async (args: A) => {
    try {
      return await handler(args);
    } catch (error) {
      if (error instanceof MissingSecretError || error instanceof ApiError) {
        return fail(error.message);
      }
      if (error instanceof DOMException && error.name === "TimeoutError") {
        return fail("Upstream API request timed out.");
      }
      return fail(error instanceof Error ? error.message : String(error));
    }
  };
}
