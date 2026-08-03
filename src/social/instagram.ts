/**
 * Instagram tools, built on the Instagram Graph API (Business/Creator accounts).
 *
 * Requires a long-lived access token with `instagram_basic`,
 * `instagram_content_publish` and `instagram_manage_comments`.
 * Secret: INSTAGRAM_ACCESS_TOKEN (falls back to FACEBOOK_ACCESS_TOKEN).
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

const DEFAULT_PROFILE_FIELDS =
  "id,username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url";
const DEFAULT_MEDIA_FIELDS =
  "id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,like_count,comments_count";

function token(env: Env): string {
  const instagram = (env as Record<string, unknown>).INSTAGRAM_ACCESS_TOKEN;
  if (typeof instagram === "string" && instagram.length > 0) return instagram;
  return requireSecret(env, "FACEBOOK_ACCESS_TOKEN");
}

function graph(env: Env, path: string) {
  return `${GRAPH_BASE}/${graphVersion(env)}/${path}`;
}

export function registerInstagramTools(server: McpServer, env: Env) {
  server.registerTool(
    "instagram_get_profile",
    {
      description:
        "Gets the profile of an Instagram Business/Creator account (followers, bio, media count).",
      inputSchema: {
        igUserId: z
          .string()
          .describe("Instagram Business account ID, e.g. 17841400000000000"),
        fields: z
          .string()
          .optional()
          .describe("Comma-separated Graph API fields to return")
      }
    },
    guard(async ({ igUserId, fields }) =>
      ok(
        await callJson(graph(env, igUserId), {
          query: {
            fields: fields ?? DEFAULT_PROFILE_FIELDS,
            access_token: token(env)
          }
        })
      )
    )
  );

  server.registerTool(
    "instagram_list_media",
    {
      description:
        "Lists recent posts (media) of an Instagram Business/Creator account.",
      inputSchema: {
        igUserId: z.string().describe("Instagram Business account ID"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("How many posts to return (default 25)"),
        fields: z.string().optional().describe("Comma-separated media fields")
      }
    },
    guard(async ({ igUserId, limit, fields }) =>
      ok(
        await callJson(graph(env, `${igUserId}/media`), {
          query: {
            fields: fields ?? DEFAULT_MEDIA_FIELDS,
            limit: limit ?? 25,
            access_token: token(env)
          }
        })
      )
    )
  );

  server.registerTool(
    "instagram_get_media",
    {
      description: "Gets the details of a single Instagram post by media ID.",
      inputSchema: {
        mediaId: z.string().describe("Instagram media ID"),
        fields: z.string().optional().describe("Comma-separated media fields")
      }
    },
    guard(async ({ mediaId, fields }) =>
      ok(
        await callJson(graph(env, mediaId), {
          query: {
            fields: fields ?? DEFAULT_MEDIA_FIELDS,
            access_token: token(env)
          }
        })
      )
    )
  );

  server.registerTool(
    "instagram_get_media_insights",
    {
      description:
        "Gets engagement metrics (insights) for a published Instagram post.",
      inputSchema: {
        mediaId: z.string().describe("Instagram media ID"),
        metrics: z
          .string()
          .optional()
          .describe(
            "Comma-separated metrics, e.g. reach,likes,comments,saved,shares"
          )
      }
    },
    guard(async ({ mediaId, metrics }) =>
      ok(
        await callJson(graph(env, `${mediaId}/insights`), {
          query: {
            metric: metrics ?? "reach,likes,comments,saved,shares",
            access_token: token(env)
          }
        })
      )
    )
  );

  server.registerTool(
    "instagram_publish_post",
    {
      description:
        "Publishes an image or video/reel on Instagram. Runs the two-step Graph flow: creates a media container, then publishes it.",
      inputSchema: {
        igUserId: z.string().describe("Instagram Business account ID"),
        imageUrl: z
          .string()
          .url()
          .optional()
          .describe("Public JPEG URL (for an image post)"),
        videoUrl: z
          .string()
          .url()
          .optional()
          .describe("Public MP4 URL (for a reel)"),
        caption: z.string().optional().describe("Post caption"),
        mediaType: z
          .enum(["IMAGE", "REELS"])
          .optional()
          .describe("Defaults to IMAGE, or REELS when videoUrl is given")
      }
    },
    guard(async ({ igUserId, imageUrl, videoUrl, caption, mediaType }) => {
      if (!imageUrl && !videoUrl) {
        return ok("Provide imageUrl or videoUrl to publish a post.");
      }
      const accessToken = token(env);
      const type = mediaType ?? (videoUrl ? "REELS" : "IMAGE");

      const container = (await callJson(graph(env, `${igUserId}/media`), {
        method: "POST",
        query: {
          image_url: imageUrl,
          video_url: videoUrl,
          media_type: type === "IMAGE" ? undefined : type,
          caption,
          access_token: accessToken
        }
      })) as { id?: string };

      if (!container.id) {
        return ok({ warning: "No container ID returned", container });
      }

      const published = await callJson(
        graph(env, `${igUserId}/media_publish`),
        {
          method: "POST",
          query: { creation_id: container.id, access_token: accessToken }
        }
      );

      return ok({ containerId: container.id, published });
    })
  );

  server.registerTool(
    "instagram_list_comments",
    {
      description: "Lists the comments on an Instagram post.",
      inputSchema: {
        mediaId: z.string().describe("Instagram media ID"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("How many comments to return (default 25)")
      }
    },
    guard(async ({ mediaId, limit }) =>
      ok(
        await callJson(graph(env, `${mediaId}/comments`), {
          query: {
            fields: "id,text,username,timestamp,like_count,replies",
            limit: limit ?? 25,
            access_token: token(env)
          }
        })
      )
    )
  );

  server.registerTool(
    "instagram_reply_to_comment",
    {
      description: "Replies to a comment on an Instagram post.",
      inputSchema: {
        commentId: z.string().describe("ID of the comment being replied to"),
        message: z.string().min(1).describe("Reply text")
      }
    },
    guard(async ({ commentId, message }) =>
      ok(
        await callJson(graph(env, `${commentId}/replies`), {
          method: "POST",
          query: { message, access_token: token(env) }
        })
      )
    )
  );
}
