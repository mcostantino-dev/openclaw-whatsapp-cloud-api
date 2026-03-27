import type { WhatsAppCloudConfig, SendResult, InteractiveMessage, TemplateComponent, Logger } from "./types.js";
export declare function sendText(config: WhatsAppCloudConfig, to: string, text: string, log: Logger): Promise<SendResult>;
export declare function sendTemplate(config: WhatsAppCloudConfig, to: string, templateName: string, languageCode?: string, components?: TemplateComponent[], log?: Logger): Promise<SendResult>;
export declare function sendInteractive(config: WhatsAppCloudConfig, to: string, interactive: InteractiveMessage, log: Logger): Promise<SendResult>;
/**
 * Send a message with up to 3 quick reply buttons.
 * Convenience wrapper around sendInteractive.
 */
export declare function sendButtons(config: WhatsAppCloudConfig, to: string, bodyText: string, buttons: Array<{
    id: string;
    title: string;
}>, log: Logger): Promise<SendResult>;
export declare function sendMedia(config: WhatsAppCloudConfig, to: string, mediaType: "image" | "audio" | "video" | "document", media: {
    link?: string;
    id?: string;
    caption?: string;
    filename?: string;
}, log: Logger): Promise<SendResult>;
export declare function markAsRead(config: WhatsAppCloudConfig, messageId: string, log: Logger): Promise<void>;
/**
 * Show a "typing..." indicator to the user.
 * The indicator is automatically removed when you send a reply or after 25s.
 * Requires the message_id of the received message to attach to.
 */
export declare function sendTypingIndicator(config: WhatsAppCloudConfig, messageId: string, log: Logger): Promise<void>;
/**
 * Get the download URL for a media object.
 * The URL is temporary and requires the access token to download.
 */
export declare function getMediaUrl(config: WhatsAppCloudConfig, mediaId: string, log: Logger): Promise<string | null>;
/**
 * Download media binary content from Meta's CDN.
 */
export declare function downloadMedia(config: WhatsAppCloudConfig, mediaUrl: string, log: Logger): Promise<{
    buffer: Buffer;
    mimeType: string;
} | null>;
