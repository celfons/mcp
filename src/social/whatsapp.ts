/**
 * WhatsApp tools, built on the WhatsApp Cloud API (Graph API).
 *
 * Requires a system user token with `whatsapp_business_messaging` and
 * `whatsapp_business_management`.
 * Secrets: WHATSAPP_ACCESS_TOKEN (falls back to FACEBOOK_ACCESS_TOKEN) and
 * WHATSAPP_PHONE_NUMBER_ID (default sender, overridable per call).
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

function token(env: Env): string {
  const whatsapp = (env as Record<string, unknown>).WHATSAPP_ACCESS_TOKEN;
  if (typeof whatsapp === "string" && whatsapp.length > 0) return whatsapp;
  return requireSecret(env, "FACEBOOK_ACCESS_TOKEN");
}

/** Resolves the sender: the per-call phone number ID, else the configured one. */
function sender(env: Env, phoneNumberId?: string): string {
  if (phoneNumberId) return phoneNumberId;
  return requireSecret(env, "WHATSAPP_PHONE_NUMBER_ID");
}

function graph(env: Env, path: string) {
  return `${GRAPH_BASE}/${graphVersion(env)}/${path}`;
}

function auth(env: Env): Record<string, string> {
  return { Authorization: `Bearer ${token(env)}` };
}

/** Strips formatting so "+55 (11) 99999-9999" becomes a valid wa_id. */
function normaliseRecipient(value: string): string {
  return value.replace(/[^\d]/g, "");
}

const phoneNumberIdArg = z
  .string()
  .optional()
  .describe("Sender phone number ID (defaults to WHATSAPP_PHONE_NUMBER_ID)");

const toArg = z
  .string()
  .min(1)
  .describe("Recipient number with country code, e.g. 5511999999999");

/** POSTs to the /messages edge, which every send tool shares. */
function sendMessage(env: Env, phoneNumberId: string, payload: object) {
  return callJson(graph(env, `${phoneNumberId}/messages`), {
    method: "POST",
    headers: auth(env),
    body: { messaging_product: "whatsapp", ...payload }
  });
}

export function registerWhatsappTools(server: McpServer, env: Env) {
  server.registerTool(
    "whatsapp_send_message",
    {
      description:
        "Sends a free-form text message on WhatsApp. Only allowed inside the 24-hour customer service window — outside it, use whatsapp_send_template.",
      inputSchema: {
        to: toArg,
        text: z.string().min(1).max(4096).describe("Message body"),
        previewUrl: z
          .boolean()
          .optional()
          .describe("Render a link preview for URLs in the text"),
        phoneNumberId: phoneNumberIdArg
      }
    },
    guard(async ({ to, text, previewUrl, phoneNumberId }) =>
      ok(
        await sendMessage(env, sender(env, phoneNumberId), {
          to: normaliseRecipient(to),
          type: "text",
          text: { body: text, preview_url: previewUrl ?? false }
        })
      )
    )
  );

  server.registerTool(
    "whatsapp_send_template",
    {
      description:
        "Sends an approved template message on WhatsApp. This is the only way to start a conversation outside the 24-hour window.",
      inputSchema: {
        to: toArg,
        templateName: z.string().min(1).describe("Approved template name"),
        languageCode: z
          .string()
          .optional()
          .describe("Template language, e.g. pt_BR or en_US (default pt_BR)"),
        bodyParameters: z
          .string()
          .optional()
          .describe(
            "Comma-separated values filling the template's {{1}}, {{2}}, … placeholders"
          ),
        phoneNumberId: phoneNumberIdArg
      }
    },
    guard(
      async ({
        to,
        templateName,
        languageCode,
        bodyParameters,
        phoneNumberId
      }) => {
        const values = (bodyParameters ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter((value) => value.length > 0);

        const template: Record<string, unknown> = {
          name: templateName,
          language: { code: languageCode ?? "pt_BR" }
        };

        if (values.length > 0) {
          template.components = [
            {
              type: "body",
              parameters: values.map((value) => ({ type: "text", text: value }))
            }
          ];
        }

        return ok(
          await sendMessage(env, sender(env, phoneNumberId), {
            to: normaliseRecipient(to),
            type: "template",
            template
          })
        );
      }
    )
  );

  server.registerTool(
    "whatsapp_send_media",
    {
      description:
        "Sends an image, video, audio or document on WhatsApp from a public URL.",
      inputSchema: {
        to: toArg,
        mediaUrl: z.string().url().describe("Public URL of the file"),
        mediaType: z
          .enum(["image", "video", "audio", "document"])
          .describe("Kind of media being sent"),
        caption: z
          .string()
          .optional()
          .describe("Caption (image, video and document only)"),
        filename: z
          .string()
          .optional()
          .describe("File name shown to the recipient (document only)"),
        phoneNumberId: phoneNumberIdArg
      }
    },
    guard(
      async ({ to, mediaUrl, mediaType, caption, filename, phoneNumberId }) => {
        const media: Record<string, unknown> = { link: mediaUrl };
        if (caption && mediaType !== "audio") media.caption = caption;
        if (filename && mediaType === "document") media.filename = filename;

        return ok(
          await sendMessage(env, sender(env, phoneNumberId), {
            to: normaliseRecipient(to),
            type: mediaType,
            [mediaType]: media
          })
        );
      }
    )
  );

  server.registerTool(
    "whatsapp_send_reaction",
    {
      description: "Reacts to a received WhatsApp message with an emoji.",
      inputSchema: {
        to: toArg,
        messageId: z.string().describe("ID of the message being reacted to"),
        emoji: z
          .string()
          .describe("Emoji to react with; send an empty string to remove it"),
        phoneNumberId: phoneNumberIdArg
      }
    },
    guard(async ({ to, messageId, emoji, phoneNumberId }) =>
      ok(
        await sendMessage(env, sender(env, phoneNumberId), {
          to: normaliseRecipient(to),
          type: "reaction",
          reaction: { message_id: messageId, emoji }
        })
      )
    )
  );

  server.registerTool(
    "whatsapp_mark_as_read",
    {
      description:
        "Marks a received WhatsApp message as read (blue ticks for the sender).",
      inputSchema: {
        messageId: z.string().describe("ID of the received message"),
        phoneNumberId: phoneNumberIdArg
      }
    },
    guard(async ({ messageId, phoneNumberId }) =>
      ok(
        await sendMessage(env, sender(env, phoneNumberId), {
          status: "read",
          message_id: messageId
        })
      )
    )
  );

  server.registerTool(
    "whatsapp_get_business_profile",
    {
      description:
        "Gets the WhatsApp Business profile of the sending number (description, address, website).",
      inputSchema: { phoneNumberId: phoneNumberIdArg }
    },
    guard(async ({ phoneNumberId }) =>
      ok(
        await callJson(
          graph(env, `${sender(env, phoneNumberId)}/whatsapp_business_profile`),
          {
            headers: auth(env),
            query: {
              fields:
                "about,address,description,email,profile_picture_url,websites,vertical"
            }
          }
        )
      )
    )
  );

  server.registerTool(
    "whatsapp_list_templates",
    {
      description:
        "Lists the message templates of a WhatsApp Business Account, with their approval status.",
      inputSchema: {
        wabaId: z.string().describe("WhatsApp Business Account (WABA) ID"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("How many templates to return (default 25)")
      }
    },
    guard(async ({ wabaId, limit }) =>
      ok(
        await callJson(graph(env, `${wabaId}/message_templates`), {
          headers: auth(env),
          query: {
            fields: "id,name,status,category,language,components",
            limit: limit ?? 25
          }
        })
      )
    )
  );

  server.registerTool(
    "whatsapp_get_media_url",
    {
      description:
        "Resolves the temporary download URL of a media file received on WhatsApp.",
      inputSchema: {
        mediaId: z.string().describe("Media ID from the incoming webhook")
      }
    },
    guard(async ({ mediaId }) =>
      ok(await callJson(graph(env, mediaId), { headers: auth(env) }))
    )
  );
}
