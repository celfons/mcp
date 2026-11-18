/**
 * Meta Ads (Marketing API) — SÓ LEITURA.
 *
 * Gasto, alcance, cliques e resultados (leads, conversas iniciadas no WhatsApp,
 * compras) por conta, campanha, conjunto e anúncio, para cruzar com o que a
 * academia vendeu (ferramentas da gestão da EVO).
 *
 * Token: um token de USUÁRIO ou de USUÁRIO DO SISTEMA com `ads_read` (o token
 * de Página do FACEBOOK_ACCESS_TOKEN não lê anúncios). Secret
 * `META_ADS_ACCESS_TOKEN`; sem ele, cai no FACEBOOK_ACCESS_TOKEN. Conta padrão:
 * `META_AD_ACCOUNT_ID` (com ou sem `act_`).
 *
 * De propósito fora daqui: qualquer escrita (criar, pausar, mudar orçamento) e
 * os LEADS de formulário (nome, telefone, e-mail de quem preencheu). A contagem
 * de leads vem nos `actions` dos insights, sem dado pessoal.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { GRAPH_BASE, callJson, graphVersion, guard, ok } from "./shared";

const MAX_PAGES = 10;
const PAGE_LIMIT = 200;

const ACCOUNT_FIELDS = "id,account_id,name,account_status,currency,timezone_name,amount_spent,business";
const CAMPAIGN_FIELDS =
  "id,name,objective,status,effective_status,buying_type,daily_budget,lifetime_budget,budget_remaining,start_time,stop_time,created_time";
const ADSET_FIELDS =
  "id,name,campaign_id,status,effective_status,optimization_goal,billing_event,destination_type,daily_budget,lifetime_budget,start_time,end_time";
const AD_FIELDS =
  "id,name,campaign_id,adset_id,status,effective_status,created_time,creative{id,name,title,body,call_to_action_type,object_type}";

const INSIGHT_METRICS = [
  "spend",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "inline_link_clicks",
  "ctr",
  "cpc",
  "cpm",
  "actions",
  "cost_per_action_type",
  "action_values",
  "purchase_roas"
];
const LEVEL_FIELDS: Record<string, string[]> = {
  account: ["account_id", "account_name", "account_currency"],
  campaign: ["campaign_id", "campaign_name", "objective"],
  adset: ["campaign_id", "campaign_name", "adset_id", "adset_name"],
  ad: ["campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name"]
};

const DATE_PRESETS = [
  "today",
  "yesterday",
  "last_3d",
  "last_7d",
  "last_14d",
  "last_28d",
  "last_30d",
  "last_90d",
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "this_year",
  "last_year",
  "maximum"
] as const;

const BREAKDOWNS = [
  "age",
  "gender",
  "country",
  "region",
  "publisher_platform",
  "platform_position",
  "device_platform",
  "impression_device"
] as const;

const EFFECTIVE_STATUS = ["ACTIVE", "PAUSED", "ARCHIVED", "DELETED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "IN_PROCESS", "WITH_ISSUES"] as const;

/** Ações que mais importam para academia, destacadas em `resultados` em cada linha. */
const KEY_ACTIONS: Record<string, string> = {
  lead: "leads",
  "onsite_conversion.lead_grouped": "leads_formulario",
  "onsite_conversion.messaging_conversation_started_7d": "conversas_iniciadas",
  "onsite_conversion.messaging_first_reply": "primeiras_respostas",
  link_click: "cliques_no_link",
  landing_page_view: "visualizacoes_pagina",
  purchase: "compras",
  complete_registration: "cadastros",
  contact: "contatos",
  schedule: "agendamentos"
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^\d{1,30}$/;

export function metaAdsToken(env: Env): string {
  const vars = env as Record<string, unknown>;
  for (const key of ["META_ADS_ACCESS_TOKEN", "FACEBOOK_ACCESS_TOKEN"]) {
    const value = vars[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  throw new Error('Missing secret "META_ADS_ACCESS_TOKEN" (um token com ads_read). Set it with: npx wrangler secret put META_ADS_ACCESS_TOKEN');
}

/** `123` ou `act_123` → `act_123`; padrão = META_AD_ACCOUNT_ID. Qualquer outra coisa é recusada. */
export function normalizeAccountId(env: Env, raw?: string): string {
  const fallback = (env as Record<string, unknown>).META_AD_ACCOUNT_ID;
  const value = (raw ?? (typeof fallback === "string" ? fallback : "")).trim();
  if (!value) throw new Error("Informe accountId (ex.: act_123) ou configure META_AD_ACCOUNT_ID. Use meta_ads_list_accounts para ver as contas.");
  const digits = value.startsWith("act_") ? value.slice(4) : value;
  if (!ID_RE.test(digits)) throw new Error(`accountId inválido: ${value}`);
  return `act_${digits}`;
}

/** Objeto dos insights: conta (`act_…`) ou, no modo global, id numérico de campanha, conjunto ou anúncio. */
function insightsObject(env: Env, scope: MetaAdsScope, raw?: string): string {
  if (scope.kind === "tenant") {
    if (raw && ID_RE.test(raw.trim())) {
      throw new Error("Nesta conexão, filtre por campanha com campaignIds; o objeto é sempre a conta da academia.");
    }
    return scopeAccount(env, scope, raw);
  }
  if (raw && ID_RE.test(raw.trim())) return raw.trim();
  return normalizeAccountId(env, raw);
}

/**
 * De quem são as credenciais desta montagem.
 * - global (`/mcp`, `/mcp/meta-ads`): o token do Worker, qualquer conta que ele alcance.
 * - academia (`/mcp/gestao/...`): o token e a conta CADASTRADOS para ela. Toda chamada sai sob
 *   `act_<conta da academia>`: o modelo não escolhe outra conta, nem consulta campanha, conjunto
 *   ou anúncio por id solto (que o token talvez alcance em outra conta de uma agência).
 */
export type MetaAdsScope =
  | { readonly kind: "global" }
  | { readonly kind: "tenant"; readonly accessToken: string; readonly adAccountId: string };

function scopeToken(env: Env, scope: MetaAdsScope): string {
  return scope.kind === "tenant" ? scope.accessToken : metaAdsToken(env);
}

function scopeAccount(env: Env, scope: MetaAdsScope, raw?: string): string {
  if (scope.kind === "global") return normalizeAccountId(env, raw);
  const pinned = normalizeAccountId(env, scope.adAccountId);
  if (raw && normalizeAccountId(env, raw) !== pinned) {
    throw new Error("Esta conexão só consulta a conta de anúncio cadastrada para a academia.");
  }
  return pinned;
}

function graph(env: Env, path: string): string {
  return `${GRAPH_BASE}/${graphVersion(env)}/${path}`;
}

/** Só segue `paging.next` que continue na Graph API: o cursor vem da resposta, não de nós. */
export function isGraphUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === new URL(GRAPH_BASE).hostname;
  } catch {
    return false;
  }
}

type Page = { data?: unknown[]; paging?: { next?: unknown } };

export async function fetchAllPages(
  firstUrl: string,
  query: Record<string, string | number | undefined>,
  maxPages = MAX_PAGES
): Promise<{ rows: unknown[]; truncated: boolean }> {
  const rows: unknown[] = [];
  let page = (await callJson(firstUrl, { query, timeoutMs: 30_000 })) as Page;
  for (let i = 1; ; i += 1) {
    if (Array.isArray(page.data)) rows.push(...page.data);
    const next = page.paging?.next;
    if (!isGraphUrl(next)) return { rows, truncated: false };
    if (i >= maxPages) return { rows, truncated: true };
    page = (await callJson(next, { timeoutMs: 30_000 })) as Page;
  }
}

type ActionEntry = { action_type?: unknown; value?: unknown };

function actionMap(list: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(list)) return out;
  for (const entry of list as ActionEntry[]) {
    if (typeof entry?.action_type !== "string") continue;
    const value = Number(entry.value);
    if (Number.isFinite(value)) out[entry.action_type] = value;
  }
  return out;
}

const NUMERIC = new Set(["spend", "impressions", "reach", "frequency", "clicks", "inline_link_clicks", "ctr", "cpc", "cpm"]);

/** Uma linha de insight legível: números como número, `actions` em mapa, e os resultados-chave em pt. */
export function shapeInsightRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "actions" || key === "cost_per_action_type" || key === "action_values") {
      out[key] = actionMap(value);
    } else if (key === "purchase_roas") {
      out[key] = actionMap(value).omni_purchase ?? actionMap(value).purchase ?? null;
    } else if (NUMERIC.has(key) && value !== undefined) {
      const n = Number(value);
      out[key] = Number.isFinite(n) ? n : value;
    } else {
      out[key] = value;
    }
  }
  const actions = (out.actions as Record<string, number>) ?? {};
  const costs = (out.cost_per_action_type as Record<string, number>) ?? {};
  const resultados: Record<string, { quantidade: number; custo?: number }> = {};
  for (const [type, label] of Object.entries(KEY_ACTIONS)) {
    if (actions[type] !== undefined) {
      resultados[label] = { quantidade: actions[type], ...(costs[type] !== undefined ? { custo: costs[type] } : {}) };
    }
  }
  out.resultados = resultados;
  return out;
}

export type InsightArgs = {
  objectId?: string;
  level?: "account" | "campaign" | "adset" | "ad";
  datePreset?: (typeof DATE_PRESETS)[number];
  since?: string;
  until?: string;
  timeIncrement?: "1" | "7" | "monthly" | "all_days";
  breakdowns?: (typeof BREAKDOWNS)[number][];
  campaignIds?: string[];
};

/** Monta a consulta dos insights. Período: since/until (ambos) OU datePreset; padrão last_30d. */
export function buildInsightsQuery(args: InsightArgs): Record<string, string> | { error: string } {
  const level = args.level ?? "campaign";
  const query: Record<string, string> = {
    level,
    fields: [...LEVEL_FIELDS[level], ...INSIGHT_METRICS].join(","),
    limit: String(PAGE_LIMIT)
  };
  if (args.since || args.until) {
    if (!args.since || !args.until || !DATE_RE.test(args.since) || !DATE_RE.test(args.until)) {
      return { error: "Informe since e until juntos, no formato AAAA-MM-DD." };
    }
    if (args.since > args.until) return { error: "since precisa ser anterior ou igual a until." };
    query.time_range = JSON.stringify({ since: args.since, until: args.until });
  } else {
    query.date_preset = args.datePreset ?? "last_30d";
  }
  if (args.timeIncrement) query.time_increment = args.timeIncrement;
  if (args.breakdowns?.length) query.breakdowns = args.breakdowns.join(",");
  if (args.campaignIds?.length) {
    if (!args.campaignIds.every((id) => ID_RE.test(id))) return { error: "campaignIds precisa ser uma lista de ids numéricos." };
    query.filtering = JSON.stringify([{ field: "campaign.id", operator: "IN", value: args.campaignIds }]);
  }
  return query;
}

function totals(rows: Record<string, unknown>[]): Record<string, unknown> {
  const sum = (key: string) => rows.reduce((acc, r) => acc + (typeof r[key] === "number" ? (r[key] as number) : 0), 0);
  const spend = Math.round(sum("spend") * 100) / 100;
  const resultados: Record<string, number> = {};
  for (const row of rows) {
    for (const [label, r] of Object.entries((row.resultados as Record<string, { quantidade: number }>) ?? {})) {
      resultados[label] = (resultados[label] ?? 0) + r.quantidade;
    }
  }
  const custoPor: Record<string, number> = {};
  for (const [label, qtd] of Object.entries(resultados)) if (qtd > 0) custoPor[label] = Math.round((spend / qtd) * 100) / 100;
  return { gasto: spend, impressoes: sum("impressions"), cliques: sum("clicks"), resultados, custo_por_resultado: custoPor };
}

type Filter = { field: string; operator: "IN"; value: string[] };

function filtering(parts: { statuses?: string[]; campaignId?: string; adsetId?: string }): string | undefined {
  const list: Filter[] = [];
  if (parts.statuses?.length) list.push({ field: "effective_status", operator: "IN", value: parts.statuses });
  if (parts.campaignId) list.push({ field: "campaign.id", operator: "IN", value: [parts.campaignId] });
  if (parts.adsetId) list.push({ field: "adset.id", operator: "IN", value: [parts.adsetId] });
  return list.length ? JSON.stringify(list) : undefined;
}

/**
 * Onde listar conjuntos/anúncios. No modo global, sob o pai mais específico informado; no da
 * academia, SEMPRE sob a conta dela, com o pai virando filtro — assim um id de outra conta
 * simplesmente não aparece.
 */
function listParent(
  env: Env,
  scope: MetaAdsScope,
  ids: { accountId?: string; campaignId?: string; adsetId?: string }
): { parent: string; filter: { campaignId?: string; adsetId?: string } } {
  if (scope.kind === "tenant") {
    return { parent: scopeAccount(env, scope, ids.accountId), filter: { campaignId: ids.campaignId, adsetId: ids.adsetId } };
  }
  return { parent: ids.adsetId ?? ids.campaignId ?? normalizeAccountId(env, ids.accountId), filter: {} };
}

export function registerMetaAdsTools(server: McpServer, env: Env, scope: MetaAdsScope = { kind: "global" }) {
  const token = () => scopeToken(env, scope);
  server.registerTool(
    "meta_ads_list_accounts",
    {
      description: "Lista as contas de anúncio da Meta que o token alcança (id act_…, nome, moeda, fuso, total já gasto).",
      inputSchema: {}
    },
    guard(async () => {
      if (scope.kind === "tenant") {
        const account = await callJson(graph(env, scopeAccount(env, scope)), {
          query: { fields: ACCOUNT_FIELDS, access_token: token() }
        });
        return ok({ contas: [account] });
      }
      const { rows, truncated } = await fetchAllPages(graph(env, "me/adaccounts"), {
        fields: ACCOUNT_FIELDS,
        limit: PAGE_LIMIT,
        access_token: token()
      });
      return ok({ contas: rows, ...(truncated ? { aviso: "Lista cortada no teto de páginas." } : {}) });
    })
  );

  server.registerTool(
    "meta_ads_list_campaigns",
    {
      description: "Campanhas de uma conta de anúncio da Meta: objetivo, status, orçamento e datas.",
      inputSchema: {
        accountId: z.string().max(40).optional().describe("Conta (act_123 ou 123). Padrão: META_AD_ACCOUNT_ID."),
        effectiveStatus: z.array(z.enum(EFFECTIVE_STATUS)).max(8).optional().describe("Filtra por status efetivo, ex.: [\"ACTIVE\"].")
      }
    },
    guard(async ({ accountId, effectiveStatus }) => {
      const { rows, truncated } = await fetchAllPages(graph(env, `${scopeAccount(env, scope, accountId)}/campaigns`), {
        fields: CAMPAIGN_FIELDS,
        limit: PAGE_LIMIT,
        filtering: filtering({ statuses: effectiveStatus }),
        access_token: token()
      });
      return ok({ campanhas: rows, ...(truncated ? { aviso: "Lista cortada no teto de páginas." } : {}) });
    })
  );

  server.registerTool(
    "meta_ads_list_adsets",
    {
      description: "Conjuntos de anúncios de uma conta ou de uma campanha: meta de otimização, destino (ex.: WhatsApp), orçamento.",
      inputSchema: {
        accountId: z.string().max(40).optional().describe("Conta (act_123). Ignorado se campaignId vier."),
        campaignId: z.string().regex(ID_RE).optional().describe("Só os conjuntos desta campanha."),
        effectiveStatus: z.array(z.enum(EFFECTIVE_STATUS)).max(8).optional()
      }
    },
    guard(async ({ accountId, campaignId, effectiveStatus }) => {
      const { parent, filter } = listParent(env, scope, { accountId, campaignId });
      const { rows, truncated } = await fetchAllPages(graph(env, `${parent}/adsets`), {
        fields: ADSET_FIELDS,
        limit: PAGE_LIMIT,
        filtering: filtering({ statuses: effectiveStatus, ...filter }),
        access_token: token()
      });
      return ok({ conjuntos: rows, ...(truncated ? { aviso: "Lista cortada no teto de páginas." } : {}) });
    })
  );

  server.registerTool(
    "meta_ads_list_ads",
    {
      description:
        "Anúncios de uma conta, campanha ou conjunto, com o criativo (título, texto, botão). O id do anúncio é o mesmo que chega nas conversas iniciadas por anúncio no WhatsApp.",
      inputSchema: {
        accountId: z.string().max(40).optional(),
        campaignId: z.string().regex(ID_RE).optional(),
        adsetId: z.string().regex(ID_RE).optional(),
        effectiveStatus: z.array(z.enum(EFFECTIVE_STATUS)).max(8).optional()
      }
    },
    guard(async ({ accountId, campaignId, adsetId, effectiveStatus }) => {
      const { parent, filter } = listParent(env, scope, { accountId, campaignId, adsetId });
      const { rows, truncated } = await fetchAllPages(graph(env, `${parent}/ads`), {
        fields: AD_FIELDS,
        limit: PAGE_LIMIT,
        filtering: filtering({ statuses: effectiveStatus, ...filter }),
        access_token: token()
      });
      return ok({ anuncios: rows, ...(truncated ? { aviso: "Lista cortada no teto de páginas." } : {}) });
    })
  );

  server.registerTool(
    "meta_ads_insights",
    {
      description:
        "Desempenho dos anúncios da Meta no período: gasto, impressões, alcance, cliques, CTR, CPC, CPM e resultados (leads, conversas iniciadas no WhatsApp, cadastros, compras) com custo por resultado. Por conta, campanha, conjunto ou anúncio; opcionalmente por dia/semana/mês e por idade, gênero, plataforma ou região. Devolve as linhas e os totais.",
      inputSchema: {
        objectId: z
          .string()
          .max(40)
          .optional()
          .describe("Conta (act_123) ou id de campanha/conjunto/anúncio. Padrão: META_AD_ACCOUNT_ID."),
        level: z.enum(["account", "campaign", "adset", "ad"]).optional().describe("Nível das linhas. Padrão: campaign."),
        datePreset: z.enum(DATE_PRESETS).optional().describe("Período pronto. Padrão: last_30d. Ignorado se since/until vierem."),
        since: z.string().max(10).optional().describe("Início, AAAA-MM-DD (junto com until)."),
        until: z.string().max(10).optional().describe("Fim, AAAA-MM-DD (junto com since)."),
        timeIncrement: z
          .enum(["1", "7", "monthly", "all_days"])
          .optional()
          .describe("Quebra no tempo: 1 = por dia, 7 = por semana, monthly, all_days (padrão)."),
        breakdowns: z.array(z.enum(BREAKDOWNS)).max(2).optional().describe("Quebra por público ou posicionamento."),
        campaignIds: z.array(z.string()).max(50).optional().describe("Só estas campanhas.")
      }
    },
    guard(async (args: InsightArgs) => {
      const query = buildInsightsQuery(args);
      if ("error" in query) throw new Error(query.error);
      const { rows, truncated } = await fetchAllPages(graph(env, `${insightsObject(env, scope, args.objectId)}/insights`), {
        ...query,
        access_token: token()
      });
      const shaped = rows.filter((r): r is Record<string, unknown> => !!r && typeof r === "object").map(shapeInsightRow);
      return ok({
        periodo: query.time_range ? JSON.parse(query.time_range) : query.date_preset,
        nivel: query.level,
        totais: totals(shaped),
        linhas: shaped,
        ...(truncated ? { aviso: "Muitas linhas: resultado cortado no teto de páginas. Use um período menor ou um nível acima." } : {})
      });
    })
  );
}
