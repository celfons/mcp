/**
 * Quem é o DONO que está chamando — pelo login do Cloudflare Access.
 *
 * A rota `/mcp/gestao/<tenantId>` não aceita token por tenant (o claude.ai não
 * manda cabeçalho fixo). Ela fica atrás do portal MCP com OAuth, que é um
 * aplicativo do Cloudflare Access; o Access entrega a esta origem o JWT da
 * sessão em `Cf-Access-Jwt-Assertion`. Validamos aqui de novo — assinatura,
 * audiência, emissor e validade — porque um cabeçalho que ninguém valida é
 * um cabeçalho que qualquer um escreve.
 *
 * Configuração (vars): `ACCESS_TEAM_DOMAIN` (ex.: `closing.cloudflareaccess.com`)
 * e `ACCESS_AUD` (o "Application Audience (AUD) Tag" do aplicativo do portal).
 * Sem as duas, a rota responde 503: ausência de configuração nunca libera.
 */

export type AccessIdentity = { ok: true; email: string } | { ok: false; status: number; reason: string };

type Jwk = { kid: string; kty: string; n: string; e: string; alg?: string };

const JWKS_TTL_MS = 10 * 60 * 1000;
let jwksCache: { team: string; at: number; keys: Jwk[] } | null = null;

function b64urlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(part))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function loadKeys(team: string, fetcher: typeof fetch, now: number): Promise<Jwk[]> {
  if (jwksCache && jwksCache.team === team && now - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetcher(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`certs ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache = { team, at: now, keys };
  return keys;
}

/** Só para testes: esquece as chaves em cache. */
export function resetAccessKeyCache(): void {
  jwksCache = null;
}

export async function verifyAccess(
  request: Request,
  env: Env,
  deps: { fetcher?: typeof fetch; now?: () => number } = {}
): Promise<AccessIdentity> {
  const vars = env as Record<string, unknown>;
  const team = typeof vars.ACCESS_TEAM_DOMAIN === "string" ? vars.ACCESS_TEAM_DOMAIN.trim() : "";
  const aud = typeof vars.ACCESS_AUD === "string" ? vars.ACCESS_AUD.trim() : "";
  if (!team || !aud) return { ok: false, status: 503, reason: "Acesso do dono não está configurado neste ambiente." };

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return { ok: false, status: 401, reason: "Sessão do Cloudflare Access ausente." };

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, status: 401, reason: "Sessão inválida." };
  const header = decodeJson(parts[0]);
  const payload = decodeJson(parts[1]);
  if (!header || !payload || header.alg !== "RS256" || typeof header.kid !== "string") {
    return { ok: false, status: 401, reason: "Sessão inválida." };
  }

  const now = (deps.now ?? Date.now)();
  let keys: Jwk[];
  try {
    keys = await loadKeys(team, deps.fetcher ?? fetch, now);
  } catch {
    return { ok: false, status: 503, reason: "Não foi possível validar a sessão agora." };
  }
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, status: 401, reason: "Sessão inválida." };

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!valid) return { ok: false, status: 401, reason: "Sessão inválida." };

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(aud)) return { ok: false, status: 401, reason: "Sessão de outro aplicativo." };
  if (payload.iss !== `https://${team}`) return { ok: false, status: 401, reason: "Sessão de outro emissor." };
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= now) {
    return { ok: false, status: 401, reason: "Sessão expirada." };
  }
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email) return { ok: false, status: 401, reason: "Sessão sem e-mail." };
  return { ok: true, email };
}
