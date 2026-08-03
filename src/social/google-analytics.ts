/**
 * Google Analytics 4 tools, built on the Data API v1beta and the Admin API.
 *
 * Secret: GA4_PROPERTY_ID (optional default property; every tool also takes
 * one per call).
 * Scopes: analytics.readonly and analytics.manage.users.readonly
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { googleGet, googlePost } from "./google-shared";
import { MissingSecretError, guard, ok } from "./shared";

const DATA_BASE = "https://analyticsdata.googleapis.com/v1beta";
const ADMIN_BASE = "https://analyticsadmin.googleapis.com/v1beta";

/** Accepts "properties/123" or a bare "123". */
function property(env: Env, propertyId?: string): string {
  const value =
    propertyId ?? (env as Record<string, unknown>).GA4_PROPERTY_ID;
  if (typeof value !== "string" || value.length === 0) {
    throw new MissingSecretError("GA4_PROPERTY_ID");
  }
  return value.startsWith("properties/") ? value : `properties/${value}`;
}

function split(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

const propertyIdArg = z
  .string()
  .optional()
  .describe("GA4 property ID (defaults to GA4_PROPERTY_ID)");

const startDateArg = z
  .string()
  .optional()
  .describe('Start date: YYYY-MM-DD, "NdaysAgo" or "yesterday" (default 28daysAgo)');

const endDateArg = z
  .string()
  .optional()
  .describe('End date: YYYY-MM-DD, "NdaysAgo" or "today" (default today)');

export function registerGoogleAnalyticsTools(server: McpServer, env: Env) {
  server.registerTool(
    "ga4_list_properties",
    {
      description:
        "Lists the GA4 properties available under an account (use ga4_list_accounts to find the account).",
      inputSchema: {
        accountId: z.string().describe('Account ID or "accounts/123"')
      }
    },
    guard(async ({ accountId }) => {
      const account = accountId.startsWith("accounts/")
        ? accountId
        : `accounts/${accountId}`;
      return ok(
        await googleGet(env, `${ADMIN_BASE}/properties`, {
          filter: `parent:${account}`
        })
      );
    })
  );

  server.registerTool(
    "ga4_list_accounts",
    {
      description: "Lists the Google Analytics accounts the token can access.",
      inputSchema: {}
    },
    guard(async () => ok(await googleGet(env, `${ADMIN_BASE}/accounts`)))
  );

  server.registerTool(
    "ga4_report",
    {
      description:
        "Runs a GA4 report with the metrics and dimensions you choose.",
      inputSchema: {
        metrics: z
          .string()
          .describe(
            "Comma-separated metrics, e.g. activeUsers,sessions,conversions"
          ),
        dimensions: z
          .string()
          .optional()
          .describe("Comma-separated dimensions, e.g. date,country"),
        startDate: startDateArg,
        endDate: endDateArg,
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe("Row limit (default 50)"),
        propertyId: propertyIdArg
      }
    },
    guard(
      async ({
        metrics,
        dimensions,
        startDate,
        endDate,
        limit,
        propertyId
      }) =>
        ok(
          await googlePost(
            env,
            `${DATA_BASE}/${property(env, propertyId)}:runReport`,
            {
              dateRanges: [
                {
                  startDate: startDate ?? "28daysAgo",
                  endDate: endDate ?? "today"
                }
              ],
              metrics: split(metrics).map((name) => ({ name })),
              dimensions: dimensions
                ? split(dimensions).map((name) => ({ name }))
                : undefined,
              limit: limit ?? 50
            }
          )
        )
    )
  );

  server.registerTool(
    "ga4_traffic_overview",
    {
      description:
        "Traffic overview: users, sessions, engagement and conversions broken down by channel.",
      inputSchema: {
        startDate: startDateArg,
        endDate: endDateArg,
        propertyId: propertyIdArg
      }
    },
    guard(async ({ startDate, endDate, propertyId }) =>
      ok(
        await googlePost(
          env,
          `${DATA_BASE}/${property(env, propertyId)}:runReport`,
          {
            dateRanges: [
              {
                startDate: startDate ?? "28daysAgo",
                endDate: endDate ?? "today"
              }
            ],
            dimensions: [{ name: "sessionDefaultChannelGroup" }],
            metrics: [
              { name: "activeUsers" },
              { name: "sessions" },
              { name: "engagementRate" },
              { name: "averageSessionDuration" },
              { name: "conversions" }
            ],
            orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
            limit: 25
          }
        )
      )
    )
  );

  server.registerTool(
    "ga4_top_pages",
    {
      description: "Most viewed pages in the period, with users and views.",
      inputSchema: {
        startDate: startDateArg,
        endDate: endDateArg,
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("How many pages to return (default 25)"),
        propertyId: propertyIdArg
      }
    },
    guard(async ({ startDate, endDate, limit, propertyId }) =>
      ok(
        await googlePost(
          env,
          `${DATA_BASE}/${property(env, propertyId)}:runReport`,
          {
            dateRanges: [
              {
                startDate: startDate ?? "28daysAgo",
                endDate: endDate ?? "today"
              }
            ],
            dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
            metrics: [
              { name: "screenPageViews" },
              { name: "activeUsers" },
              { name: "averageSessionDuration" }
            ],
            orderBys: [
              { metric: { metricName: "screenPageViews" }, desc: true }
            ],
            limit: limit ?? 25
          }
        )
      )
    )
  );

  server.registerTool(
    "ga4_realtime",
    {
      description: "Users active on the site right now, by country and page.",
      inputSchema: {
        dimensions: z
          .string()
          .optional()
          .describe("Comma-separated dimensions (default country,unifiedScreenName)"),
        propertyId: propertyIdArg
      }
    },
    guard(async ({ dimensions, propertyId }) =>
      ok(
        await googlePost(
          env,
          `${DATA_BASE}/${property(env, propertyId)}:runRealtimeReport`,
          {
            dimensions: split(
              dimensions ?? "country,unifiedScreenName"
            ).map((name) => ({ name })),
            metrics: [{ name: "activeUsers" }],
            limit: 50
          }
        )
      )
    )
  );

  server.registerTool(
    "ga4_list_metadata",
    {
      description:
        "Lists the metrics and dimensions available on the property — use it to build ga4_report queries.",
      inputSchema: { propertyId: propertyIdArg }
    },
    guard(async ({ propertyId }) =>
      ok(
        await googleGet(
          env,
          `${DATA_BASE}/${property(env, propertyId)}/metadata`
        )
      )
    )
  );
}
