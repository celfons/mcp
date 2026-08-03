/**
 * YouTube tools, built on the YouTube Data API v3.
 *
 * Reads work with an API key (YOUTUBE_API_KEY); anything tied to "my channel"
 * or that writes needs the shared Google OAuth credentials.
 * Scope: https://www.googleapis.com/auth/youtube.force-ssl
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { googleAuth } from "./google-shared";
import { callJson, guard, ok } from "./shared";

const BASE = "https://www.googleapis.com/youtube/v3";

/**
 * Reads prefer the API key (cheaper, no OAuth round-trip) and fall back to
 * the OAuth token when no key is configured.
 */
async function readAuth(env: Env) {
  const apiKey = (env as Record<string, unknown>).YOUTUBE_API_KEY;
  if (typeof apiKey === "string" && apiKey.length > 0) {
    return { headers: {} as Record<string, string>, key: apiKey };
  }
  return { headers: await googleAuth(env), key: undefined };
}

export function registerYoutubeTools(server: McpServer, env: Env) {
  server.registerTool(
    "youtube_get_channel",
    {
      description:
        "Gets a YouTube channel by ID, by handle, or the authenticated one.",
      inputSchema: {
        channelId: z.string().optional().describe("Channel ID (UC...)"),
        handle: z.string().optional().describe("Handle, e.g. @cloudflare"),
        mine: z
          .boolean()
          .optional()
          .describe("Use the authenticated channel (requires OAuth)")
      }
    },
    guard(async ({ channelId, handle, mine }) => {
      const auth = mine ? { headers: await googleAuth(env) } : await readAuth(env);
      return ok(
        await callJson(`${BASE}/channels`, {
          headers: auth.headers,
          query: {
            part: "snippet,statistics,contentDetails,brandingSettings",
            id: channelId,
            forHandle: handle,
            mine: mine ? "true" : undefined,
            key: "key" in auth ? auth.key : undefined
          }
        })
      );
    })
  );

  server.registerTool(
    "youtube_list_videos",
    {
      description: "Lists the most recent videos of a YouTube channel.",
      inputSchema: {
        channelId: z.string().describe("Channel ID (UC...)"),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("How many videos to return (default 10)"),
        order: z
          .enum(["date", "viewCount", "rating", "title"])
          .optional()
          .describe("Ordering (default date)")
      }
    },
    guard(async ({ channelId, maxResults, order }) => {
      const auth = await readAuth(env);
      return ok(
        await callJson(`${BASE}/search`, {
          headers: auth.headers,
          query: {
            part: "snippet",
            channelId,
            type: "video",
            order: order ?? "date",
            maxResults: maxResults ?? 10,
            key: auth.key
          }
        })
      );
    })
  );

  server.registerTool(
    "youtube_get_video",
    {
      description:
        "Gets a video with its statistics (views, likes, comments).",
      inputSchema: {
        videoId: z.string().describe("Video ID")
      }
    },
    guard(async ({ videoId }) => {
      const auth = await readAuth(env);
      return ok(
        await callJson(`${BASE}/videos`, {
          headers: auth.headers,
          query: {
            part: "snippet,statistics,contentDetails,status",
            id: videoId,
            key: auth.key
          }
        })
      );
    })
  );

  server.registerTool(
    "youtube_search",
    {
      description: "Searches videos, channels or playlists on YouTube.",
      inputSchema: {
        query: z.string().min(1).describe("Search terms"),
        type: z
          .enum(["video", "channel", "playlist"])
          .optional()
          .describe("Result type (default video)"),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("How many results to return (default 10)")
      }
    },
    guard(async ({ query, type, maxResults }) => {
      const auth = await readAuth(env);
      return ok(
        await callJson(`${BASE}/search`, {
          headers: auth.headers,
          query: {
            part: "snippet",
            q: query,
            type: type ?? "video",
            maxResults: maxResults ?? 10,
            key: auth.key
          }
        })
      );
    })
  );

  server.registerTool(
    "youtube_list_comments",
    {
      description: "Lists the comment threads on a YouTube video.",
      inputSchema: {
        videoId: z.string().describe("Video ID"),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("How many threads to return (default 20)"),
        order: z
          .enum(["time", "relevance"])
          .optional()
          .describe("Ordering (default relevance)")
      }
    },
    guard(async ({ videoId, maxResults, order }) => {
      const auth = await readAuth(env);
      return ok(
        await callJson(`${BASE}/commentThreads`, {
          headers: auth.headers,
          query: {
            part: "snippet,replies",
            videoId,
            maxResults: maxResults ?? 20,
            order: order ?? "relevance",
            key: auth.key
          }
        })
      );
    })
  );

  server.registerTool(
    "youtube_reply_to_comment",
    {
      description:
        "Replies to a comment on YouTube. Requires OAuth with youtube.force-ssl.",
      inputSchema: {
        parentCommentId: z
          .string()
          .describe("Thread ID or ID of the comment being replied to"),
        text: z.string().min(1).describe("Reply text")
      }
    },
    guard(async ({ parentCommentId, text }) =>
      ok(
        await callJson(`${BASE}/comments`, {
          method: "POST",
          headers: await googleAuth(env),
          query: { part: "snippet" },
          body: {
            snippet: { parentId: parentCommentId, textOriginal: text }
          }
        })
      )
    )
  );

  server.registerTool(
    "youtube_update_video",
    {
      description:
        "Updates the title, description, tags or privacy of a video. Requires OAuth.",
      inputSchema: {
        videoId: z.string().describe("Video ID"),
        title: z.string().describe("New title (required by the API)"),
        categoryId: z
          .string()
          .describe("Category ID (required by the API), e.g. 22"),
        description: z.string().optional().describe("New description"),
        tags: z.string().optional().describe("Comma-separated tags"),
        privacyStatus: z
          .enum(["public", "unlisted", "private"])
          .optional()
          .describe("New privacy status")
      }
    },
    guard(
      async ({
        videoId,
        title,
        categoryId,
        description,
        tags,
        privacyStatus
      }) => {
        const body: Record<string, unknown> = {
          id: videoId,
          snippet: {
            title,
            categoryId,
            description,
            tags: tags
              ? tags
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter((tag) => tag.length > 0)
              : undefined
          }
        };
        if (privacyStatus) body.status = { privacyStatus };

        return ok(
          await callJson(`${BASE}/videos`, {
            method: "POST",
            headers: {
              ...(await googleAuth(env)),
              "X-HTTP-Method-Override": "PUT"
            },
            query: { part: privacyStatus ? "snippet,status" : "snippet" },
            body
          })
        );
      }
    )
  );
}
