declare const plugin: {
    id: string;
    name: string;
    description: string;
    register(api: any): void;
};
export default plugin;
export { sendText, sendTemplate, sendInteractive, sendButtons, sendMedia } from "./api.js";
export { markAsRead, sendTypingIndicator, getMediaUrl, downloadMedia } from "./api.js";
export { runSetupWizard, validateConfig } from "./setup.js";
export type { WhatsAppCloudConfig } from "./types.js";
export type { ParsedInboundMessage, ParsedInboundMessage as InboundMessage } from "./webhook.js";
export { whatsappCloudOnboardingAdapter } from "./onboarding.js";
