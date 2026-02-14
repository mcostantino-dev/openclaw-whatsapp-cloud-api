// ---------------------------------------------------------------------------
// Webhook Server — receives inbound messages from Meta
// ---------------------------------------------------------------------------

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { verifyWebhookSignature } from "./crypto.js";
import { markAsRead } from "./api.js";
import type {
  WhatsAppCloudConfig,
  WebhookPayload,
  IncomingMessage as WAMessage,
  WebhookContact,
  Logger,
} from "./types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ParsedInboundMessage {
  /** Sender phone number (E.164 format) */
  from: string;
  /** Sender display name from WhatsApp profile */
  senderName: string;
  /** Extracted text content */
  text: string;
  /** Original message ID (for context/replies) */
  messageId: string;
  /** Message timestamp */
  timestamp: string;
  /** Original message type */
  type: string;
  /** Media info, if the message contained media */
  media?: {
    id: string;
    mimeType: string;
    caption?: string;
    filename?: string;
  };
  /** Interactive reply data (button/list selection) */
  interactiveReply?: {
    id: string;
    title: string;
    type: "button_reply" | "list_reply";
  };
  /** If this is a reply to a previous message */
  quotedMessageId?: string;
}

export type InboundMessageHandler = (message: ParsedInboundMessage) => void;
export type StatusUpdateHandler = (
  messageId: string,
  status: string,
  recipientId: string
) => void;

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export function startWebhookServer(
  config: WhatsAppCloudConfig,
  onMessage: InboundMessageHandler,
  onStatus: StatusUpdateHandler | undefined,
  log: Logger
): Server {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;

    // ----- Webhook verification (GET) -----
    if (req.method === "GET" && path === config.webhookPath) {
      handleVerification(url, config, res, log);
      return;
    }

    // ----- Incoming webhook events (POST) -----
    if (req.method === "POST" && path === config.webhookPath) {
      await handleIncoming(req, res, config, onMessage, onStatus, log);
      return;
    }

    // ----- Health check -----
    if (req.method === "GET" && path === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", channel: "whatsapp-cloud" }));
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(config.webhookPort, () => {
    log.info(
      `[whatsapp-cloud] Webhook server listening on port ${config.webhookPort} at ${config.webhookPath}`
    );
  });

  server.on("error", (err) => {
    log.error(`[whatsapp-cloud] Webhook server error: ${err.message}`);
  });

  return server;
}

// ---------------------------------------------------------------------------
// GET — Meta webhook verification challenge
// ---------------------------------------------------------------------------

function handleVerification(
  url: URL,
  config: WhatsAppCloudConfig,
  res: ServerResponse,
  log: Logger
): void {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === config.verifyToken && challenge) {
    log.info("[whatsapp-cloud] Webhook verification successful");
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(challenge);
  } else {
    log.warn("[whatsapp-cloud] Webhook verification failed — token mismatch");
    res.writeHead(403);
    res.end("Forbidden");
  }
}

// ---------------------------------------------------------------------------
// POST — process incoming webhook events
// ---------------------------------------------------------------------------

async function handleIncoming(
  req: IncomingMessage,
  res: ServerResponse,
  config: WhatsAppCloudConfig,
  onMessage: InboundMessageHandler,
  onStatus: StatusUpdateHandler | undefined,
  log: Logger
): Promise<void> {
  // Read body
  let rawBody = "";
  for await (const chunk of req) rawBody += chunk;

  // Always respond 200 quickly — Meta retries on non-2xx
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK");

  // Verify signature (skip if appSecret not configured — dev mode)
  if (config.appSecret) {
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    if (!verifyWebhookSignature(rawBody, signature, config.appSecret)) {
      log.warn("[whatsapp-cloud] Webhook signature verification FAILED — ignoring payload");
      return;
    }
  } else {
    log.debug(
      "[whatsapp-cloud] No appSecret configured — skipping signature verification (NOT safe for production)"
    );
  }

  // Parse and process
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch (err) {
    log.error(`[whatsapp-cloud] Failed to parse webhook JSON: ${err}`);
    return;
  }

  if (payload.object !== "whatsapp_business_account") {
    log.debug(`[whatsapp-cloud] Ignoring non-WhatsApp webhook object: ${payload.object}`);
    return;
  }

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;

      const { messages, contacts, statuses, errors } = change.value;

      // Log errors
      if (errors?.length) {
        for (const err of errors) {
          log.error(
            `[whatsapp-cloud] Webhook error ${err.code}: ${err.title} — ${err.message}`
          );
        }
      }

      // Process status updates
      if (statuses?.length && onStatus) {
        for (const status of statuses) {
          onStatus(status.id, status.status, status.recipient_id);
        }
      }

      // Process incoming messages
      if (messages?.length) {
        for (const msg of messages) {
          processMessage(msg, contacts ?? [], config, onMessage, log);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Parse a single incoming message
// ---------------------------------------------------------------------------

function processMessage(
  msg: WAMessage,
  contacts: WebhookContact[],
  config: WhatsAppCloudConfig,
  onMessage: InboundMessageHandler,
  log: Logger
): void {
  // Access control
  if (config.dmPolicy === "allowlist") {
    const normalized = normalizePhone(msg.from);
    const allowed = config.allowFrom.some((n) => normalizePhone(n) === normalized);
    if (!allowed) {
      log.info(`[whatsapp-cloud] Blocked message from ${msg.from} (not in allowlist)`);
      return;
    }
  }

  // Resolve sender name
  const contact = contacts.find((c) => c.wa_id === msg.from);
  const senderName = contact?.profile?.name ?? msg.from;

  // Extract text and media
  const parsed = extractMessageContent(msg);

  const inbound: ParsedInboundMessage = {
    from: msg.from,
    senderName,
    text: parsed.text,
    messageId: msg.id,
    timestamp: msg.timestamp,
    type: msg.type,
    media: parsed.media,
    interactiveReply: parsed.interactiveReply,
    quotedMessageId: msg.context?.id,
  };

  log.info(
    `[whatsapp-cloud] ← ${senderName} (${msg.from}): ${inbound.text.slice(0, 100)}${
      inbound.text.length > 100 ? "…" : ""
    }`
  );

  // Send read receipt
  if (config.sendReadReceipts) {
    markAsRead(config, msg.id, log);
  }

  // Dispatch to OpenClaw
  onMessage(inbound);
}

// ---------------------------------------------------------------------------
// Content extraction
// ---------------------------------------------------------------------------

interface ExtractedContent {
  text: string;
  media?: ParsedInboundMessage["media"];
  interactiveReply?: ParsedInboundMessage["interactiveReply"];
}

function extractMessageContent(msg: WAMessage): ExtractedContent {
  switch (msg.type) {
    case "text":
      return { text: msg.text?.body ?? "" };

    case "image":
      return {
        text: msg.image?.caption ?? "[📷 Image]",
        media: msg.image
          ? { id: msg.image.id, mimeType: msg.image.mime_type, caption: msg.image.caption }
          : undefined,
      };

    case "audio":
      return {
        text: "[🎵 Audio message]",
        media: msg.audio
          ? { id: msg.audio.id, mimeType: msg.audio.mime_type }
          : undefined,
      };

    case "video":
      return {
        text: msg.video?.caption ?? "[🎬 Video]",
        media: msg.video
          ? { id: msg.video.id, mimeType: msg.video.mime_type, caption: msg.video.caption }
          : undefined,
      };

    case "document":
      return {
        text: msg.document?.caption ?? `[📄 Document: ${msg.document?.filename ?? "file"}]`,
        media: msg.document
          ? {
              id: msg.document.id,
              mimeType: msg.document.mime_type,
              caption: msg.document.caption,
              filename: msg.document.filename,
            }
          : undefined,
      };

    case "sticker":
      return {
        text: "[Sticker]",
        media: msg.sticker
          ? { id: msg.sticker.id, mimeType: msg.sticker.mime_type }
          : undefined,
      };

    case "location":
      return {
        text: msg.location
          ? `[📍 Location: ${msg.location.name ?? ""} ${msg.location.address ?? `${msg.location.latitude},${msg.location.longitude}`}]`.trim()
          : "[📍 Location]",
      };

    case "contacts":
      return {
        text: msg.contacts
          ? `[Contact: ${msg.contacts.map((c) => c.name.formatted_name).join(", ")}]`
          : "[Contact]",
      };

    case "interactive": {
      const reply = msg.interactive;
      if (reply?.type === "button_reply" && reply.button_reply) {
        return {
          text: reply.button_reply.title,
          interactiveReply: {
            id: reply.button_reply.id,
            title: reply.button_reply.title,
            type: "button_reply",
          },
        };
      }
      if (reply?.type === "list_reply" && reply.list_reply) {
        return {
          text: reply.list_reply.title,
          interactiveReply: {
            id: reply.list_reply.id,
            title: reply.list_reply.title,
            type: "list_reply",
          },
        };
      }
      return { text: "[Interactive message]" };
    }

    case "button":
      return { text: msg.button?.text ?? "[Button]" };

    default:
      return { text: `[${msg.type} message — not yet supported]` };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize phone to digits-only for comparison */
function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}
