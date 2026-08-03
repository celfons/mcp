/**
 * Secrets and variables used by the social MCP servers.
 * Merged into the Wrangler-generated `Env` so `wrangler types` can be re-run
 * without losing these declarations.
 */
declare global {
  interface Env {
    /** Graph API version, e.g. "v21.0". Optional — defaults to v21.0. */
    GRAPH_API_VERSION?: string;
    /** Long-lived Instagram token. Falls back to FACEBOOK_ACCESS_TOKEN. */
    INSTAGRAM_ACCESS_TOKEN?: string;
    /** Facebook Page / user access token. */
    FACEBOOK_ACCESS_TOKEN?: string;
    /** X API v2 app-only bearer token (reads). */
    X_BEARER_TOKEN?: string;
    /** X API v2 user-context token (posting/deleting). */
    X_USER_ACCESS_TOKEN?: string;
  }
}

export {};
