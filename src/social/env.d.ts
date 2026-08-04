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
    /** WhatsApp Cloud API token. Falls back to FACEBOOK_ACCESS_TOKEN. */
    WHATSAPP_ACCESS_TOKEN?: string;
    /** Default WhatsApp sender phone number ID. */
    WHATSAPP_PHONE_NUMBER_ID?: string;
    /** Google OAuth client, used to mint access tokens from the refresh token. */
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    GOOGLE_REFRESH_TOKEN?: string;
    /** Static Google access token; skips the refresh flow (expires in ~1h). */
    GOOGLE_ACCESS_TOKEN?: string;
    /** YouTube API key, preferred for read-only calls. */
    YOUTUBE_API_KEY?: string;
    /** Google Ads developer token and account defaults. */
    GOOGLE_ADS_DEVELOPER_TOKEN?: string;
    GOOGLE_ADS_LOGIN_CUSTOMER_ID?: string;
    GOOGLE_ADS_CUSTOMER_ID?: string;
    /** Google Ads API version, e.g. "v18". Optional. */
    GOOGLE_ADS_API_VERSION?: string;
    /** Default GA4 property ID. */
    GA4_PROPERTY_ID?: string;
  }
}

export {};

declare global {
  interface Env {
    /**
     * Prova da PLATAFORMA no caminho de service binding (#fundação §1).
     *
     * Não é "defesa em profundidade opcional": a invocação por binding NÃO
     * atravessa o edge, então nenhuma política de Cloudflare Access é avaliada
     * nela — neste caminho, este segredo é o único controle que existe.
     *
     * Ausente = o gateway recusa toda chamada que se apresente como plataforma
     * (`gateway_not_configured`), em vez de aceitar sem prova. Grave com
     * `wrangler secret put GATEWAY_PLATFORM_SECRET`, com o MESMO valor do lado
     * da plataforma.
     */
    GATEWAY_PLATFORM_SECRET?: string;
  }
}
export {};
