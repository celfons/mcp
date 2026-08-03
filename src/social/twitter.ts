/**
 * X (Twitter) tools, built on the X API v2.
 *
 * Reads work with an app-only bearer token; posting and deleting require a
 * user-context OAuth 2.0 token with tweet.write scope.
 * Secrets: X_BEARER_TOKEN (reads), X_USER_ACCESS_TOKEN (writes, optional —
 * falls back to X_BEARER_TOKEN).
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { X_BASE, callJson, guard, ok, requireSecret } from "./shared";

const DEFAULT_TWEET_FIELDS =
  "id,text,created_at,public_metrics,author_id,conversation_id,lang";
const DEFAULT_USER_FIELDS =
  "id,name,username,description,public_metrics,verified,profile_image_url,created_at";

function readAuth(env: Env): Record<string, string> {
  return { Authorization: `Bearer ${requireSecret(env, "X_BEARER_TOKEN")}` };
}

function writeAuth(env: Env): Record<string, string> {
  const userToken = (env as Record<string, unknown>).X_USER_ACCESS_TOKEN;
  if (typeof userToken === "string" && userToken.length > 0) {
    return { Authorization: `Bearer ${userToken}` };
  }
  return readAuth(env);
}

export function registerTwitterTools(server: McpServer, env: Env) {
  server.registerTool(
    "x_get_me",
    {
      description:
        "Gets the authenticated X account (requires a user-context token).",
      inputSchema: {}
    },
    guard(async () =>
      ok(
        await callJson(`${X_BASE}/users/me`, {
          headers: writeAuth(env),
          query: { "user.fields": DEFAULT_USER_FIELDS }
        })
      )
    )
  );

  server.registerTool(
    "x_get_user",
    {
      description: "Looks up an X profile by @username.",
      inputSchema: {
        username: z.string().min(1).describe("Username without the @")
      }
    },
    guard(async ({ username }) =>
      ok(
        await callJson(
          `${X_BASE}/users/by/username/${encodeURIComponent(username.replace(/^@/, ""))}`,
          {
            headers: readAuth(env),
            query: { "user.fields": DEFAULT_USER_FIELDS }
          }
        )
      )
    )
  );

  server.registerTool(
    "x_list_user_tweets",
    {
      description: "Lists the most recent posts from an X account.",
      inputSchema: {
        userId: z.string().describe("Numeric X user ID (see x_get_user)"),
        maxResults: z
          .number()
          .int()
          .min(5)
          .max(100)
          .optional()
          .describe("How many posts to return (5-100, default 10)"),
        excludeReplies: z
          .boolean()
          .optional()
          .describe("Exclude replies from the results")
      }
    },
    guard(async ({ userId, maxResults, excludeReplies }) =>
      ok(
        await callJson(`${X_BASE}/users/${encodeURIComponent(userId)}/tweets`, {
          headers: readAuth(env),
          query: {
            max_results: maxResults ?? 10,
            exclude: excludeReplies ? "replies" : undefined,
            "tweet.fields": DEFAULT_TWEET_FIELDS
          }
        })
      )
    )
  );

  server.registerTool(
    "x_get_tweet",
    {
      description: "Gets a single post on X by ID, including its metrics.",
      inputSchema: {
        tweetId: z.string().describe("Post ID")
      }
    },
    guard(async ({ tweetId }) =>
      ok(
        await callJson(`${X_BASE}/tweets/${encodeURIComponent(tweetId)}`, {
          headers: readAuth(env),
          query: { "tweet.fields": DEFAULT_TWEET_FIELDS }
        })
      )
    )
  );

  server.registerTool(
    "x_search_recent",
    {
      description:
        "Searches posts published on X in the last 7 days using the v2 query syntax.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe('Search query, e.g. "cloudflare -is:retweet lang:pt"'),
        maxResults: z
          .number()
          .int()
          .min(10)
          .max(100)
          .optional()
          .describe("How many posts to return (10-100, default 10)")
      }
    },
    guard(async ({ query, maxResults }) =>
      ok(
        await callJson(`${X_BASE}/tweets/search/recent`, {
          headers: readAuth(env),
          query: {
            query,
            max_results: maxResults ?? 10,
            "tweet.fields": DEFAULT_TWEET_FIELDS
          }
        })
      )
    )
  );

  server.registerTool(
    "x_post_tweet",
    {
      description:
        "Publishes a post on X. Requires a user-context token with tweet.write.",
      inputSchema: {
        text: z.string().min(1).max(4000).describe("Post text"),
        replyToTweetId: z
          .string()
          .optional()
          .describe("Post ID being replied to"),
        quoteTweetId: z.string().optional().describe("Post ID being quoted")
      }
    },
    guard(async ({ text, replyToTweetId, quoteTweetId }) => {
      const body: Record<string, unknown> = { text };
      if (replyToTweetId) body.reply = { in_reply_to_tweet_id: replyToTweetId };
      if (quoteTweetId) body.quote_tweet_id = quoteTweetId;

      return ok(
        await callJson(`${X_BASE}/tweets`, {
          method: "POST",
          headers: writeAuth(env),
          body
        })
      );
    })
  );

  server.registerTool(
    "x_delete_tweet",
    {
      description:
        "Deletes a post on X. Requires a user-context token with tweet.write.",
      inputSchema: {
        tweetId: z.string().describe("Post ID to delete")
      }
    },
    guard(async ({ tweetId }) =>
      ok(
        await callJson(`${X_BASE}/tweets/${encodeURIComponent(tweetId)}`, {
          method: "DELETE",
          headers: writeAuth(env)
        })
      )
    )
  );
}
