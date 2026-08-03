/**
 * Google Business Profile tools (company listing on Google/Maps).
 *
 * Spread over two APIs: Account Management for accounts, Business Information
 * for locations, and the legacy My Business v4 endpoint for reviews and posts.
 * Scope: https://www.googleapis.com/auth/business.manage
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { googleGet, googlePost } from "./google-shared";
import { guard, ok } from "./shared";

const ACCOUNTS_BASE = "https://mybusinessaccountmanagement.googleapis.com/v1";
const INFO_BASE = "https://mybusinessbusinessinformation.googleapis.com/v1";
const V4_BASE = "https://mybusiness.googleapis.com/v4";

const DEFAULT_LOCATION_FIELDS =
  "name,title,storefrontAddress,phoneNumbers,websiteUri,regularHours,categories,metadata";

/** Accepts "accounts/123" or a bare "123". */
function accountPath(value: string): string {
  return value.startsWith("accounts/") ? value : `accounts/${value}`;
}

/** Accepts "locations/456" or a bare "456". */
function locationPath(value: string): string {
  return value.startsWith("locations/") ? value : `locations/${value}`;
}

export function registerGoogleBusinessTools(server: McpServer, env: Env) {
  server.registerTool(
    "google_business_list_accounts",
    {
      description:
        "Lists the Google Business Profile accounts the token can manage.",
      inputSchema: {}
    },
    guard(async () => ok(await googleGet(env, `${ACCOUNTS_BASE}/accounts`)))
  );

  server.registerTool(
    "google_business_list_locations",
    {
      description:
        "Lists the locations (company listings) of a Google Business Profile account.",
      inputSchema: {
        accountId: z.string().describe('Account ID or "accounts/123"'),
        readMask: z
          .string()
          .optional()
          .describe("Comma-separated fields to return"),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("How many locations to return (default 20)")
      }
    },
    guard(async ({ accountId, readMask, pageSize }) =>
      ok(
        await googleGet(
          env,
          `${INFO_BASE}/${accountPath(accountId)}/locations`,
          {
            readMask: readMask ?? DEFAULT_LOCATION_FIELDS,
            pageSize: pageSize ?? 20
          }
        )
      )
    )
  );

  server.registerTool(
    "google_business_get_location",
    {
      description:
        "Gets the details of a location: address, hours, phone, categories.",
      inputSchema: {
        locationId: z.string().describe('Location ID or "locations/456"'),
        readMask: z
          .string()
          .optional()
          .describe("Comma-separated fields to return")
      }
    },
    guard(async ({ locationId, readMask }) =>
      ok(
        await googleGet(env, `${INFO_BASE}/${locationPath(locationId)}`, {
          readMask: readMask ?? DEFAULT_LOCATION_FIELDS
        })
      )
    )
  );

  server.registerTool(
    "google_business_list_reviews",
    {
      description:
        "Lists the reviews of a location, with rating, text and any existing reply.",
      inputSchema: {
        accountId: z.string().describe('Account ID or "accounts/123"'),
        locationId: z.string().describe('Location ID or "locations/456"'),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("How many reviews to return (default 20)"),
        orderBy: z
          .string()
          .optional()
          .describe('Ordering, e.g. "updateTime desc" or "rating"')
      }
    },
    guard(async ({ accountId, locationId, pageSize, orderBy }) =>
      ok(
        await googleGet(
          env,
          `${V4_BASE}/${accountPath(accountId)}/${locationPath(locationId)}/reviews`,
          { pageSize: pageSize ?? 20, orderBy }
        )
      )
    )
  );

  server.registerTool(
    "google_business_reply_to_review",
    {
      description:
        "Replies to a review (or updates the existing reply) on a location.",
      inputSchema: {
        accountId: z.string().describe('Account ID or "accounts/123"'),
        locationId: z.string().describe('Location ID or "locations/456"'),
        reviewId: z.string().describe("Review ID"),
        comment: z.string().min(1).describe("Reply text")
      }
    },
    guard(async ({ accountId, locationId, reviewId, comment }) =>
      ok(
        await googlePost(
          env,
          `${V4_BASE}/${accountPath(accountId)}/${locationPath(locationId)}/reviews/${reviewId}/reply`,
          { comment }
        )
      )
    )
  );

  server.registerTool(
    "google_business_create_post",
    {
      description:
        "Publishes a post (local post) on the Google Business Profile of a location.",
      inputSchema: {
        accountId: z.string().describe('Account ID or "accounts/123"'),
        locationId: z.string().describe('Location ID or "locations/456"'),
        summary: z.string().min(1).describe("Post text"),
        imageUrl: z.string().url().optional().describe("Public image URL"),
        ctaType: z
          .enum([
            "BOOK",
            "ORDER",
            "SHOP",
            "LEARN_MORE",
            "SIGN_UP",
            "CALL"
          ])
          .optional()
          .describe("Call-to-action button type"),
        ctaUrl: z
          .string()
          .url()
          .optional()
          .describe("Button URL (not used by CALL)"),
        languageCode: z
          .string()
          .optional()
          .describe("Post language, e.g. pt-BR (default pt-BR)")
      }
    },
    guard(
      async ({
        accountId,
        locationId,
        summary,
        imageUrl,
        ctaType,
        ctaUrl,
        languageCode
      }) => {
        const body: Record<string, unknown> = {
          languageCode: languageCode ?? "pt-BR",
          summary,
          topicType: "STANDARD"
        };
        if (imageUrl) {
          body.media = [{ mediaFormat: "PHOTO", sourceUrl: imageUrl }];
        }
        if (ctaType) {
          body.callToAction = { actionType: ctaType, url: ctaUrl };
        }

        return ok(
          await googlePost(
            env,
            `${V4_BASE}/${accountPath(accountId)}/${locationPath(locationId)}/localPosts`,
            body
          )
        );
      }
    )
  );
}
