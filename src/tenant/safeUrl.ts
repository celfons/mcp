/**
 * A URL da API é cadastrada por terceiro, então este Worker faz requisição para
 * onde mandarem. Sem esta guarda, um `baseUrl` apontando para `169.254.169.254`
 * ou para um serviço interno transformaria o gateway em SSRF de aluguel — e o
 * resultado voltaria para dentro do prompt de um agente, que é o pior lugar
 * possível para um vazamento aterrissar.
 *
 * O mesmo rigor que o backend aplica em `isSupportedMcpUrl` (ADR-0036): `https`
 * apenas, destino público apenas.
 *
 * Limite conhecido e deliberado: um host que RESOLVE para IP privado passa por
 * aqui (não há resolução de DNS no Worker antes do fetch). O bloqueio é por
 * forma do host — literal IP privado e nomes locais —, que é o que se pode
 * garantir sem um resolvedor. Um alvo de rebind de DNS exigiria proxy com
 * resolução própria; está fora do escopo e é melhor estar escrito do que
 * subentendido.
 */

const PRIVATE_V4 =
  /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

const LOCAL_NAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost"]);

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** Aceita apenas `https` para um destino público. */
export function checkOutboundUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "URL inválida" };
  }

  if (url.protocol !== "https:") {
    return { ok: false, reason: "apenas https é aceito" };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (LOCAL_NAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".internal")) {
    return { ok: false, reason: "destino local não é permitido" };
  }
  if (PRIVATE_V4.test(host)) {
    return { ok: false, reason: "faixa de IP privada não é permitida" };
  }
  // IPv6: loopback, link-local (fe80::/10) e unique-local (fc00::/7).
  if (host === "::1" || host === "::" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host)) {
    return { ok: false, reason: "faixa de IPv6 privada não é permitida" };
  }

  return { ok: true, url };
}

export type SafeFetchOptions = {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  /** Teto de bytes lidos do corpo da resposta. */
  maxBytes?: number;
};

export class OutboundError extends Error {
  constructor(
    message: string,
    public readonly status: number | null
  ) {
    super(message);
    this.name = "OutboundError";
  }
}

const DEFAULT_MAX_BYTES = 262_144;

/**
 * Faz a chamada à API do cliente com as três contenções que importam: destino
 * verificado, redirecionamento NÃO seguido (um 302 para IP interno anularia a
 * checagem acima) e corpo lido com teto de bytes — uma resposta de 200 MB não
 * pode derrubar o Worker por memória.
 */
export async function safeFetch(target: string, options: SafeFetchOptions): Promise<string> {
  const check = checkOutboundUrl(target);
  if (!check.ok) throw new OutboundError(`destino recusado: ${check.reason}`, null);

  let response: Response;
  try {
    response = await fetch(check.url.toString(), {
      method: options.method,
      headers: options.headers,
      body: options.body,
      // Seguir redirecionamento devolveria a decisão de destino ao servidor do
      // outro lado, que é exatamente quem a guarda não confia.
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs)
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new OutboundError("a API do cliente não respondeu a tempo", null);
    }
    throw new OutboundError(`falha ao chamar a API do cliente: ${String(error)}`, null);
  }

  if (response.status >= 300 && response.status < 400) {
    throw new OutboundError("a API do cliente respondeu com redirecionamento, que não é seguido", response.status);
  }
  if (!response.ok) {
    // O corpo do erro NÃO entra na mensagem: ele volta para o prompt, e uma API
    // que ecoa o payload devolveria dado do cliente por uma via de erro.
    throw new OutboundError(`a API do cliente respondeu ${response.status}`, response.status);
  }

  return readCapped(response, options.maxBytes ?? DEFAULT_MAX_BYTES);
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new OutboundError("a resposta da API do cliente é grande demais", null);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}
