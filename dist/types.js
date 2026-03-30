// ---------------------------------------------------------------------------
// WhatsApp Cloud API — Type Definitions
// ---------------------------------------------------------------------------
/** Defaults applied when config values are missing */
export const CONFIG_DEFAULTS = {
    enabled: true,
    verifyToken: "openclaw-wa-cloud-verify",
    webhookPort: 3100,
    webhookPath: "/webhook/whatsapp-cloud",
    apiVersion: "v21.0",
    dmPolicy: "open",
    allowFrom: [],
    sendReadReceipts: true,
};
