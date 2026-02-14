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
import { sendText } from "./api.js";
import { startWebhookServer } from "./webhook.js";
import { runSetupWizard, validateConfig } from "./setup.js";
import type { WhatsAppCloudConfig, Logger } from "./types.js";
import { CONFIG_DEFAULTS } from "./types.js";

// Runtime state
let webhookServer: Server | null = null;

// ---------------------------------------------------------------------------
// Channel definition (follows OpenClaw channel plugin contract)
// ---------------------------------------------------------------------------

const whatsappCloudChannel = {
  id: "whatsapp-cloud",

  meta: {
    id: "whatsapp-cloud",
    label: "WhatsApp Cloud API",
    selectionLabel: "WhatsApp (Meta Cloud API)",
    docsPath: "/channels/whatsapp-cloud",
    blurb:
      "WhatsApp via Meta's official Cloud API. Production-safe for business — no Baileys, no ban risk.",
    aliases: ["wa-cloud", "whatsapp-business", "wa-business"],
    // Prefer this over built-in Baileys-based WhatsApp when both are configured
    preferOver: ["whatsapp"],
  },

  capabilities: {
    chatTypes: ["direct" as const],
  },

  config: {
    listAccountIds: (cfg: any): string[] =>
      cfg.channels?.["whatsapp-cloud"]?.enabled !== false ? ["default"] : [],

    resolveAccount: (cfg: any, _accountId?: string) => {
      const channelCfg = cfg.channels?.["whatsapp-cloud"] ?? {};
      return { ...channelCfg, accountId: "default" };
    },
  },

  // ---- Security ----
  security: {
    dmPolicy: (cfg: any) => cfg.channels?.["whatsapp-cloud"]?.dmPolicy ?? "open",

    isAllowed: (cfg: any, senderId: string): boolean => {
      const channelCfg = cfg.channels?.["whatsapp-cloud"];
      if (!channelCfg || channelCfg.dmPolicy !== "allowlist") return true;
      const allowFrom: string[] = channelCfg.allowFrom ?? [];
      const normalized = senderId.replace(/[^0-9]/g, "");
      return allowFrom.some((n: string) => n.replace(/[^0-9]/g, "") === normalized);
    },
  },

  // ---- Setup wizard (for `openclaw channels login whatsapp-cloud`) ----
  setup: {
    login: async (ctx: any) => {
      const log: Logger = ctx.log ?? ctx.api?.logger ?? (console as unknown as Logger);
      log.info("[whatsapp-cloud] Starting setup wizard...");

      try {
        const result = await runSetupWizard(ctx.prompter, log);

        // Save config via OpenClaw's config API if available
        if (typeof ctx.setConfig === "function") {
          await ctx.setConfig("channels.whatsapp-cloud.enabled", true);
          await ctx.setConfig("channels.whatsapp-cloud.phoneNumberId", result.phoneNumberId);
          if (result.businessAccountId) {
            await ctx.setConfig("channels.whatsapp-cloud.businessAccountId", result.businessAccountId);
          }
          await ctx.setConfig("channels.whatsapp-cloud.accessToken", result.accessToken);
          if (result.appSecret) {
            await ctx.setConfig("channels.whatsapp-cloud.appSecret", result.appSecret);
          }
          await ctx.setConfig("channels.whatsapp-cloud.verifyToken", result.verifyToken);
          await ctx.setConfig("channels.whatsapp-cloud.webhookPort", result.webhookPort);
          await ctx.setConfig("channels.whatsapp-cloud.webhookPath", result.webhookPath);
          await ctx.setConfig("channels.whatsapp-cloud.dmPolicy", result.dmPolicy);
          log.info("[whatsapp-cloud] ✓ Configuration saved to openclaw.json");
        } else {
          // Fallback: print config for manual copy
          log.info("[whatsapp-cloud] Config API not available. Add this to your openclaw.json:");
          console.log(JSON.stringify({
            channels: {
              "whatsapp-cloud": {
                enabled: true,
                ...result,
              },
            },
          }, null, 2));
        }

        log.info("[whatsapp-cloud] ✓ Setup complete! Restart the gateway to apply.");
        return { ok: true };
      } catch (err) {
        log.error(`[whatsapp-cloud] Setup failed: ${err}`);
        return { ok: false, error: String(err) };
      }
    },

    check: (cfg: any) => {
      const channelCfg = cfg.channels?.["whatsapp-cloud"] ?? {};
      return validateConfig(channelCfg);
    },
  },

  // ---- Outbound ----
  outbound: {
    deliveryMode: "direct" as const,

    sendText: async (params: {
      text: string;
      peer: string;
      accountId?: string;
      channel: string;
      config: any;
      log?: Logger;
    }) => {
      const channelCfg = resolveConfig(params.config);
      const log: Logger = params.log ?? (console as unknown as Logger);

      if (!channelCfg.accessToken || !channelCfg.phoneNumberId) {
        log.error("[whatsapp-cloud] Cannot send: missing accessToken or phoneNumberId");
        return { ok: false };
      }

      const result = await sendText(channelCfg, params.peer, params.text, log);

      if (result.ok) {
        log.info(
          `[whatsapp-cloud] → ${params.peer}: ${params.text.slice(0, 80)}${
            params.text.length > 80 ? "…" : ""
          }`
        );
      }

      return { ok: result.ok };
    },
  },

  // ---- Gateway lifecycle ----
  gateway: {
    start: (ctx: any) => {
      const log: Logger = ctx.log ?? ctx.api?.logger ?? (console as unknown as Logger);
      const config = resolveConfig(ctx.config ?? ctx.cfg);

      if (!config.enabled) {
        log.info("[whatsapp-cloud] Channel is disabled");
        return;
      }

      // Validate config
      const validation = validateConfig(config);
      if (!validation.valid) {
        for (const err of validation.errors) {
          log.error(`[whatsapp-cloud] Config error: ${err}`);
        }
        log.error(
          "[whatsapp-cloud] Run 'openclaw channels login whatsapp-cloud' to configure"
        );
        return;
      }
      for (const warn of validation.warnings) {
        log.warn(`[whatsapp-cloud] ${warn}`);
      }

      // Start the webhook HTTP server
      webhookServer = startWebhookServer(
        config,
        // Inbound message handler — dispatch into OpenClaw agent session
        (message) => {
          const dispatch = ctx.dispatch ?? ctx.api?.dispatch;
          if (typeof dispatch === "function") {
            dispatch({
              channel: "whatsapp-cloud",
              accountId: "default",
              peer: message.from,
              senderId: message.from,
              senderName: message.senderName,
              text: message.text,
              messageId: message.messageId,
              ...(message.media ? { media: message.media } : {}),
              ...(message.interactiveReply
                ? { interactiveReply: message.interactiveReply }
                : {}),
              ...(message.quotedMessageId
                ? { quotedMessageId: message.quotedMessageId }
                : {}),
            });
          } else {
            log.error(
              "[whatsapp-cloud] No dispatch function available — cannot route inbound messages. " +
                "Make sure the plugin is loaded correctly by the Gateway."
            );
          }
        },
        // Status update handler
        (messageId, status, recipientId) => {
          log.debug(
            `[whatsapp-cloud] Status: ${status} for message ${messageId} to ${recipientId}`
          );
        },
        log
      );

      log.info("[whatsapp-cloud] ✓ Channel started");
      log.info(`[whatsapp-cloud]   Webhook: http://localhost:${config.webhookPort}${config.webhookPath}`);
      log.info(`[whatsapp-cloud]   DM Policy: ${config.dmPolicy}`);
      if (config.dmPolicy === "allowlist") {
        log.info(`[whatsapp-cloud]   Allowed: ${config.allowFrom.join(", ") || "(none)"}`);
      }
    },

    stop: () => {
      if (webhookServer) {
        webhookServer.close();
        webhookServer = null;
      }
    },
  },

  // ---- Status ----
  status: {
    check: (cfg?: any) => {
      const isRunning = webhookServer !== null && webhookServer.listening;

      if (cfg) {
        const channelCfg = cfg.channels?.["whatsapp-cloud"] ?? {};
        const validation = validateConfig(channelCfg);
        return {
          ok: isRunning && validation.valid,
          details: !validation.valid
            ? `Config errors: ${validation.errors.join("; ")}`
            : isRunning
              ? "Webhook server running"
              : "Webhook server not running",
        };
      }

      return {
        ok: isRunning,
        details: isRunning
          ? "Webhook server running"
          : "Webhook server not running",
      };
    },
  },
};

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

export default function register(api: any) {
  const log: Logger = api.logger ?? (console as unknown as Logger);
  log.info("[whatsapp-cloud] Loading WhatsApp Cloud API channel plugin");

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
              console.log("\n📋 Run these commands to save your config:\n");
              console.log(`  openclaw config set channels.whatsapp-cloud.enabled true`);
              console.log(`  openclaw config set channels.whatsapp-cloud.phoneNumberId "${result.phoneNumberId}"`);
              console.log(`  openclaw config set channels.whatsapp-cloud.accessToken "${result.accessToken}"`);
              if (result.appSecret) {
                console.log(`  openclaw config set channels.whatsapp-cloud.appSecret "${result.appSecret}"`);
              }
              console.log(`  openclaw config set channels.whatsapp-cloud.verifyToken "${result.verifyToken}"`);
              console.log(`  openclaw config set channels.whatsapp-cloud.webhookPort ${result.webhookPort}`);
              console.log(`\n  Then: openclaw gateway restart\n`);
            } catch (err) {
              log.error(`Setup failed: ${err}`);
              process.exit(1);
            }
          });

        cmd
          .command("status")
          .description("Check WhatsApp Cloud API channel health")
          .action(() => {
            const status = whatsappCloudChannel.status.check();
            console.log(`WhatsApp Cloud API: ${status.ok ? "✓ OK" : "✗ Not running"}`);
            console.log(`  ${status.details}`);
          });

        cmd
          .command("test")
          .description("Send a test message to verify configuration")
          .argument("<phone>", "Recipient phone in E.164 format (e.g., +393491234567)")
          .action(async (phone: string) => {
            const config = resolveConfig(api.config ?? api.getConfig?.() ?? {});

            if (!config.accessToken || !config.phoneNumberId) {
              log.error("Missing config. Run 'openclaw whatsapp-cloud setup' first.");
              process.exit(1);
            }

            const result = await sendText(
              config,
              phone.replace("+", ""),
              "🦞 Hello from OpenClaw! Your WhatsApp Cloud API channel is working.",
              log
            );

            if (result.ok) {
              console.log(`✓ Test message sent to ${phone} (ID: ${result.messageId})`);
            } else {
              console.log(`✗ Failed: ${result.error}`);
              process.exit(1);
            }
          });
      },
      { commands: ["whatsapp-cloud"] }
    );
  }

  log.info("[whatsapp-cloud] ✓ Plugin registered");
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { sendText, sendTemplate, sendInteractive, sendButtons, sendMedia } from "./api.js";
export { markAsRead, getMediaUrl, downloadMedia } from "./api.js";
export { runSetupWizard, validateConfig } from "./setup.js";
export type { WhatsAppCloudConfig } from "./types.js";
export type { ParsedInboundMessage, ParsedInboundMessage as InboundMessage } from "./webhook.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveConfig(cfg: any): WhatsAppCloudConfig {
  const raw = cfg?.channels?.["whatsapp-cloud"] ?? cfg ?? {};
  return {
    enabled: raw.enabled ?? CONFIG_DEFAULTS.enabled ?? true,
    phoneNumberId: raw.phoneNumberId ?? "",
    businessAccountId: raw.businessAccountId ?? "",
    accessToken: raw.accessToken ?? "",
    appSecret: raw.appSecret ?? "",
    verifyToken: raw.verifyToken ?? CONFIG_DEFAULTS.verifyToken!,
    webhookPort: raw.webhookPort ?? CONFIG_DEFAULTS.webhookPort!,
    webhookPath: raw.webhookPath ?? CONFIG_DEFAULTS.webhookPath!,
    apiVersion: raw.apiVersion ?? CONFIG_DEFAULTS.apiVersion!,
    dmPolicy: raw.dmPolicy ?? CONFIG_DEFAULTS.dmPolicy!,
    allowFrom: raw.allowFrom ?? CONFIG_DEFAULTS.allowFrom!,
    sendReadReceipts: raw.sendReadReceipts ?? CONFIG_DEFAULTS.sendReadReceipts!,
  };
}
