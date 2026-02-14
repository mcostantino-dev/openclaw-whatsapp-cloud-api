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
│  index.ts (channel plugin)  │  ← Dispatches to OpenClaw session via ctx.dispatch()
│         │                   │
│         ▼                   │
│  api.ts (outbound client)   │  ← Sends replies via Meta API
└─────────────────────────────┘
      │
      ▼
Meta Cloud API → User's WhatsApp
```

## Key files

- `src/index.ts` — Plugin entry point. Exports `register(api)` function that calls `api.registerChannel()`. Contains the channel definition with meta, capabilities, config, outbound, gateway lifecycle, and **setup wizard**.
- `src/api.ts` — Meta Cloud API client. Handles all outbound: text, templates, interactive buttons/lists, media, read receipts, media download.
- `src/webhook.ts` — HTTP server. Handles GET (Meta verification challenge) and POST (inbound messages). Parses all message types. Access control via allowlist.
- `src/crypto.ts` — HMAC-SHA256 webhook signature verification with timing-safe comparison.
- `src/types.ts` — 30+ TypeScript interfaces for the entire WhatsApp Cloud API surface.
- `openclaw.plugin.json` — Plugin manifest with configSchema and uiHints for the Control UI.
- `package.json` — Has `openclaw.extensions` and `openclaw.channel` metadata for discovery.

## Plugin API contract

This plugin follows the OpenClaw channel plugin contract documented at:
https://docs.openclaw.ai/tools/plugin

Key interfaces used:
- `api.registerChannel({ plugin })` — registers the channel
- `api.registerCli(fn, { commands })` — registers CLI commands (for setup wizard)
- Channel plugin shape: `{ id, meta, capabilities, config, outbound, gateway, security, status, setup }`
- `outbound.sendText({ text, peer, config, log })` — send a message
- `gateway.start(ctx)` — called when Gateway starts; ctx has dispatch, config, log
- `ctx.dispatch({ channel, peer, text, ... })` — route inbound message to agent session

## Reference implementations

- DingTalk plugin: https://github.com/soimy/openclaw-channel-dingtalk (262 stars, most mature community plugin)
- OpenClaw China pack: https://github.com/BytePioneer-AI/moltbot-china (multi-channel)
- Built-in Telegram channel (in OpenClaw core) is the canonical reference

## What needs work

### 1. Setup wizard (PRIORITY)
The plugin needs an interactive setup flow so that when a user runs `openclaw channels login whatsapp-cloud` or goes through onboarding, it prompts for:
- Phone Number ID (from Meta Business dashboard)
- Access Token (System User token)
- App Secret (for webhook signature verification)
- Verify Token (user chooses a random string)
- Webhook Port (default 3100)

Look at how the DingTalk plugin and built-in Telegram channel handle their setup wizards. The setup adapter should use `api.registerCli` or the `setup` property on the channel plugin.

### 2. Verify dispatch() signature
The `ctx.dispatch()` call in `gateway.start` may need adjustment based on the actual OpenClaw version. Test with `openclaw plugins install -l .` and send a real WhatsApp message. Check gateway logs for errors. The dispatch payload shape should match what other channels send.

### 3. Webhook exposure guidance  
After setup, the plugin should tell the user:
- Their webhook URL format: `https://<your-domain>/webhook/whatsapp-cloud`
- How to expose it (ngrok for dev, Cloudflare Tunnel for prod)
- How to register it in Meta's dashboard
- The webhook server is ALREADY built into the plugin (webhook.ts) — no external server needed

### 4. Account-based config
Currently uses a single "default" account. Consider supporting multi-account config like:
```json
{
  "channels": {
    "whatsapp-cloud": {
      "accounts": {
        "padelink": { "phoneNumberId": "...", "accessToken": "..." },
        "support": { "phoneNumberId": "...", "accessToken": "..." }
      }
    }
  }
}
```

### 5. Streaming support
OpenClaw supports streaming responses (typing indicator → progressive text). The WhatsApp Cloud API doesn't support true streaming, but we could:
- Send a "typing" indicator via the Presence API while the agent thinks
- Deliver the response as a single message when complete

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
