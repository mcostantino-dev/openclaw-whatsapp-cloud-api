// ---------------------------------------------------------------------------
// Setup Wizard — interactive credential collection for WhatsApp Cloud API
//
// Called when the user runs:
//   openclaw channels login whatsapp-cloud
//   openclaw whatsapp-cloud setup
//
// Guides the user through Meta Business API configuration step by step.
// ---------------------------------------------------------------------------
import { createInterface } from "node:readline";
import { CONFIG_DEFAULTS } from "./types.js";
/**
 * Fallback prompter using readline for environments where OpenClaw's
 * prompter is not available (e.g., direct CLI invocation).
 */
function createReadlinePrompter() {
    async function ask(question, hide = false) {
        const rl = createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        return new Promise((resolve) => {
            rl.question(question, (answer) => {
                rl.close();
                resolve(answer.trim());
            });
        });
    }
    return {
        input: async (msg, opts) => {
            const def = opts?.default ? ` (${opts.default})` : "";
            const answer = await ask(`${msg}${def}: `);
            return answer || opts?.default || "";
        },
        password: async (msg) => ask(`${msg}: `, true),
        confirm: async (msg, opts) => {
            const def = opts?.default !== false ? "Y/n" : "y/N";
            const answer = await ask(`${msg} [${def}]: `);
            if (!answer)
                return opts?.default !== false;
            return answer.toLowerCase().startsWith("y");
        },
        select: async (msg, choices) => {
            console.log(`\n${msg}`);
            choices.forEach((c, i) => console.log(`  ${i + 1}. ${c.name}`));
            const answer = await ask("Choose: ");
            const idx = parseInt(answer, 10) - 1;
            return choices[Math.max(0, Math.min(idx, choices.length - 1))].value;
        },
    };
}
// ---------------------------------------------------------------------------
// Setup steps
// ---------------------------------------------------------------------------
const META_SETUP_GUIDE = `
┌──────────────────────────────────────────────────────────┐
│  WhatsApp Cloud API — Setup Guide                        │
│                                                          │
│  You'll need credentials from Meta Business dashboard:   │
│  https://developers.facebook.com/                        │
│                                                          │
│  1. Create an app → Add WhatsApp product                 │
│  2. Go to WhatsApp → API Setup for Phone Number ID       │
│  3. Create a System User for a permanent access token    │
│  4. Note your App Secret from App Settings → Basic       │
│                                                          │
│  Full guide: README.md in this plugin                    │
└──────────────────────────────────────────────────────────┘
`;
/**
 * Run the interactive setup wizard.
 * Returns the config values to be saved under channels.whatsapp-cloud.
 */
export async function runSetupWizard(prompter, log) {
    const prompt = prompter ?? createReadlinePrompter();
    const logger = log ?? console;
    console.log(META_SETUP_GUIDE);
    // ----- Step 1: Phone Number ID -----
    logger.info("Step 1/6: Phone Number ID");
    const phoneNumberId = await prompt.input("Enter your WhatsApp Phone Number ID (from Meta → WhatsApp → API Setup)", { default: "" });
    if (!phoneNumberId) {
        throw new Error("Phone Number ID is required. Find it at: Meta Developers → Your App → WhatsApp → API Setup");
    }
    // ----- Step 2: Business Account ID (optional) -----
    logger.info("Step 2/6: Business Account ID (optional)");
    const businessAccountId = await prompt.input("Enter your WhatsApp Business Account ID (optional, press Enter to skip)", { default: "" });
    // ----- Step 3: Access Token -----
    logger.info("Step 3/6: Access Token");
    console.log("  💡 Use a System User token for permanent access (won't expire).\n" +
        "     Create one in: Business Settings → System Users → Generate Token\n" +
        "     Required permissions: whatsapp_business_messaging, whatsapp_business_management");
    const accessToken = await prompt.password("Enter your Meta API access token");
    if (!accessToken) {
        throw new Error("Access Token is required. Create a System User token in Meta Business Settings.");
    }
    // ----- Step 4: App Secret -----
    logger.info("Step 4/6: App Secret (for webhook security)");
    console.log("  💡 Find it in: Meta Developers → Your App → App Settings → Basic → App Secret\n" +
        "     This is used to verify that webhook requests are really from Meta.");
    const appSecret = await prompt.password("Enter your Meta App Secret (strongly recommended for production)");
    if (!appSecret) {
        console.log("  ⚠️  No App Secret provided. Webhook signature verification will be DISABLED.\n" +
            "     This is OK for development but NOT safe for production.");
    }
    // ----- Step 5: Verify Token -----
    logger.info("Step 5/6: Webhook Verify Token");
    const defaultVerifyToken = "openclaw-wa-" + Math.random().toString(36).slice(2, 10);
    console.log("  💡 This is a random string YOU choose. You'll enter the same string\n" +
        "     in Meta's webhook configuration to prove you own the endpoint.");
    const verifyToken = await prompt.input("Choose a webhook verify token", { default: defaultVerifyToken });
    // ----- Step 6: Webhook Port -----
    logger.info("Step 6/6: Webhook Port");
    const portStr = await prompt.input("Which port should the webhook server listen on?", { default: "3100" });
    const webhookPort = parseInt(portStr, 10) || 3100;
    // ----- Summary -----
    console.log("\n" + "═".repeat(60));
    console.log("  Configuration summary:");
    console.log("═".repeat(60));
    console.log(`  Phone Number ID:    ${phoneNumberId}`);
    console.log(`  Business Acct ID:   ${businessAccountId || "(not set)"}`);
    console.log(`  Access Token:       ${accessToken.slice(0, 8)}...${accessToken.slice(-4)}`);
    console.log(`  App Secret:         ${appSecret ? appSecret.slice(0, 4) + "..." : "(not set — ⚠️ insecure)"}`);
    console.log(`  Verify Token:       ${verifyToken}`);
    console.log(`  Webhook Port:       ${webhookPort}`);
    console.log(`  Webhook Path:       /webhook/whatsapp-cloud`);
    console.log("═".repeat(60));
    // Ask for webhook base URL
    logger.info("Webhook URL (optional)");
    console.log("  💡 If you already have ngrok running or a public domain, enter the base URL.\n" +
        "     Otherwise press Enter to skip — you can configure it later.");
    const webhookBaseUrl = await prompt.input("Public HTTPS base URL (e.g. https://xxxx.ngrok-free.app)", { default: "" });
    const trimmedBaseUrl = webhookBaseUrl.trim().replace(/\/+$/, "");
    if (trimmedBaseUrl && trimmedBaseUrl.startsWith("https://")) {
        const callbackUrl = `${trimmedBaseUrl}/webhook/whatsapp-cloud`;
        console.log("\n📋 Copy-paste these into Meta → WhatsApp → Configuration → Webhook → Edit:");
        console.log("═".repeat(60));
        console.log(`  Callback URL:  ${callbackUrl}`);
        console.log(`  Verify Token:  ${verifyToken}`);
        console.log("═".repeat(60));
        console.log("  Then click \"Verify and Save\" and subscribe to: messages");
    }
    else {
        console.log("\n📋 Next steps after saving config:");
        console.log("  1. Expose port " + webhookPort + " over HTTPS:");
        console.log("     • Dev:  ngrok http " + webhookPort);
        console.log("     • Prod: cloudflared tunnel --url http://localhost:" + webhookPort);
        console.log("  2. Register the webhook in Meta dashboard:");
        console.log("     • URL: https://<your-domain>/webhook/whatsapp-cloud");
        console.log("     • Verify Token: " + verifyToken);
        console.log("     • Subscribe to: messages");
    }
    console.log("  3. Restart the gateway: openclaw gateway restart");
    console.log("  4. Send a WhatsApp message to your business number!");
    return {
        phoneNumberId,
        businessAccountId,
        accessToken,
        appSecret,
        verifyToken,
        webhookPort,
        webhookPath: CONFIG_DEFAULTS.webhookPath,
        dmPolicy: "open",
    };
}
/**
 * Validate an existing config and report what's missing.
 */
export function validateConfig(config) {
    const errors = [];
    const warnings = [];
    if (!config.phoneNumberId) {
        errors.push("phoneNumberId is required (from Meta → WhatsApp → API Setup)");
    }
    if (!config.accessToken) {
        errors.push("accessToken is required (System User token from Meta Business Settings)");
    }
    if (!config.appSecret) {
        warnings.push("appSecret is not set — webhook signature verification is DISABLED (unsafe for production)");
    }
    if (!config.verifyToken) {
        warnings.push("verifyToken is not set — using default (change this for security)");
    }
    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}
