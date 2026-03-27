import { type Server } from "node:http";
import type { WhatsAppCloudConfig, Logger } from "./types.js";
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
export type StatusUpdateHandler = (messageId: string, status: string, recipientId: string) => void;
export declare function startWebhookServer(config: WhatsAppCloudConfig, onMessage: InboundMessageHandler, onStatus: StatusUpdateHandler | undefined, log: Logger): Server;
