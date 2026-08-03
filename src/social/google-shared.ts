/**
 * Shared OAuth handling for the Google MCP servers (Business Profile,
 * YouTube, Ads and Analytics).
 *
 * Google access tokens expire in about an hour, so a deployed Worker cannot
 * rely on a static one. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and
 * GOOGLE_REFRESH_TOKEN and this module mints access tokens on demand, caching
 * them in the isolate until shortly before they expire. A plain
 * GOOGLE_ACCESS_TOKEN is still honoured (handy for local testing).
 */
import { MissingSecretError, callJson } from "./shared";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** Isolate-local cache. Worker isolates are short-lived, so this is enough. */
let cached: { token: string; expiresAt: number } | null = null;

/** Refreshed this many milliseconds before the real expiry, to avoid races. */
const EXPIRY_MARGIN_MS = 60_000;

export async function googleAccessToken(env: Env): Promise<string> {
  const staticToken = (env as Record<string, unknown>).GOOGLE_ACCESS_TOKEN;
  if (typeof staticToken === "string" && staticToken.length > 0) {
    return staticToken;
  }

  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const clientId = read(env, "GOOGLE_CLIENT_ID");
  const clientSecret = read(env, "GOOGLE_CLIENT_SECRET");
  const refreshToken = read(env, "GOOGLE_REFRESH_TOKEN");

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    }),
    signal: AbortSignal.timeout(15_000)
  });

  const payload = (await response.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  } | null;

  if (!response.ok || !payload?.access_token) {
    throw new Error(
      `Failed to refresh the Google token: ${
        payload?.error_description ?? payload?.error ?? response.status
      }`
    );
  }

  cached = {
    token: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000 - EXPIRY_MARGIN_MS
  };

  return cached.token;
}

function read(env: Env, key: string): string {
  const value = (env as Record<string, unknown>)[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new MissingSecretError(key);
  }
  return value;
}

export async function googleAuth(env: Env): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await googleAccessToken(env)}` };
}

/** GET against a Google API with the OAuth header already applied. */
export async function googleGet(
  env: Env,
  url: string,
  query?: Record<string, string | number | boolean | undefined | null>
) {
  return callJson(url, { headers: await googleAuth(env), query });
}

/** POST against a Google API with the OAuth header already applied. */
export async function googlePost(
  env: Env,
  url: string,
  body: unknown,
  query?: Record<string, string | number | boolean | undefined | null>
) {
  return callJson(url, {
    method: "POST",
    headers: await googleAuth(env),
    body,
    query
  });
}
