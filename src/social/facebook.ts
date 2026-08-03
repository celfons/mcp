/**
 * Facebook Page tools, built on the Facebook Graph API.
 *
 * Requires a Page access token with `pages_read_engagement`,
 * `pages_manage_posts` and `pages_manage_engagement`.
 * Secret: FACEBOOK_ACCESS_TOKEN.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  GRAPH_BASE,
  callJson,
  graphVersion,
  guard,
  ok,
  requireSecret
} from "./shared";

const DEFAULT_PAGE_FIELDS =
  "id,name,username,about,category,link,fan_count,followers_count,verification_status";
const DEFAULT_POST_FIELDS =
  "id,message,story,created_time,permalink_url,full_picture,shares";

function token(env: Env): string {
  return requireSecret(env, "FACEBOOK_ACCESS_TOKEN");
}

function graph(env: Env, path: string) {
  return `${GRAPH_BASE}/${graphVersion(env)}/${path}`;
}

export function registerFacebookTools(server: McpServer, env: Env) {
  server.registerTool(
    "facebook_list_pages",
    {
      description:
        "Lists the Facebook Pages the current access token can manage, including each Page's own token.",
      inputSchema: {}
    },
    guard(async () =>
      ok(
        await callJson(graph(env, "me/accounts"), {
          query: {
            fields: "id,name,category,tasks",
            access_token: token(env)
          }
        })
      )
    )
  );

  server.registerTool(
    "facebook_get_page",
    {
      description:
        "Gets the details of a Facebook Page (name, category, follower counts).",
      inputSchema: {
        pageId: z.string().describe("Facebook Page ID"),
        fields: z.string().optional().describe("Comma-separated Graph fields")
      }
    },
    guard(async ({ pageId, fields }) =>
      ok(
        await callJson(graph(env, pageId), {
          query: {
            fields: fields ?? DEFAULT_PAGE_FIELDS,
            access_token: token(env)
          }
        })
      )
    )
  );

  server.registerTool(
    "facebook_list_posts",
    {
      description: "Lists the most recent posts published on a Facebook Page.",
      inputSchema: {
        pageId: z.string().describe("Facebook Page ID"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("How many posts to return (default 25)"),
        fields: z.string().optional().describe("Comma-separated post fields")
      }
    },
    guard(async ({ pageId, limit, fields }) =>
      ok(
        await callJson(graph(env, `${pageId}/posts`), {
          query: {
            fields: fields ?? DEFAULT_POST_FIELDS,
            limit: limit ?? 25,
            access_token: token(env)
          }
        })
      )
    )
  );

  server.registerTool(
    "facebook_create_post",
    {
      description:
        "Publishes a text post (optionally with a link) on a Facebook Page.",
      inputSchema: {
        pageId: z.string().describe("Facebook Page ID"),
        message: z.string().min(1).describe("Post text"),
        link: z.string().url().optional().describe("URL to attach to the post"),
        published: z
          .boolean()
          .optional()
          .describe("Set false to create the post as a draft")
      }
    },
    guard(async ({ pageId, message, link, published }) =>
      ok(
        await callJson(graph(env, `${pageId}/feed`), {
          method: "POST",
          query: {
            message,
            link,
            published: published === undefined ? undefined : published,
            access_token: token(env)
          }
        })
      )
    )
  );

  server.registerTool(
    "facebook_upload_photo",
    {
      description: "Publishes a photo on a Facebook Page from a public URL.",
      inputSchema: {
        pageId: z.string().describe("Facebook Page ID"),
        imageUrl: z.string().url().describe("Public image URL"),
        caption: z.string().optional().describe("Photo caption")
      }
    },
    guard(async ({ pageId, imageUrl, caption }) =>
      ok(
        await callJson(graph(env, `${pageId}/photos`), {
          method: "POST",
          query: {
            url: imageUrl,
            caption,
            access_token: token(env)
          }
        })
      )
    )
  );

  server.registerTool(
    "facebook_delete_post",
    {
      description: "Deletes a post from a Facebook Page.",
      inputSchema: {
        postId: z.string().describe("Post ID, in the form pageId_postId")
      }
    },
    guard(async ({ postId }) =>
      ok(
        await callJson(graph(env, postId), {
          method: "DELETE",
          query: { access_token: token(env) }
        })
      )
    )
  );

  server.registerTool(
    "facebook_get_post_insights",
    {
      description: "Gets the engagement metrics (insights) for a Page post.",
      inputSchema: {
        postId: z.string().describe("Post ID, in the form pageId_postId"),
        metrics: z
          .string()
          .optional()
          .describe(
            "Comma-separated metrics, e.g. post_impressions,post_engaged_users"
          )
      }
    },
    guard(async ({ postId, metrics }) =>
      ok(
        await callJson(graph(env, `${postId}/insights`), {
          query: {
            metric:
              metrics ??
              "post_impressions,post_impressions_unique,post_engaged_users,post_clicks",
            access_token: token(env)
          }
        })
      )
    )
  );

  server.registerTool(
    "facebook_list_comments",
    {
      description: "Lists the comments on a Facebook Page post.",
      inputSchema: {
        postId: z.string().describe("Post ID, in the form pageId_postId"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("How many comments to return (default 25)")
      }
    },
    guard(async ({ postId, limit }) =>
      ok(
        await callJson(graph(env, `${postId}/comments`), {
          query: {
            fields: "id,message,from,created_time,like_count,comment_count",
            limit: limit ?? 25,
            access_token: token(env)
          }
        })
      )
    )
  );

  server.registerTool(
    "facebook_reply_to_comment",
    {
      description: "Replies to a comment on a Facebook Page post.",
      inputSchema: {
        commentId: z.string().describe("ID of the comment being replied to"),
        message: z.string().min(1).describe("Reply text")
      }
    },
    guard(async ({ commentId, message }) =>
      ok(
        await callJson(graph(env, `${commentId}/comments`), {
          method: "POST",
          query: { message, access_token: token(env) }
        })
      )
    )
  );
}
