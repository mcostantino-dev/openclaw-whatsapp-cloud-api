// ---------------------------------------------------------------------------
// OpenClaw Channel Plugin — WhatsApp Cloud API
//
// Uses Meta's official WhatsApp Cloud API (graph.facebook.com) instead of
// Baileys. Production-safe for business use: no ban risk, verified numbers,
// template messages, and full compliance with Meta's policies.
//
// Author: Baia Digitale SRL (baiadigitale.com)
// License: MIT
// ---------------------------------------------------------------------------

import type { Server } from "node:http";
import { sendText, sendMedia, sendTypingIndicator } from "./api.js";
import { startWebhookServer } from "./webhook.js";
import { runSetupWizard, validateConfig } from "./setup.js";
import { whatsappCloudOnboardingAdapter } from "./onboarding.js";
import type { WhatsAppCloudConfig, Logger } from "./types.js";
import { CONFIG_DEFAULTS } from "./types.js";
import { setWhatsAppCloudRuntime, getWhatsAppCloudRuntime } from "./runtime.js";

// ---------------------------------------------------------------------------
// Account resolution types
// ---------------------------------------------------------------------------

interface ResolvedWhatsAppCloudAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  config: WhatsAppCloudConfig;
  /** Where the token came from: "config" or "none" */
  tokenSource: string;
}

// Runtime state
let webhookServer: Server | null = null;

// Default account ID constant (matches OpenClaw convention)
const DEFAULT_ACCOUNT_ID = "default";

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

function resolveConfig(cfg: any): WhatsAppCloudConfig {
  const raw = cfg?.channels?.["whatsapp-cloud"] ?? cfg ?? {};
  return {
    enabled: raw.enabled ?? CONFIG_DEFAULTS.enabled ?? true,
    phoneNumberId: String(raw.phoneNumberId ?? ""),
    businessAccountId: String(raw.businessAccountId ?? ""),
    accessToken: String(raw.accessToken ?? ""),
    appSecret: String(raw.appSecret ?? ""),
    verifyToken: String(raw.verifyToken ?? CONFIG_DEFAULTS.verifyToken!),
    webhookPort: Number(raw.webhookPort ?? CONFIG_DEFAULTS.webhookPort!),
    webhookPath: String(raw.webhookPath ?? CONFIG_DEFAULTS.webhookPath!),
    apiVersion: String(raw.apiVersion ?? CONFIG_DEFAULTS.apiVersion!),
    dmPolicy: raw.dmPolicy ?? CONFIG_DEFAULTS.dmPolicy!,
    allowFrom: raw.allowFrom ?? CONFIG_DEFAULTS.allowFrom!,
    sendReadReceipts: raw.sendReadReceipts ?? CONFIG_DEFAULTS.sendReadReceipts!,
  };
}

function resolveAccount(cfg: any, accountId?: string | null): ResolvedWhatsAppCloudAccount {
  const channelCfg = cfg?.channels?.["whatsapp-cloud"] ?? {};
  const config = resolveConfig(cfg);
  return {
    accountId: accountId ?? DEFAULT_ACCOUNT_ID,
    name: channelCfg.name,
    enabled: config.enabled,
    config,
    tokenSource: config.accessToken ? "config" : "none",
  };
}

// ---------------------------------------------------------------------------
// Channel plugin definition
// Follows the ChannelPlugin<ResolvedAccount> interface from OpenClaw SDK
// ---------------------------------------------------------------------------

const whatsappCloudChannel = {
  id: "whatsapp-cloud" as string,

  meta: {
    id: "whatsapp-cloud" as string,
    label: "WhatsApp Cloud API",
    selectionLabel: "WhatsApp (Meta Cloud API)",
    docsPath: "/channels/whatsapp-cloud",
    docsLabel: "whatsapp-cloud",
    blurb:
      "WhatsApp via Meta's official Cloud API. Production-safe for business — no Baileys, no ban risk.",
    aliases: ["wa-cloud", "whatsapp-business", "wa-business"],
    preferOver: ["whatsapp"],
    quickstartAllowFrom: true,
  },

  onboarding: whatsappCloudOnboardingAdapter,

  capabilities: {
    chatTypes: ["direct"] as Array<"direct">,
    media: true,
    blockStreaming: true,
  },

  reload: { configPrefixes: ["channels.whatsapp-cloud"] },

  // ---- Config adapter ----
  config: {
    listAccountIds: (cfg: any): string[] =>
      cfg?.channels?.["whatsapp-cloud"]?.enabled !== false ? [DEFAULT_ACCOUNT_ID] : [],

    resolveAccount: (cfg: any, accountId?: string | null): ResolvedWhatsAppCloudAccount =>
      resolveAccount(cfg, accountId),

    defaultAccountId: (_cfg: any): string => DEFAULT_ACCOUNT_ID,

    setAccountEnabled: ({ cfg, accountId, enabled }: { cfg: any; accountId: string; enabled: boolean }): any => ({
      ...cfg,
      channels: {
        ...cfg.channels,
        "whatsapp-cloud": {
          ...cfg.channels?.["whatsapp-cloud"],
          enabled,
        },
      },
    }),

    deleteAccount: ({ cfg, accountId }: { cfg: any; accountId: string }): any => {
      const next = { ...cfg };
      const nextChannels = { ...next.channels };
      delete nextChannels["whatsapp-cloud"];
      if (Object.keys(nextChannels).length > 0) {
        next.channels = nextChannels;
      } else {
        delete next.channels;
      }
      return next;
    },

    isConfigured: (account: ResolvedWhatsAppCloudAccount): boolean =>
      Boolean(account.config.accessToken?.trim() && account.config.phoneNumberId?.trim()),

    describeAccount: (account: ResolvedWhatsAppCloudAccount) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.config.accessToken?.trim() && account.config.phoneNumberId?.trim()),
      tokenSource: account.tokenSource,
    }),

    resolveAllowFrom: ({ cfg }: { cfg: any; accountId?: string | null }) =>
      (cfg?.channels?.["whatsapp-cloud"]?.allowFrom ?? []).map((entry: any) => String(entry)),

    formatAllowFrom: ({ allowFrom }: { cfg: any; accountId?: string | null; allowFrom: Array<string | number> }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.replace(/[^0-9+]/g, "")),
  },

  // ---- Security adapter ----
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }: { cfg: any; accountId?: string | null; account: ResolvedWhatsAppCloudAccount }) => ({
      policy: account.config.dmPolicy ?? "open",
      allowFrom: account.config.allowFrom ?? [],
      policyPath: "channels.whatsapp-cloud.dmPolicy",
      allowFromPath: "channels.whatsapp-cloud.",
      approveHint: "openclaw pairing approve whatsapp-cloud <code>",
      normalizeEntry: (raw: string) => raw.replace(/[^0-9]/g, ""),
    }),
  },

  // ---- Pairing ----
  pairing: {
    idLabel: "whatsappPhoneNumber",
    normalizeAllowEntry: (entry: string) => entry.replace(/[^0-9]/g, ""),
    notifyApproval: async ({ cfg, id }: { cfg: any; id: string }) => {
      const config = resolveConfig(cfg);
      if (!config.accessToken) {
        throw new Error("WhatsApp Cloud access token not configured");
      }
      const log: Logger = console as unknown as Logger;
      await sendText(config, id, "OpenClaw: your access has been approved.", log);
    },
  },

  // ---- Setup adapter (for `openclaw channels login whatsapp-cloud`) ----
  setup: {
    resolveAccountId: ({ accountId }: { cfg: any; accountId?: string }) =>
      accountId ?? DEFAULT_ACCOUNT_ID,

    validateInput: ({ accountId, input }: { cfg: any; accountId: string; input: any }) => {
      if (!input.accessToken && !input.token) {
        return "WhatsApp Cloud API requires an access token. Use --token <access-token>.";
      }
      return null;
    },

    applyAccountConfig: ({ cfg, accountId, input }: { cfg: any; accountId: string; input: any }) => ({
      ...cfg,
      channels: {
        ...cfg.channels,
        "whatsapp-cloud": {
          ...cfg.channels?.["whatsapp-cloud"],
          enabled: true,
          ...(input.name ? { name: input.name } : {}),
          ...(input.accessToken ? { accessToken: input.accessToken } : {}),
          ...(input.token ? { accessToken: input.token } : {}),
          ...(input.webhookPath ? { webhookPath: input.webhookPath } : {}),
          ...(input.webhookUrl ? { webhookUrl: input.webhookUrl } : {}),
        },
      },
    }),
  },

  // ---- Outbound adapter ----
  outbound: {
    deliveryMode: "direct" as const,
    textChunkLimit: 4096,

    sendText: async ({ cfg, to, text, accountId }: {
      cfg: any;
      to: string;
      text: string;
      mediaUrl?: string;
      replyToId?: string | null;
      threadId?: string | number | null;
      accountId?: string | null;
      deps?: any;
      silent?: boolean;
    }) => {
      const config = resolveConfig(cfg);
      const log: Logger = getWhatsAppCloudRuntime()?.logging?.getChildLogger?.({ channel: "whatsapp-cloud" }) ?? console as unknown as Logger;

      if (!config.accessToken || !config.phoneNumberId) {
        throw new Error("WhatsApp Cloud API not configured: missing accessToken or phoneNumberId");
      }

      const result = await sendText(config, to, text, log);

      if (!result.ok) {
        throw new Error(`WhatsApp Cloud API send failed: ${result.error}`);
      }

      return {
        channel: "whatsapp-cloud" as any,
        messageId: result.messageId ?? "unknown",
        chatId: to,
      };
    },

    sendMedia: async ({ cfg, to, text, mediaUrl, accountId }: {
      cfg: any;
      to: string;
      text: string;
      mediaUrl?: string;
      accountId?: string | null;
    }) => {
      const config = resolveConfig(cfg);
      const log: Logger = getWhatsAppCloudRuntime()?.logging?.getChildLogger?.({ channel: "whatsapp-cloud" }) ?? console as unknown as Logger;

      if (!config.accessToken || !config.phoneNumberId) {
        throw new Error("WhatsApp Cloud API not configured: missing accessToken or phoneNumberId");
      }

      if (mediaUrl) {
        const result = await sendMedia(config, to, "image", { link: mediaUrl, caption: text || undefined }, log);
        if (!result.ok) {
          throw new Error(`WhatsApp Cloud API media send failed: ${result.error}`);
        }
        return {
          channel: "whatsapp-cloud" as any,
          messageId: result.messageId ?? "unknown",
          chatId: to,
        };
      }

      // Fallback to text if no media URL
      const result = await sendText(config, to, text, log);
      if (!result.ok) {
        throw new Error(`WhatsApp Cloud API send failed: ${result.error}`);
      }
      return {
        channel: "whatsapp-cloud" as any,
        messageId: result.messageId ?? "unknown",
        chatId: to,
      };
    },
  },

  // ---- Gateway lifecycle ----
  gateway: {
    startAccount: async (ctx: any) => {
      const account: ResolvedWhatsAppCloudAccount = ctx.account;
      const config = account.config;
      const log: Logger = ctx.log ?? console as unknown as Logger;
      const runtime = getWhatsAppCloudRuntime();

      if (!config.enabled) {
        log.info?.("[whatsapp-cloud] Channel is disabled");
        return;
      }

      // Validate config
      const validation = validateConfig(config);
      if (!validation.valid) {
        for (const err of validation.errors) {
          log.error(`[whatsapp-cloud] Config error: ${err}`);
        }
        log.error("[whatsapp-cloud] Run 'openclaw channels login whatsapp-cloud' to configure");
        return;
      }
      for (const warn of validation.warnings) {
        log.warn(`[whatsapp-cloud] ${warn}`);
      }

      // Start the webhook HTTP server
      webhookServer = startWebhookServer(
        config,
        // Inbound message handler — dispatch into OpenClaw agent session
        async (message) => {
          try {
            // Show typing indicator immediately (auto-dismissed on reply or after 25s)
            sendTypingIndicator(config, message.messageId, log).catch(() => {});

            // Load fresh config for dispatch
            const freshCfg = await runtime.config.loadConfig();

            // Build MsgContext (OpenClaw's standard inbound message format)
            const msgCtx: Record<string, any> = {
              Body: message.text,
              RawBody: message.text,
              CommandBody: message.text,
              BodyForCommands: message.text,
              From: message.from,
              To: config.phoneNumberId,
              SessionKey: `whatsapp-cloud:${message.from}`,
              AccountId: account.accountId,
              MessageSid: message.messageId,
              ChatType: "direct",
              SenderName: message.senderName,
              SenderId: message.from,
              Provider: "whatsapp-cloud",
              OriginatingChannel: "whatsapp-cloud",
              OriginatingTo: message.from,
              Timestamp: parseInt(message.timestamp, 10) * 1000,
            };

            if (message.quotedMessageId) {
              msgCtx.ReplyToId = message.quotedMessageId;
            }

            // Dispatch via OpenClaw's reply system
            await runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
              ctx: msgCtx,
              cfg: freshCfg,
              dispatcherOptions: {
                deliver: async (payload: any) => {
                  if (payload.text) {
                    await sendText(config, message.from, payload.text, log);
                  }
                  if (payload.mediaUrl) {
                    await sendMedia(config, message.from, "image", { link: payload.mediaUrl }, log);
                  }
                  if (payload.mediaUrls?.length) {
                    for (const url of payload.mediaUrls) {
                      await sendMedia(config, message.from, "image", { link: url }, log);
                    }
                  }
                },
                onReplyStart: () => {
                  log.info?.(`[whatsapp-cloud] Generating reply for ${message.senderName} (${message.from})`);
                },
              },
            });
          } catch (err) {
            log.error(`[whatsapp-cloud] Failed to dispatch inbound message: ${err}`);
          }
        },
        // Status update handler
        (messageId, status, recipientId) => {
          log.debug?.(`[whatsapp-cloud] Status: ${status} for message ${messageId} to ${recipientId}`);
        },
        log
      );

      log.info("[whatsapp-cloud] Channel started");
      log.info(`[whatsapp-cloud]   Webhook: http://localhost:${config.webhookPort}${config.webhookPath}`);
      log.info(`[whatsapp-cloud]   DM Policy: ${config.dmPolicy}`);
      if (config.dmPolicy === "allowlist") {
        log.info(`[whatsapp-cloud]   Allowed: ${config.allowFrom.join(", ") || "(none)"}`);
      }

      // Update runtime status
      if (typeof ctx.setStatus === "function") {
        ctx.setStatus({
          accountId: account.accountId,
          running: true,
          lastStartAt: Date.now(),
          mode: "webhook",
        });
      }
    },

    logoutAccount: async ({ accountId, cfg }: { accountId: string; cfg: any }) => {
      // Stop webhook if running
      if (webhookServer) {
        webhookServer.close();
        webhookServer = null;
      }

      // Clear credentials from config
      const nextCfg = { ...cfg };
      const waCloudCfg = cfg.channels?.["whatsapp-cloud"];
      if (waCloudCfg) {
        const { accessToken, appSecret, ...rest } = waCloudCfg;
        nextCfg.channels = {
          ...nextCfg.channels,
          "whatsapp-cloud": rest,
        };

        await getWhatsAppCloudRuntime().config.writeConfigFile(nextCfg);
      }

      return {
        cleared: Boolean(waCloudCfg?.accessToken),
        loggedOut: true,
      };
    },
  },

  // ---- Status adapter ----
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },

    collectStatusIssues: (accounts: any[]) => {
      const issues: any[] = [];
      for (const account of accounts) {
        const aid = account.accountId ?? DEFAULT_ACCOUNT_ID;
        if (!account.config?.accessToken?.trim()) {
          issues.push({
            channel: "whatsapp-cloud",
            accountId: aid,
            kind: "config",
            message: "WhatsApp Cloud API access token not configured",
          });
        }
        if (!account.config?.phoneNumberId?.trim()) {
          issues.push({
            channel: "whatsapp-cloud",
            accountId: aid,
            kind: "config",
            message: "WhatsApp Cloud API phone number ID not configured",
          });
        }
      }
      return issues;
    },

    buildAccountSnapshot: ({ account, runtime }: { account: ResolvedWhatsAppCloudAccount; cfg: any; runtime?: any }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.config.accessToken?.trim() && account.config.phoneNumberId?.trim()),
      tokenSource: account.tokenSource,
      running: runtime?.running ?? (webhookServer?.listening ?? false),
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      mode: "webhook",
    }),
  },
};

// ---------------------------------------------------------------------------
// Plugin definition (OpenClawPluginDefinition)
// ---------------------------------------------------------------------------

const plugin = {
  id: "openclaw-whatsapp-cloud-api",
  name: "WhatsApp Cloud API",
  description: "WhatsApp Cloud API channel plugin — official Meta Business API, no Baileys",

  register(api: any) {
    const log: Logger = api.logger ?? (console as unknown as Logger);
    log.info("[whatsapp-cloud] Loading WhatsApp Cloud API channel plugin");

    // Store runtime reference for dispatch and config access
    setWhatsAppCloudRuntime(api.runtime);

    // Register the channel
    api.registerChannel({ plugin: whatsappCloudChannel });

    // Register CLI commands: `openclaw whatsapp-cloud setup|status|test`
    if (typeof api.registerCli === "function") {
      api.registerCli(
        ({ program }: any) => {
          const cmd = program
            .command("whatsapp-cloud")
            .description("WhatsApp Cloud API channel management");

          cmd
            .command("setup")
            .description("Interactive setup wizard for WhatsApp Cloud API credentials")
            .action(async () => {
              try {
                const result = await runSetupWizard(undefined, log);

                // Save via runtime config
                try {
                  const runtime = getWhatsAppCloudRuntime();
                  const currentCfg = await runtime.config.loadConfig();
                  const nextCfg = {
                    ...currentCfg,
                    channels: {
                      ...currentCfg.channels,
                      "whatsapp-cloud": {
                        ...currentCfg.channels?.["whatsapp-cloud"],
                        enabled: true,
                        phoneNumberId: result.phoneNumberId,
                        ...(result.businessAccountId ? { businessAccountId: result.businessAccountId } : {}),
                        accessToken: result.accessToken,
                        ...(result.appSecret ? { appSecret: result.appSecret } : {}),
                        verifyToken: result.verifyToken,
                        webhookPort: result.webhookPort,
                        webhookPath: result.webhookPath,
                        dmPolicy: result.dmPolicy,
                      },
                    },
                  };
                  await runtime.config.writeConfigFile(nextCfg);
                  log.info("[whatsapp-cloud] Configuration saved to openclaw.json");
                  console.log("\n  Then: openclaw gateway restart\n");
                } catch {
                  // Fallback: print commands for manual config
                  console.log("\nRun these commands to save your config:\n");
                  console.log(`  openclaw config set channels.whatsapp-cloud.enabled true`);
                  console.log(`  openclaw config set channels.whatsapp-cloud.phoneNumberId "${result.phoneNumberId}"`);
                  console.log(`  openclaw config set channels.whatsapp-cloud.accessToken "${result.accessToken}"`);
                  if (result.appSecret) {
                    console.log(`  openclaw config set channels.whatsapp-cloud.appSecret "${result.appSecret}"`);
                  }
                  console.log(`  openclaw config set channels.whatsapp-cloud.verifyToken "${result.verifyToken}"`);
                  console.log(`  openclaw config set channels.whatsapp-cloud.webhookPort ${result.webhookPort}`);
                  console.log(`\n  Then: openclaw gateway restart\n`);
                }
              } catch (err) {
                log.error(`Setup failed: ${err}`);
                process.exit(1);
              }
            });

          cmd
            .command("status")
            .description("Check WhatsApp Cloud API channel health")
            .action(async () => {
              const isRunning = webhookServer !== null && webhookServer.listening;
              console.log(`WhatsApp Cloud API: ${isRunning ? "OK" : "Not running"}`);
              console.log(`  Webhook server: ${isRunning ? "running" : "not running"}`);

              try {
                const runtime = getWhatsAppCloudRuntime();
                const cfg = await runtime.config.loadConfig();
                const config = resolveConfig(cfg);
                const validation = validateConfig(config);
                if (!validation.valid) {
                  for (const err of validation.errors) {
                    console.log(`  Config error: ${err}`);
                  }
                }
                for (const warn of validation.warnings) {
                  console.log(`  Warning: ${warn}`);
                }
              } catch {
                console.log("  (could not load config)");
              }
            });

          cmd
            .command("test")
            .description("Send a test message to verify configuration")
            .argument("<phone>", "Recipient phone in E.164 format (e.g., +393491234567)")
            .action(async (phone: string) => {
              try {
                const runtime = getWhatsAppCloudRuntime();
                const cfg = await runtime.config.loadConfig();
                const config = resolveConfig(cfg);

                if (!config.accessToken || !config.phoneNumberId) {
                  log.error("Missing config. Run 'openclaw whatsapp-cloud setup' first.");
                  process.exit(1);
                }

                const result = await sendText(
                  config,
                  phone.replace("+", ""),
                  "Hello from OpenClaw! Your WhatsApp Cloud API channel is working.",
                  log
                );

                if (result.ok) {
                  console.log(`Test message sent to ${phone} (ID: ${result.messageId})`);
                } else {
                  console.log(`Failed: ${result.error}`);
                  process.exit(1);
                }
              } catch (err) {
                log.error(`Test failed: ${err}`);
                process.exit(1);
              }
            });
        },
        { commands: ["whatsapp-cloud"] }
      );
    }

    log.info("[whatsapp-cloud] Plugin registered");
  },
};

export default plugin;

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { sendText, sendTemplate, sendInteractive, sendButtons, sendMedia } from "./api.js";
export { markAsRead, sendTypingIndicator, getMediaUrl, downloadMedia } from "./api.js";
export { runSetupWizard, validateConfig } from "./setup.js";
export type { WhatsAppCloudConfig } from "./types.js";
export type { ParsedInboundMessage, ParsedInboundMessage as InboundMessage } from "./webhook.js";
export { whatsappCloudOnboardingAdapter } from "./onboarding.js";
