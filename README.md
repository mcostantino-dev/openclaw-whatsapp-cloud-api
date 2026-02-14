# OpenClaw WhatsApp Cloud API Channel

WhatsApp channel for [OpenClaw](https://github.com/openclaw/openclaw) using Meta's **official Cloud API** — production-safe, no Baileys, no ban risk.

## Why this plugin?

OpenClaw's built-in WhatsApp channel uses [Baileys](https://github.com/WhiskeySockets/Baileys), a reverse-engineered WhatsApp Web protocol. It works great for personal use, but Meta can ban accounts at any time — making it unsuitable for business bots.

This plugin uses the **official WhatsApp Cloud API** (`graph.facebook.com`) instead:

| | Built-in (Baileys) | This plugin (Cloud API) |
|---|---|---|
| Auth | QR code scan | OAuth access token |
| Ban risk | ⚠️ High (unofficial) | ✅ None (official) |
| 24-hour window | No restriction | Required (templates after 24h) |
| Cost | Free | Pay-per-conversation |
| Sending first | Anytime | Templates only |
| Best for | Personal assistant | Customer-facing bots |

## Quick start

### 1. Install the plugin

**From npm:**
```bash
openclaw plugins install @baia-digitale/openclaw-channel-whatsapp-cloud
```

**From source (development):**
```bash
git clone https://github.com/baiadigitale/openclaw-channel-whatsapp-cloud.git
cd openclaw-channel-whatsapp-cloud
npm install
openclaw plugins install -l .
```

### 2. Configure Meta Business

1. Go to [developers.facebook.com](https://developers.facebook.com/) → Create App → select **Business** type
2. Add the **WhatsApp** product to your app
3. In **WhatsApp → API Setup**, note your:
   - **Phone Number ID**
   - **WhatsApp Business Account ID**
4. Create a permanent access token:
   - Go to **Business Settings → System Users**
   - Create a system user with **Admin** role
   - Generate a token with `whatsapp_business_messaging` and `whatsapp_business_management` permissions
5. Note your **App Secret** from **App Settings → Basic** (required for webhook signature verification)

### 3. Configure OpenClaw

```bash
openclaw config set channels.whatsapp-cloud.enabled true
openclaw config set channels.whatsapp-cloud.phoneNumberId "YOUR_PHONE_NUMBER_ID"
openclaw config set channels.whatsapp-cloud.accessToken "YOUR_ACCESS_TOKEN"
openclaw config set channels.whatsapp-cloud.appSecret "YOUR_APP_SECRET"
openclaw config set channels.whatsapp-cloud.verifyToken "a-random-string-you-choose"
```

Or edit `~/.openclaw/openclaw.json` directly:

```json
{
  "channels": {
    "whatsapp-cloud": {
      "enabled": true,
      "phoneNumberId": "YOUR_PHONE_NUMBER_ID",
      "businessAccountId": "YOUR_BUSINESS_ACCOUNT_ID",
      "accessToken": "YOUR_PERMANENT_ACCESS_TOKEN",
      "appSecret": "YOUR_META_APP_SECRET",
      "verifyToken": "a-random-string-you-choose",
      "webhookPort": 3100,
      "dmPolicy": "open"
    }
  }
}
```

### 4. Expose the webhook

Meta needs to reach your webhook server over HTTPS.

**Development (ngrok):**
```bash
ngrok http 3100
# Copy the https://xxxx.ngrok.io URL
```

**Production options:**
- Reverse proxy (nginx/Caddy) with TLS
- Cloudflare Tunnel: `cloudflared tunnel --url http://localhost:3100`
- Tailscale Funnel: `tailscale funnel 3100`

### 5. Register the webhook with Meta

1. Go to **WhatsApp → Configuration** in your Meta app
2. Set **Callback URL**: `https://your-domain.com/webhook/whatsapp-cloud`
3. Set **Verify token**: the same string you configured above
4. Click **Verify and Save**
5. Subscribe to the **messages** webhook field

### 6. Restart OpenClaw

```bash
openclaw gateway restart
```

Send a WhatsApp message to your business number — you should get a response from your OpenClaw agent.

## Configuration reference

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the channel |
| `phoneNumberId` | string | *required* | WhatsApp Phone Number ID |
| `businessAccountId` | string | — | WhatsApp Business Account ID |
| `accessToken` | string | *required* | Meta API access token (system user token) |
| `appSecret` | string | — | Meta App Secret for webhook signature verification |
| `verifyToken` | string | `"openclaw-wa-cloud-verify"` | Custom token for webhook endpoint verification |
| `webhookPort` | number | `3100` | HTTP server port for webhooks |
| `webhookPath` | string | `"/webhook/whatsapp-cloud"` | URL path for the webhook endpoint |
| `apiVersion` | string | `"v21.0"` | Meta Graph API version |
| `dmPolicy` | string | `"open"` | `"open"` (anyone) or `"allowlist"` (restricted) |
| `allowFrom` | string[] | `[]` | E.164 numbers allowed when dmPolicy=allowlist |
| `sendReadReceipts` | boolean | `true` | Auto-mark incoming messages as read |

## Features

### Supported inbound message types

- ✅ Text messages
- ✅ Images (with/without captions)
- ✅ Audio, video, documents, stickers
- ✅ Location sharing
- ✅ Contact cards
- ✅ Interactive replies (button and list selections)
- ✅ Quoted messages (reply context)

### Outbound capabilities

- ✅ Text messages (auto-split at 4096 chars)
- ✅ Interactive buttons (up to 3 quick reply buttons)
- ✅ Interactive lists (section-based menus)
- ✅ Media messages (image, audio, video, document — by URL or media ID)
- ✅ Template messages (for messages outside the 24h window)
- ✅ Read receipts

### Security

- ✅ HMAC-SHA256 webhook signature verification (via App Secret)
- ✅ Timing-safe comparison to prevent timing attacks
- ✅ DM policy (open / allowlist)
- ✅ Phone number normalization for allowlist matching

## The 24-hour messaging window

WhatsApp Cloud API enforces a **24-hour customer service window**:

- When a customer messages you, you have **24 hours** to respond with free-form text
- After the window closes, you can only send **pre-approved template messages**
- Each template message must be submitted to Meta for review before use

This plugin handles free-form responses automatically. For sending templates (e.g., proactive notifications), use the exported `sendTemplate` function:

```typescript
import { sendTemplate } from "@baia-digitale/openclaw-channel-whatsapp-cloud";
```

## Development

```bash
git clone https://github.com/baiadigitale/openclaw-channel-whatsapp-cloud.git
cd openclaw-channel-whatsapp-cloud
npm install

# Type check
npm run type-check

# Run tests
npm test

# Link to OpenClaw for development
openclaw plugins install -l .

# Watch mode (auto-rebuild)
npm run dev
```

### Project structure

```
src/
  index.ts        — Plugin registration + channel definition (entry point)
  types.ts        — TypeScript interfaces for config, webhooks, API
  api.ts          — Meta Cloud API client (outbound messages)
  webhook.ts      — HTTP server for inbound webhooks
  crypto.ts       — HMAC-SHA256 signature verification
  __tests__/
    api.test.ts       — API client tests
    crypto.test.ts    — Signature verification tests
    webhook.test.ts   — Webhook server integration tests
```

### Running tests

```bash
npm test              # Run all tests
npx vitest --watch    # Watch mode
npx vitest --coverage # With coverage report
```

## Troubleshooting

**Webhook verification fails:**
- Make sure `verifyToken` in your OpenClaw config exactly matches what you entered in the Meta dashboard
- Ensure the webhook URL is publicly reachable over HTTPS

**Messages not arriving:**
- Check that you subscribed to the `messages` webhook field in Meta dashboard
- Look at OpenClaw gateway logs for `[whatsapp-cloud]` entries
- Verify `appSecret` is correct (wrong secret = silent message drops)

**"Missing required config" error:**
- Both `phoneNumberId` and `accessToken` are required
- Get them from your Meta app's WhatsApp API Setup page

**Bot responds in development but not production:**
- Make sure `appSecret` is set for production (webhook signature verification)
- Check that your access token hasn't expired — use a System User token for permanent access

## Rate limits

New WhatsApp Business accounts start with a **250 unique recipients per 24 hours** limit. As your quality rating improves, Meta increases this:

250 → 1,000 → 10,000 → 100,000 → unlimited

Send quality matters — don't spam, handle unsubscribes, and keep template message opt-outs low.

## License

MIT — [Baia Digitale SRL](https://baiadigitale.com)

## Contributing

PRs welcome. Please ensure `npm run type-check` and `npm test` pass before submitting.
