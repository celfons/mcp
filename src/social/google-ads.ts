/**
 * Google Ads tools, built on the Google Ads API (REST).
 *
 * Beyond the shared Google OAuth credentials this needs a developer token,
 * and a manager account ID when operating under an MCC.
 * Secrets: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_LOGIN_CUSTOMER_ID (optional),
 * GOOGLE_ADS_CUSTOMER_ID (optional default account).
 * Scope: https://www.googleapis.com/auth/adwords
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { googleAuth } from "./google-shared";
import { MissingSecretError, callJson, guard, ok } from "./shared";

const DEFAULT_API_VERSION = "v18";

function apiVersion(env: Env): string {
  const version = (env as Record<string, unknown>).GOOGLE_ADS_API_VERSION;
  return typeof version === "string" && version.length > 0
    ? version
    : DEFAULT_API_VERSION;
}

function base(env: Env): string {
  return `https://googleads.googleapis.com/${apiVersion(env)}`;
}

/** Google Ads wants customer IDs without dashes. */
function digits(value: string): string {
  return value.replace(/-/g, "");
}

function customer(env: Env, customerId?: string): string {
  if (customerId) return digits(customerId);
  const configured = (env as Record<string, unknown>).GOOGLE_ADS_CUSTOMER_ID;
  if (typeof configured === "string" && configured.length > 0) {
    return digits(configured);
  }
  throw new MissingSecretError("GOOGLE_ADS_CUSTOMER_ID");
}

async function adsHeaders(env: Env): Promise<Record<string, string>> {
  const developerToken = (env as Record<string, unknown>)
    .GOOGLE_ADS_DEVELOPER_TOKEN;
  if (typeof developerToken !== "string" || developerToken.length === 0) {
    throw new MissingSecretError("GOOGLE_ADS_DEVELOPER_TOKEN");
  }

  const headers: Record<string, string> = {
    ...(await googleAuth(env)),
    "developer-token": developerToken
  };

  const loginCustomerId = (env as Record<string, unknown>)
    .GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  if (typeof loginCustomerId === "string" && loginCustomerId.length > 0) {
    headers["login-customer-id"] = digits(loginCustomerId);
  }

  return headers;
}

/** Runs a GAQL query against the searchStream-free `search` endpoint. */
async function search(env: Env, customerId: string, query: string) {
  return callJson(`${base(env)}/customers/${customerId}/googleAds:search`, {
    method: "POST",
    headers: await adsHeaders(env),
    body: { query },
    timeoutMs: 30_000
  });
}

const customerIdArg = z
  .string()
  .optional()
  .describe("Account ID (defaults to GOOGLE_ADS_CUSTOMER_ID)");

const dateRangeArg = z
  .enum([
    "TODAY",
    "YESTERDAY",
    "LAST_7_DAYS",
    "LAST_14_DAYS",
    "LAST_30_DAYS",
    "THIS_MONTH",
    "LAST_MONTH"
  ])
  .optional()
  .describe("Reporting period (default LAST_30_DAYS)");

const METRICS =
  "metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc, " +
  "metrics.cost_micros, metrics.conversions, metrics.cost_per_conversion";

export function registerGoogleAdsTools(server: McpServer, env: Env) {
  server.registerTool(
    "google_ads_list_accounts",
    {
      description:
        "Lists the Google Ads accounts the credentials can access (resource names).",
      inputSchema: {}
    },
    guard(async () =>
      ok(
        await callJson(`${base(env)}/customers:listAccessibleCustomers`, {
          headers: await adsHeaders(env)
        })
      )
    )
  );

  server.registerTool(
    "google_ads_list_campaigns",
    {
      description:
        "Lists the campaigns of an account with their status, budget and performance.",
      inputSchema: {
        customerId: customerIdArg,
        dateRange: dateRangeArg,
        onlyEnabled: z
          .boolean()
          .optional()
          .describe("Return only ENABLED campaigns")
      }
    },
    guard(async ({ customerId, dateRange, onlyEnabled }) => {
      const query = `
        SELECT campaign.id, campaign.name, campaign.status,
               campaign.advertising_channel_type, campaign_budget.amount_micros,
               ${METRICS}
        FROM campaign
        WHERE segments.date DURING ${dateRange ?? "LAST_30_DAYS"}
        ${onlyEnabled ? "AND campaign.status = 'ENABLED'" : ""}
        ORDER BY metrics.impressions DESC
      `;
      return ok(await search(env, customer(env, customerId), query));
    })
  );

  server.registerTool(
    "google_ads_campaign_performance",
    {
      description:
        "Gets the daily performance of a specific campaign (impressions, clicks, cost, conversions).",
      inputSchema: {
        campaignId: z.string().describe("Campaign ID"),
        customerId: customerIdArg,
        dateRange: dateRangeArg
      }
    },
    guard(async ({ campaignId, customerId, dateRange }) => {
      const query = `
        SELECT campaign.id, campaign.name, segments.date, ${METRICS}
        FROM campaign
        WHERE campaign.id = ${digits(campaignId)}
          AND segments.date DURING ${dateRange ?? "LAST_30_DAYS"}
        ORDER BY segments.date DESC
      `;
      return ok(await search(env, customer(env, customerId), query));
    })
  );

  server.registerTool(
    "google_ads_list_ad_groups",
    {
      description: "Lists the ad groups of an account or of one campaign.",
      inputSchema: {
        customerId: customerIdArg,
        campaignId: z
          .string()
          .optional()
          .describe("Filter by a single campaign"),
        dateRange: dateRangeArg
      }
    },
    guard(async ({ customerId, campaignId, dateRange }) => {
      const query = `
        SELECT ad_group.id, ad_group.name, ad_group.status,
               campaign.id, campaign.name, ${METRICS}
        FROM ad_group
        WHERE segments.date DURING ${dateRange ?? "LAST_30_DAYS"}
        ${campaignId ? `AND campaign.id = ${digits(campaignId)}` : ""}
        ORDER BY metrics.impressions DESC
      `;
      return ok(await search(env, customer(env, customerId), query));
    })
  );

  server.registerTool(
    "google_ads_keyword_performance",
    {
      description:
        "Lists keyword performance, ordered by impressions — useful for spotting waste.",
      inputSchema: {
        customerId: customerIdArg,
        dateRange: dateRangeArg,
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("How many keywords to return (default 50)")
      }
    },
    guard(async ({ customerId, dateRange, limit }) => {
      const query = `
        SELECT ad_group_criterion.keyword.text,
               ad_group_criterion.keyword.match_type,
               ad_group.name, campaign.name, ${METRICS}
        FROM keyword_view
        WHERE segments.date DURING ${dateRange ?? "LAST_30_DAYS"}
        ORDER BY metrics.impressions DESC
        LIMIT ${limit ?? 50}
      `;
      return ok(await search(env, customer(env, customerId), query));
    })
  );

  server.registerTool(
    "google_ads_run_query",
    {
      description:
        "Runs an arbitrary GAQL query against the account — for reports the other tools do not cover.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe("GAQL query, e.g. SELECT campaign.name FROM campaign"),
        customerId: customerIdArg
      }
    },
    guard(async ({ query, customerId }) =>
      ok(await search(env, customer(env, customerId), query))
    )
  );

  server.registerTool(
    "google_ads_update_campaign_status",
    {
      description:
        "Pauses, enables or removes a campaign. This changes live ad spend.",
      inputSchema: {
        campaignId: z.string().describe("Campaign ID"),
        status: z
          .enum(["ENABLED", "PAUSED", "REMOVED"])
          .describe("New campaign status"),
        customerId: customerIdArg
      }
    },
    guard(async ({ campaignId, status, customerId }) => {
      const id = customer(env, customerId);
      return ok(
        await callJson(`${base(env)}/customers/${id}/campaigns:mutate`, {
          method: "POST",
          headers: await adsHeaders(env),
          body: {
            operations: [
              {
                update: {
                  resourceName: `customers/${id}/campaigns/${digits(campaignId)}`,
                  status
                },
                updateMask: "status"
              }
            ]
          }
        })
      );
    })
  );
}
