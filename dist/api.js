// ---------------------------------------------------------------------------
// Meta WhatsApp Cloud API Client
// Handles all outbound communication with graph.facebook.com
// ---------------------------------------------------------------------------
const API_BASE = "https://graph.facebook.com";
function apiUrl(config, path) {
    return `${API_BASE}/${config.apiVersion}/${path}`;
}
function headers(config) {
    return {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
    };
}
// ---------------------------------------------------------------------------
// Core send function
// ---------------------------------------------------------------------------
async function sendRequest(config, body, log) {
    const url = apiUrl(config, `${config.phoneNumberId}/messages`);
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: headers(config),
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const err = (await response.json().catch(() => ({})));
            const errorMsg = err?.error?.message ?? `HTTP ${response.status} ${response.statusText}`;
            log.error(`[whatsapp-cloud] API error: ${errorMsg}`);
            return { ok: false, error: errorMsg };
        }
        const data = (await response.json());
        return { ok: true, messageId: data.messages?.[0]?.id };
    }
    catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        log.error(`[whatsapp-cloud] Network error: ${errorMsg}`);
        return { ok: false, error: errorMsg };
    }
}
// ---------------------------------------------------------------------------
// Text messages
// ---------------------------------------------------------------------------
export async function sendText(config, to, text, log) {
    // WhatsApp has a 4096 character limit per text message
    // Split long messages into chunks
    const chunks = splitMessage(text, 4096);
    let lastResult = { ok: false, error: "No chunks" };
    for (const chunk of chunks) {
        const body = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to,
            type: "text",
            text: { preview_url: false, body: chunk },
        };
        lastResult = await sendRequest(config, body, log);
        if (!lastResult.ok)
            return lastResult;
    }
    return lastResult;
}
// ---------------------------------------------------------------------------
// Template messages (required outside the 24-hour window)
// ---------------------------------------------------------------------------
export async function sendTemplate(config, to, templateName, languageCode = "en", components, log) {
    const body = {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
            name: templateName,
            language: { code: languageCode },
            ...(components ? { components } : {}),
        },
    };
    return sendRequest(config, body, log ?? console);
}
// ---------------------------------------------------------------------------
// Interactive messages (buttons and lists)
// ---------------------------------------------------------------------------
export async function sendInteractive(config, to, interactive, log) {
    const body = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "interactive",
        interactive,
    };
    return sendRequest(config, body, log);
}
/**
 * Send a message with up to 3 quick reply buttons.
 * Convenience wrapper around sendInteractive.
 */
export async function sendButtons(config, to, bodyText, buttons, log) {
    return sendInteractive(config, to, {
        type: "button",
        body: { text: bodyText },
        action: {
            buttons: buttons.slice(0, 3).map((b) => ({
                type: "reply",
                reply: { id: b.id, title: b.title.slice(0, 20) },
            })),
        },
    }, log);
}
// ---------------------------------------------------------------------------
// Media messages
// ---------------------------------------------------------------------------
export async function sendMedia(config, to, mediaType, media, log) {
    const body = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: mediaType,
        [mediaType]: media,
    };
    return sendRequest(config, body, log);
}
// ---------------------------------------------------------------------------
// Read receipts
// ---------------------------------------------------------------------------
export async function markAsRead(config, messageId, log) {
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
    }
    catch (err) {
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
export async function sendTypingIndicator(config, messageId, log) {
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
    }
    catch (err) {
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
export async function getMediaUrl(config, mediaId, log) {
    const url = apiUrl(config, mediaId);
    try {
        const response = await fetch(url, { headers: headers(config) });
        if (!response.ok) {
            log.error(`[whatsapp-cloud] Failed to get media URL: ${response.status}`);
            return null;
        }
        const data = (await response.json());
        return data.url;
    }
    catch (err) {
        log.error(`[whatsapp-cloud] Failed to get media URL: ${err}`);
        return null;
    }
}
/**
 * Download media binary content from Meta's CDN.
 */
export async function downloadMedia(config, mediaUrl, log) {
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
    }
    catch (err) {
        log.error(`[whatsapp-cloud] Media download error: ${err}`);
        return null;
    }
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Split a long message into chunks, respecting word boundaries */
function splitMessage(text, maxLength) {
    if (text.length <= maxLength)
        return [text];
    const chunks = [];
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
