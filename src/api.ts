// ---------------------------------------------------------------------------
// Meta WhatsApp Cloud API Client
// Handles all outbound communication with graph.facebook.com
// ---------------------------------------------------------------------------

import type {
  WhatsAppCloudConfig,
  SendResult,
  SendMessageResponse,
  SendTextRequest,
  SendTemplateRequest,
  SendInteractiveRequest,
  SendMediaRequest,
  InteractiveMessage,
  TemplateComponent,
  MediaUrlResponse,
  ApiErrorResponse,
  Logger,
} from "./types.js";

const API_BASE = "https://graph.facebook.com";

function apiUrl(config: WhatsAppCloudConfig, path: string): string {
  return `${API_BASE}/${config.apiVersion}/${path}`;
}

function headers(config: WhatsAppCloudConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.accessToken}`,
    "Content-Type": "application/json",
  };
}

// ---------------------------------------------------------------------------
// Core send function
// ---------------------------------------------------------------------------

async function sendRequest(
  config: WhatsAppCloudConfig,
  body: Record<string, unknown>,
  log: Logger
): Promise<SendResult> {
  const url = apiUrl(config, `${config.phoneNumberId}/messages`);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as ApiErrorResponse;
      const errorMsg =
        err?.error?.message ?? `HTTP ${response.status} ${response.statusText}`;
      log.error(`[whatsapp-cloud] API error: ${errorMsg}`);
      return { ok: false, error: errorMsg };
    }

    const data = (await response.json()) as SendMessageResponse;
    return { ok: true, messageId: data.messages?.[0]?.id };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error(`[whatsapp-cloud] Network error: ${errorMsg}`);
    return { ok: false, error: errorMsg };
  }
}

// ---------------------------------------------------------------------------
// Text messages
// ---------------------------------------------------------------------------

export async function sendText(
  config: WhatsAppCloudConfig,
  to: string,
  text: string,
  log: Logger
): Promise<SendResult> {
  // WhatsApp has a 4096 character limit per text message
  // Split long messages into chunks
  const chunks = splitMessage(text, 4096);
  let lastResult: SendResult = { ok: false, error: "No chunks" };

  for (const chunk of chunks) {
    const body: SendTextRequest = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: chunk },
    };
    lastResult = await sendRequest(config, body as unknown as Record<string, unknown>, log);
    if (!lastResult.ok) return lastResult;
  }

  return lastResult;
}

// ---------------------------------------------------------------------------
// Template messages (required outside the 24-hour window)
// ---------------------------------------------------------------------------

export async function sendTemplate(
  config: WhatsAppCloudConfig,
  to: string,
  templateName: string,
  languageCode: string = "en",
  components?: TemplateComponent[],
  log?: Logger
): Promise<SendResult> {
  const body: SendTemplateRequest = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components ? { components } : {}),
    },
  };
  return sendRequest(
    config,
    body as unknown as Record<string, unknown>,
    log ?? console as unknown as Logger
  );
}

// ---------------------------------------------------------------------------
// Interactive messages (buttons and lists)
// ---------------------------------------------------------------------------

export async function sendInteractive(
  config: WhatsAppCloudConfig,
  to: string,
  interactive: InteractiveMessage,
  log: Logger
): Promise<SendResult> {
  const body: SendInteractiveRequest = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive,
  };
  return sendRequest(config, body as unknown as Record<string, unknown>, log);
}

/**
 * Send a message with up to 3 quick reply buttons.
 * Convenience wrapper around sendInteractive.
 */
export async function sendButtons(
  config: WhatsAppCloudConfig,
  to: string,
  bodyText: string,
  buttons: Array<{ id: string; title: string }>,
  log: Logger
): Promise<SendResult> {
  return sendInteractive(
    config,
    to,
    {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: "reply" as const,
          reply: { id: b.id, title: b.title.slice(0, 20) },
        })),
      },
    },
    log
  );
}

// ---------------------------------------------------------------------------
// Media messages
// ---------------------------------------------------------------------------

export async function sendMedia(
  config: WhatsAppCloudConfig,
  to: string,
  mediaType: "image" | "audio" | "video" | "document",
  media: { link?: string; id?: string; caption?: string; filename?: string },
  log: Logger
): Promise<SendResult> {
  const body: SendMediaRequest = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: mediaType,
    [mediaType]: media,
  };
  return sendRequest(config, body as unknown as Record<string, unknown>, log);
}

// ---------------------------------------------------------------------------
// Media upload (resumable / direct) — for sending local files
// ---------------------------------------------------------------------------

/**
 * Upload a local file to Meta's media endpoint and return the media_id.
 * Required for sending images/audio/video/documents that aren't already
 * hosted on a public HTTPS URL.
 *
 * https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
 */
export async function uploadMediaFromPath(
  config: WhatsAppCloudConfig,
  filePath: string,
  mimeType: string,
  log: Logger
): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const buf = await fs.readFile(filePath);
  const url = apiUrl(config, `${config.phoneNumberId}/media`);

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append(
    "file",
    new Blob([new Uint8Array(buf)], { type: mimeType }),
    path.basename(filePath)
  );

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
    },
    body: form as unknown as BodyInit,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`media upload failed: ${res.status} ${res.statusText} ${text}`);
  }

  const json = (await res.json()) as { id?: string };
  if (!json.id) {
    throw new Error(`media upload returned no id: ${JSON.stringify(json)}`);
  }
  log.debug?.(`[whatsapp-cloud] uploaded media: ${path.basename(filePath)} -> ${json.id}`);
  return json.id;
}

/**
 * Detect if a string is a remote URL (http/https) vs a local file path.
 * Used by the channel deliver callback to decide between Meta's
 * link-based send (for URLs) and id-based send (for local files).
 */
export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * Guess MIME type from file extension. Meta only accepts a fixed set of
 * MIME types per media kind; this covers the common ones.
 */
export function guessMimeFromPath(filePath: string): string {
  const ext = filePath.toLowerCase().split(".").pop();
  switch (ext) {
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    case "gif": return "image/gif";
    case "mp4": return "video/mp4";
    case "3gp": return "video/3gpp";
    case "mp3": return "audio/mpeg";
    case "ogg": return "audio/ogg";
    case "amr": return "audio/amr";
    case "pdf": return "application/pdf";
    default: return "application/octet-stream";
  }
}

// ---------------------------------------------------------------------------
// Read receipts
// ---------------------------------------------------------------------------

export async function markAsRead(
  config: WhatsAppCloudConfig,
  messageId: string,
  log: Logger
): Promise<void> {
  const url = apiUrl(config, `${config.phoneNumberId}/messages`);

  try {
    await fetch(url, {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      }),
    });
  } catch (err) {
    log.debug(`[whatsapp-cloud] Failed to send read receipt: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Typing indicators
// ---------------------------------------------------------------------------

/**
 * Show a "typing..." indicator to the user.
 * The indicator is automatically removed when you send a reply or after 25s.
 * Requires the message_id of the received message to attach to.
 */
export async function sendTypingIndicator(
  config: WhatsAppCloudConfig,
  messageId: string,
  log: Logger
): Promise<void> {
  const url = apiUrl(config, `${config.phoneNumberId}/messages`);

  try {
    await fetch(url, {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
        typing_indicator: {
          type: "text",
        },
      }),
    });
  } catch (err) {
    log.debug?.(`[whatsapp-cloud] Failed to send typing indicator: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Media download (for receiving media from users)
// ---------------------------------------------------------------------------

/**
 * Get the download URL for a media object.
 * The URL is temporary and requires the access token to download.
 */
export async function getMediaUrl(
  config: WhatsAppCloudConfig,
  mediaId: string,
  log: Logger
): Promise<string | null> {
  const url = apiUrl(config, mediaId);

  try {
    const response = await fetch(url, { headers: headers(config) });
    if (!response.ok) {
      log.error(`[whatsapp-cloud] Failed to get media URL: ${response.status}`);
      return null;
    }
    const data = (await response.json()) as MediaUrlResponse;
    return data.url;
  } catch (err) {
    log.error(`[whatsapp-cloud] Failed to get media URL: ${err}`);
    return null;
  }
}

/**
 * Download media binary content from Meta's CDN.
 */
export async function downloadMedia(
  config: WhatsAppCloudConfig,
  mediaUrl: string,
  log: Logger
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const response = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${config.accessToken}` },
    });
    if (!response.ok) {
      log.error(`[whatsapp-cloud] Media download failed: ${response.status}`);
      return null;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const mimeType = response.headers.get("content-type") ?? "application/octet-stream";
    return { buffer, mimeType };
  } catch (err) {
    log.error(`[whatsapp-cloud] Media download error: ${err}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Split a long message into chunks, respecting word boundaries */
function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    // Find last newline or space before the limit
    let splitIndex = remaining.lastIndexOf("\n", maxLength);
    if (splitIndex < maxLength * 0.5) {
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIndex < maxLength * 0.3) {
      splitIndex = maxLength; // hard split
    }

    chunks.push(remaining.slice(0, splitIndex).trimEnd());
    remaining = remaining.slice(splitIndex).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}
