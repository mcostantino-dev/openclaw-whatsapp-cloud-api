// ---------------------------------------------------------------------------
// Onboarding Adapter — ChannelOnboardingAdapter for WhatsApp Cloud API
//
// Implements the standard OpenClaw onboarding flow so that running
//   openclaw channels login whatsapp-cloud
// interactively collects all credentials and saves them to openclaw.json.
// ---------------------------------------------------------------------------

import type { WhatsAppCloudConfig } from "./types.js";
import { CONFIG_DEFAULTS } from "./types.js";

// ---------------------------------------------------------------------------
// Inline types matching OpenClaw SDK (no direct dependency)
// ---------------------------------------------------------------------------

interface WizardPrompter {
  intro: (title: string) => Promise<void>;
  outro: (message: string) => Promise<void>;
  note: (message: string, title?: string) => Promise<void>;
  select: <T>(params: { message: string; options: Array<{ value: T; label: string; hint?: string }>; initialValue?: T }) => Promise<T>;
  text: (params: { message: string; initialValue?: string; placeholder?: string; validate?: (value: string) => string | undefined }) => Promise<string>;
  confirm: (params: { message: string; initialValue?: boolean }) => Promise<boolean>;
  progress: (label: string) => { update: (message: string) => void; stop: (message?: string) => void };
}

type DmPolicy = "pairing" | "allowlist" | "open" | "disabled";

interface OnboardingStatusContext {
  cfg: any;
  options?: any;
  accountOverrides: Partial<Record<string, string>>;
}

interface OnboardingConfigureContext {
  cfg: any;
  runtime: any;
  prompter: WizardPrompter;
  options?: any;
  accountOverrides: Partial<Record<string, string>>;
  shouldPromptAccountIds: boolean;
  forceAllowFrom: boolean;
}

interface OnboardingResult {
  cfg: any;
  accountId?: string;
}

interface OnboardingDmPolicy {
  label: string;
  channel: string;
  policyKey: string;
  allowFromKey: string;
  getCurrent: (cfg: any) => DmPolicy;
  setPolicy: (cfg: any, policy: DmPolicy) => any;
  promptAllowFrom?: (params: { cfg: any; prompter: WizardPrompter; accountId?: string }) => Promise<any>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CHANNEL_KEY = "whatsapp-cloud";
const DEFAULT_ACCOUNT_ID = "default";

function applyAccountConfig(cfg: any, patch: Record<string, unknown>): any {
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      [CHANNEL_KEY]: {
        ...cfg.channels?.[CHANNEL_KEY],
        enabled: true,
        ...patch,
      },
    },
  };
}

function resolveCurrentConfig(cfg: any): Partial<WhatsAppCloudConfig> {
  return cfg?.channels?.[CHANNEL_KEY] ?? {};
}

function isConfigured(cfg: any): boolean {
  const c = resolveCurrentConfig(cfg);
  return Boolean(c.accessToken && c.phoneNumberId);
}

function parseAllowFromInput(raw: string): string[] {
  return raw
    .split(/[\n,;]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/[^0-9+]/g, ""));
}

// ---------------------------------------------------------------------------
// DM Policy adapter
// ---------------------------------------------------------------------------

function setWhatsAppDmPolicy(cfg: any, policy: DmPolicy): any {
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      [CHANNEL_KEY]: {
        ...cfg.channels?.[CHANNEL_KEY],
        dmPolicy: policy,
      },
    },
  };
}

async function promptAllowFrom(params: {
  cfg: any;
  prompter: WizardPrompter;
}): Promise<any> {
  const current: string[] = params.cfg.channels?.[CHANNEL_KEY]?.allowFrom ?? [];
  const entry = await params.prompter.text({
    message: "Allowed phone numbers (E.164 format, comma-separated)",
    placeholder: "+393491234567, +14155551234",
    initialValue: current.length > 0 ? current.join(", ") : undefined,
    validate: (value) => (String(value ?? "").trim() ? undefined : "At least one number is required"),
  });
  const parts = parseAllowFromInput(String(entry));
  const unique = [...new Set(parts)];
  return {
    ...params.cfg,
    channels: {
      ...params.cfg.channels,
      [CHANNEL_KEY]: {
        ...params.cfg.channels?.[CHANNEL_KEY],
        enabled: true,
        dmPolicy: "allowlist",
        allowFrom: unique,
      },
    },
  };
}

const dmPolicy: OnboardingDmPolicy = {
  label: "WhatsApp Cloud API",
  channel: CHANNEL_KEY,
  policyKey: `channels.${CHANNEL_KEY}.dmPolicy`,
  allowFromKey: `channels.${CHANNEL_KEY}.allowFrom`,
  getCurrent: (cfg) => cfg.channels?.[CHANNEL_KEY]?.dmPolicy ?? "open",
  setPolicy: (cfg, policy) => setWhatsAppDmPolicy(cfg, policy),
  promptAllowFrom,
};

// ---------------------------------------------------------------------------
// Interactive credential prompting
// ---------------------------------------------------------------------------

async function promptCredentials(params: {
  cfg: any;
  prompter: WizardPrompter;
}): Promise<any> {
  const { cfg, prompter } = params;
  const current = resolveCurrentConfig(cfg);

  await prompter.note(
    [
      "You need credentials from the Meta Business dashboard:",
      "https://developers.facebook.com/",
      "",
      "1. Create an app → Add WhatsApp product",
      "2. Go to WhatsApp → API Setup for Phone Number ID",
      "3. Create a System User for a permanent access token",
      "4. Note your App Secret from App Settings → Basic",
    ].join("\n"),
    "WhatsApp Cloud API — What you'll need",
  );

  // --- Phone Number ID ---
  const phoneNumberId = await prompter.text({
    message: "Phone Number ID (from Meta → WhatsApp → API Setup)",
    placeholder: "123456789012345",
    initialValue: current.phoneNumberId ? String(current.phoneNumberId) : undefined,
    validate: (v) => (String(v ?? "").trim() ? undefined : "Phone Number ID is required"),
  });

  // --- Business Account ID (optional) ---
  const businessAccountId = await prompter.text({
    message: "Business Account ID (optional, press Enter to skip)",
    placeholder: "123456789012345",
    initialValue: current.businessAccountId ? String(current.businessAccountId) : undefined,
  });

  // --- Access Token ---
  await prompter.note(
    [
      "Use a System User token for permanent access (won't expire).",
      "Create one in: Business Settings → System Users → Generate Token",
      "Required permissions: whatsapp_business_messaging, whatsapp_business_management",
    ].join("\n"),
    "Access Token",
  );

  const accessToken = await prompter.text({
    message: "Meta API access token",
    placeholder: "EAAx...",
    initialValue: current.accessToken ? String(current.accessToken) : undefined,
    validate: (v) => (String(v ?? "").trim() ? undefined : "Access token is required"),
  });

  // --- App Secret ---
  await prompter.note(
    [
      "Find it in: Meta Developers → Your App → App Settings → Basic → App Secret",
      "Used to verify that webhook requests are really from Meta.",
      "Strongly recommended for production.",
    ].join("\n"),
    "App Secret",
  );

  const appSecret = await prompter.text({
    message: "Meta App Secret (recommended, press Enter to skip)",
    placeholder: "abc123def456...",
    initialValue: current.appSecret ? String(current.appSecret) : undefined,
  });

  // --- Verify Token ---
  const defaultVerifyToken = current.verifyToken
    ? String(current.verifyToken)
    : "openclaw-wa-" + Math.random().toString(36).slice(2, 10);

  const verifyToken = await prompter.text({
    message: "Webhook verify token (random string you choose)",
    placeholder: defaultVerifyToken,
    initialValue: defaultVerifyToken,
  });

  // --- Webhook Port ---
  const currentPort = current.webhookPort ?? CONFIG_DEFAULTS.webhookPort ?? 3100;
  const portStr = await prompter.text({
    message: "Webhook server port",
    placeholder: String(currentPort),
    initialValue: String(currentPort),
    validate: (v) => {
      const n = parseInt(String(v), 10);
      return n > 0 && n < 65536 ? undefined : "Must be a valid port (1-65535)";
    },
  });
  const webhookPort = parseInt(portStr, 10) || 3100;

  // Apply all fields
  return applyAccountConfig(cfg, {
    phoneNumberId: String(phoneNumberId).trim(),
    ...(String(businessAccountId).trim() ? { businessAccountId: String(businessAccountId).trim() } : {}),
    accessToken: String(accessToken).trim(),
    ...(String(appSecret).trim() ? { appSecret: String(appSecret).trim() } : {}),
    verifyToken: String(verifyToken).trim() || defaultVerifyToken,
    webhookPort,
    webhookPath: CONFIG_DEFAULTS.webhookPath!,
  });
}

// ---------------------------------------------------------------------------
// Webhook URL prompting + Meta dashboard instructions
// ---------------------------------------------------------------------------

async function promptWebhookUrl(params: {
  prompter: WizardPrompter;
  verifyToken: string;
  webhookPort: number;
}): Promise<void> {
  const { prompter, verifyToken, webhookPort } = params;
  const webhookPath = CONFIG_DEFAULTS.webhookPath!;

  const baseUrl = await prompter.text({
    message: "Your public HTTPS base URL (ngrok, Cloudflare, or your domain)",
    placeholder: `https://xxxx.ngrok-free.app`,
    validate: (v) => {
      const val = String(v ?? "").trim();
      if (!val) return undefined; // allow skip
      if (!val.startsWith("https://")) return "Must start with https://";
      return undefined;
    },
  });

  const trimmedUrl = String(baseUrl).trim().replace(/\/+$/, "");

  if (trimmedUrl && trimmedUrl.startsWith("https://")) {
    const callbackUrl = `${trimmedUrl}${webhookPath}`;
    await prompter.note(
      [
        "Copy-paste these into Meta Developers → Your App →",
        "WhatsApp → Configuration → Webhook → Edit:",
        "",
        `  Callback URL:  ${callbackUrl}`,
        `  Verify Token:  ${verifyToken}`,
        "",
        "Then click \"Verify and Save\" and subscribe to: messages",
      ].join("\n"),
      "Webhook — ready to paste in Meta",
    );
  } else {
    await prompter.note(
      [
        "Configure the webhook in Meta's dashboard:",
        "",
        "1. Go to: Meta Developers → Your App → WhatsApp → Configuration",
        "2. Under Webhook, click Edit",
        `3. Callback URL: https://<your-domain>${webhookPath}`,
        `4. Verify Token: ${verifyToken}`,
        "5. Click \"Verify and Save\"",
        "6. Subscribe to field: messages",
        "",
        "For local development, expose the port first:",
        `  ngrok http ${webhookPort}`,
        "",
        "For production, use a reverse proxy (Caddy, nginx) to",
        `forward HTTPS traffic to http://localhost:${webhookPort}`,
      ].join("\n"),
      "Webhook Configuration (required)",
    );
  }
}

// ---------------------------------------------------------------------------
// Exported onboarding adapter
// ---------------------------------------------------------------------------

export const whatsappCloudOnboardingAdapter = {
  channel: CHANNEL_KEY as string,
  dmPolicy,

  getStatus: async ({ cfg }: OnboardingStatusContext) => {
    const configured = isConfigured(cfg);
    return {
      channel: CHANNEL_KEY as string,
      configured,
      statusLines: [
        `WhatsApp Cloud API: ${configured ? "configured" : "needs credentials"}`,
      ],
      selectionHint: configured ? "configured" : "needs auth",
    };
  },

  configure: async ({ cfg, prompter }: OnboardingConfigureContext): Promise<OnboardingResult> => {
    await prompter.intro("WhatsApp Cloud API Setup");

    let next = await promptCredentials({ cfg, prompter });

    // Extract saved values for the webhook instructions
    const saved = next.channels?.[CHANNEL_KEY] ?? {};
    const verifyToken = saved.verifyToken || "openclaw-wa-verify";
    const webhookPort = saved.webhookPort || 3100;

    await promptWebhookUrl({ prompter, verifyToken, webhookPort });

    if (!String(saved.appSecret ?? "").trim()) {
      await prompter.note(
        "Webhook signature verification is DISABLED without an App Secret.\nThis is acceptable for development but NOT safe for production.",
        "Security warning",
      );
    }

    await prompter.outro(
      "Configuration saved! Restart the gateway: openclaw gateway restart",
    );

    return { cfg: next, accountId: DEFAULT_ACCOUNT_ID };
  },

  disable: (cfg: any) => {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        [CHANNEL_KEY]: {
          ...cfg.channels?.[CHANNEL_KEY],
          enabled: false,
        },
      },
    };
  },
};
