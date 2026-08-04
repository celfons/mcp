/**
 * Quem pode chamar este gateway — a fronteira, fail-closed.
 *
 * DOIS CAMINHOS CHEGAM AQUI, E ELES TÊM CONTROLES DIFERENTES. Confundi-los é o
 * erro que deixa o endpoint aberto achando que está protegido:
 *
 *  1. PÚBLICO (hostname do Worker / domínio próprio) — coberto pelo Cloudflare
 *     Access (Zero Trust). O Access termina no EDGE e injeta
 *     `Cf-Access-Jwt-Assertion` na requisição que repassa à origem. Como este
 *     Worker É a origem, a AUSÊNCIA desse cabeçalho significa que a requisição
 *     não passou por uma política de Access — e é recusada aqui.
 *
 *  2. SERVICE BINDING (a plataforma chamando Worker→Worker) — **o Access NÃO se
 *     aplica**. A invocação por binding não atravessa o edge, então nenhuma
 *     política do Zero Trust é avaliada nela. Neste caminho, a verificação
 *     abaixo é o ÚNICO controle que existe. É por isso que o segredo
 *     compartilhado não é "defesa em profundidade opcional": sem ele, o caminho
 *     que a plataforma usa é o caminho sem porta.
 *
 * O default é RECUSAR. Requisição sem nenhuma das duas provas não vira "chama
 * assim mesmo" — vira 401, e o corpo não enumera endpoints (enumeração é
 * reconhecimento de superfície de graça para quem só achou a URL).
 *
 * LIMITE CONHECIDO, DECLARADO: a prova do caminho 1 é a PRESENÇA do cabeçalho do
 * Access, não a verificação criptográfica do JWT contra o JWKS do time. Isso
 * basta enquanto todo caminho público até este Worker passar por uma política de
 * Access — e deixa de bastar no instante em que existir uma rota que o Access
 * não cubra (o subdomínio `workers.dev` ligado em paralelo ao domínio próprio é
 * o caso clássico). Duas consequências, nesta ordem: desligue a rota
 * `workers.dev` em produção; e, quando o gateway servir tenants, verifique o JWT
 * de verdade. Ver `docs/FOUNDATION.md` §1.
 */

/** O cabeçalho que o Cloudflare Access injeta na requisição repassada à origem. */
const ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion";
/** Prova da plataforma no caminho de binding, onde o Access não alcança. */
const PLATFORM_SECRET_HEADER = "Authorization";
/** Quem a plataforma diz que está atendendo. Escrito por ELA, nunca pelo modelo. */
const TENANT_HEADER = "X-Tenant-Id";

/** Como a requisição provou quem é. O vocabulário é fechado — vira tag de métrica. */
export type CallerKind =
  /** A plataforma, por service binding, agindo em nome de um tenant. */
  | "platform"
  /** Um operador humano, autenticado pelo Cloudflare Access no edge. */
  | "operator";

export interface AuthorizedCaller {
  readonly kind: CallerKind;
  /**
   * O tenant desta chamada. Presente SÓ para `platform` — um operador opera a
   * conta própria, e por isso não pode escolher tenant por header (seria
   * escalada de escopo por digitação).
   */
  readonly tenantId: string | null;
}

export type AuthResult =
  | { readonly ok: true; readonly caller: AuthorizedCaller }
  | { readonly ok: false; readonly reason: AuthRejection };

/** Por que foi recusado. Fechado, para virar tag sem cardinalidade infinita. */
export type AuthRejection =
  | "no_proof"
  | "bad_platform_secret"
  | "missing_tenant"
  | "malformed_tenant"
  | "gateway_not_configured";

/**
 * Comparação em tempo constante. `a === b` sai no primeiro byte diferente e o
 * tempo de resposta vira um oráculo que revela o segredo byte a byte.
 */
const constantTimeEquals = (a: string, b: string): boolean => {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  // Comprimentos diferentes já não batem — mas ainda assim varremos o maior dos
  // dois, para o tempo não depender de QUAL delas é maior.
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
};

/**
 * `tenantId` é opaco para este gateway — ele não sabe o que é um tenant, só o
 * repassa. Mas um valor livre viraria caminho de injeção quando descer para uma
 * chave de armazenamento ou uma URL, então a forma é estreita e verificada aqui,
 * na borda, e não em cada consumidor.
 */
const TENANT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const authorize = (request: Request, env: Env): AuthResult => {
  const configured = typeof env.GATEWAY_PLATFORM_SECRET === "string" && env.GATEWAY_PLATFORM_SECRET.length > 0;

  const authorization = request.headers.get(PLATFORM_SECRET_HEADER);
  const bearer = authorization?.startsWith("Bearer ") === true ? authorization.slice(7) : null;

  if (bearer !== null) {
    // Segredo apresentado ⇒ o chamador AFIRMA ser a plataforma. A partir daqui
    // não há queda para o caminho do operador: cair de volta transformaria um
    // segredo errado em "tenta como humano", que é o oposto de fail-closed.
    if (!configured) return { ok: false, reason: "gateway_not_configured" };
    if (!constantTimeEquals(bearer, env.GATEWAY_PLATFORM_SECRET as string)) {
      return { ok: false, reason: "bad_platform_secret" };
    }
    const tenantId = request.headers.get(TENANT_HEADER);
    // A plataforma SEMPRE age em nome de alguém. Chamada sem tenant é bug dela,
    // e atender "sem tenant" seria servir dado de frota a um turno de cliente.
    if (tenantId === null || tenantId.length === 0) return { ok: false, reason: "missing_tenant" };
    if (!TENANT_ID_RE.test(tenantId)) return { ok: false, reason: "malformed_tenant" };
    return { ok: true, caller: { kind: "platform", tenantId } };
  }

  if (request.headers.get(ACCESS_JWT_HEADER) !== null) {
    // Operador humano: o Access já decidiu QUEM é, no edge. O gateway não
    // reabre essa decisão — só recusa quem chegou sem ela.
    return { ok: true, caller: { kind: "operator", tenantId: null } };
  }

  return { ok: false, reason: "no_proof" };
};

/**
 * A resposta de recusa. Corpo mínimo e IGUAL para todas as razões: distinguir
 * "segredo errado" de "sem prova" no corpo entrega ao atacante o mapa do que
 * falta. A razão vai para o log e a métrica, onde é útil sem ser exposta.
 */
export const unauthorized = (): Response =>
  new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
