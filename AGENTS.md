# OpenClaw WhatsApp Cloud API Channel Plugin

## What this is

A **channel plugin** for [OpenClaw](https://github.com/openclaw/openclaw) that adds WhatsApp support via Meta's official Cloud API (`graph.facebook.com`). This replaces the built-in Baileys-based WhatsApp channel for **business use cases** where ban risk is unacceptable.

This is NOT a skill (SKILL.md). This is a **TypeScript plugin** that runs inside the OpenClaw Gateway process and registers a new messaging channel.

## Architecture

```
User on WhatsApp
      │
      ▼
Meta Cloud API (graph.facebook.com)
      │
      ▼ POST webhook
┌─────────────────────────────┐
│  webhook.ts (HTTP server)   │  ← Receives inbound messages
│  crypto.ts (HMAC verify)    │  ← Validates X-Hub-Signature-256
│         │                   │
│         ▼                   │
│  index.ts (channel plugin)  │  ← Dispatches via runtime.channel.reply.dispatch...()
│         │                   │
│         ▼                   │
│  api.ts (outbound client)   │  ← Sends replies via Meta API
└─────────────────────────────┘
      │
      ▼
Meta Cloud API → User's WhatsApp
```

## Key files

- `src/index.ts` — Plugin entry point. Exports `{ id, name, register(api) }` that calls `api.registerChannel()`. Contains the full channel definition with meta, capabilities, config, security, pairing, setup, outbound, gateway lifecycle, and status adapters. Also registers CLI commands (setup/status/test).
- `src/runtime.ts` — Stores the `PluginRuntime` reference provided by OpenClaw at load time. Used by all modules for dispatch and config access.
- `src/setup.ts` — Interactive setup wizard (6 steps: phoneNumberId, businessAccountId, accessToken, appSecret, verifyToken, webhookPort).
- `src/api.ts` — Meta Cloud API client. Handles all outbound: text, templates, interactive buttons/lists, media, read receipts, media download.
- `src/webhook.ts` — HTTP server. Handles GET (Meta verification challenge) and POST (inbound messages). Parses all message types. Access control via allowlist.
- `src/crypto.ts` — HMAC-SHA256 webhook signature verification with timing-safe comparison.
- `src/types.ts` — 30+ TypeScript interfaces for the entire WhatsApp Cloud API surface.
- `openclaw.plugin.json` — Plugin manifest with configSchema and uiHints for the Control UI.
- `package.json` — Has `openclaw.extensions` and `openclaw.channel` metadata for discovery.

## Plugin API contract

This plugin follows the OpenClaw channel plugin contract.

Key interfaces used:
- `api.registerChannel({ plugin })` — registers the channel with OpenClaw
- `api.registerCli(fn, { commands })` — registers CLI commands (setup/status/test)
- `api.runtime` — `PluginRuntime` for config access and message dispatch
- Channel plugin shape: `{ id, meta, capabilities, config, security, pairing, setup, outbound, gateway, status }`
- `outbound.sendText({ cfg, to, text, accountId })` — send a message, returns `OutboundDeliveryResult`
- `gateway.startAccount(ctx)` — called when Gateway starts; ctx has `account`, `cfg`, `runtime`, `abortSignal`, `log`, `setStatus`
- `runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({ ctx: MsgContext, cfg, dispatcherOptions })` — route inbound message to agent session
- `MsgContext` fields: `Body`, `From`, `To`, `SessionKey`, `AccountId`, `MessageSid`, `Provider`, `OriginatingChannel`, etc.
- `dispatcherOptions.deliver(payload)` — callback that sends the agent's reply back to WhatsApp

## Reference implementations

- DingTalk plugin: https://github.com/soimy/openclaw-channel-dingtalk (262 stars, most mature community plugin)
- OpenClaw China pack: https://github.com/BytePioneer-AI/moltbot-china (multi-channel)
- Built-in Telegram channel (in OpenClaw core) is the canonical reference

## Status

All core features are implemented and working:
- Setup wizard (`openclaw whatsapp-cloud setup`)
- Gateway lifecycle (`gateway.startAccount` with proper dispatch)
- Inbound message dispatch via `runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher()`
- Outbound text and media via Meta Cloud API
- Webhook signature verification
- DM policy (open / allowlist)
- CLI commands: setup, status, test

## Future improvements

### 1. Multi-account support
Currently uses a single "default" account. Could support multiple WhatsApp numbers:
```json
{
  "channels": {
    "whatsapp-cloud": {
      "accounts": {
        "support": { "phoneNumberId": "...", "accessToken": "..." },
        "sales": { "phoneNumberId": "...", "accessToken": "..." }
      }
    }
  }
}
```

### 2. Typing indicators
Send a "typing" status while the agent generates a response.

### 3. Template message support in outbound
Allow the agent to send pre-approved template messages for proactive notifications.

## Testing

```bash
npm install
npm run type-check    # TypeScript strict mode, 0 errors expected
npm test              # 32 tests across 3 files, all should pass
```

Tests use vitest. The webhook tests spin up real HTTP servers on ports 13101-13112. The API tests mock `fetch` globally.

## Config location

All config lives under `channels.whatsapp-cloud` in `~/.openclaw/openclaw.json`:

```json
{
  "channels": {
    "whatsapp-cloud": {
      "enabled": true,
      "phoneNumberId": "123456789",
      "accessToken": "EAAx...",
      "appSecret": "abc123...",
      "verifyToken": "my-random-verify-token",
      "webhookPort": 3100,
      "webhookPath": "/webhook/whatsapp-cloud",
      "dmPolicy": "open",
      "allowFrom": ["+393491234567"],
      "sendReadReceipts": true
    }
  }
}
```

## Meta WhatsApp Cloud API reference

- Send messages: POST `https://graph.facebook.com/v21.0/{phoneNumberId}/messages`
- Webhook verification: GET with hub.mode, hub.verify_token, hub.challenge
- Webhook events: POST with X-Hub-Signature-256 header
- Media: GET `https://graph.facebook.com/v21.0/{mediaId}` for download URL
- Rate limits: Start at 250 recipients/24h, scales to unlimited with quality
- 24h window: Free-form replies for 24h after customer message, then templates only
- Docs: https://developers.facebook.com/docs/whatsapp/cloud-api

## Don't

- Don't turn this into a skill (SKILL.md). It's a channel plugin.
- Don't use Baileys. The whole point is using the official API.
- Don't store secrets in code. Use OpenClaw's config system.
- Don't use `require()`. This is ESM (`"type": "module"`).
