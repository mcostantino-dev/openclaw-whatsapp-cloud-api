# OpenClaw WhatsApp Cloud API Channel

WhatsApp channel for [OpenClaw](https://github.com/openclaw/openclaw) using Meta's **official Cloud API** — production-safe, no Baileys, no ban risk.

## Why this plugin?

OpenClaw's built-in WhatsApp channel uses [Baileys](https://github.com/WhiskeySockets/Baileys), a reverse-engineered WhatsApp Web protocol. It works great for personal use, but Meta can ban accounts at any time — making it unsuitable for business bots.

This plugin uses the **official WhatsApp Cloud API** (`graph.facebook.com`) instead:

| | Built-in (Baileys) | This plugin (Cloud API) |
|---|---|---|
| Auth | QR code scan | OAuth access token |
| Ban risk | High (unofficial) | None (official) |
| 24-hour window | No restriction | Required (templates after 24h) |
| Cost | Free | Pay-per-conversation |
| Sending first | Anytime | Templates only |
| Best for | Personal assistant | Customer-facing bots |

## Prerequisites

- **OpenClaw** >= 2026.2.x installed and configured (`openclaw configure`)
- **Node.js** >= 22
- A **Meta Business App** with WhatsApp product enabled
- A domain with **HTTPS** for the webhook (ngrok for dev, reverse proxy for prod)

## Quick start (development)

### 1. Install the plugin

```bash
git clone https://github.com/baiadigitale/openclaw-channel-whatsapp-cloud.git
cd openclaw-channel-whatsapp-cloud
npm install && npm run build
openclaw plugins install -l .
```

> **Note:** Due to a known OpenClaw bug with symlinks, if the plugin isn't discovered after `install -l .`, add this to `~/.openclaw/openclaw.json`:
> ```json
> {
>   "plugins": {
>     "load": {
>       "paths": ["/absolute/path/to/openclaw-channel-whatsapp-cloud"]
>     }
>   }
> }
> ```

### 2. Get Meta credentials

1. Go to [developers.facebook.com](https://developers.facebook.com/) and create an app (type: **Business**)
2. Add the **WhatsApp** product
3. In **WhatsApp > API Setup**, note your **Phone Number ID**
4. Create a permanent access token:
   - **Business Settings > System Users** > create one with **Admin** role
   - Generate a token with permissions: `whatsapp_business_messaging`, `whatsapp_business_management`
5. Note your **App Secret** from **App Settings > Basic** (for webhook signature verification)

### 3. Run the setup wizard

```bash
openclaw whatsapp-cloud setup
```

This will prompt for all credentials and save them to `~/.openclaw/openclaw.json`.

Alternatively, set them manually:

```bash
openclaw config set channels.whatsapp-cloud.phoneNumberId "YOUR_PHONE_NUMBER_ID"
openclaw config set channels.whatsapp-cloud.accessToken "YOUR_ACCESS_TOKEN"
openclaw config set channels.whatsapp-cloud.appSecret "YOUR_APP_SECRET"
openclaw config set channels.whatsapp-cloud.verifyToken "a-random-string-you-choose"
```

### 4. Expose the webhook (dev)

```bash
ngrok http 3100
```

Copy the `https://xxxx.ngrok-free.app` URL.

### 5. Register the webhook on Meta

1. Go to **WhatsApp > Configuration** in your Meta app
2. Click **Edit** on the Webhook section
3. **Callback URL**: `https://your-ngrok-url/webhook/whatsapp-cloud`
4. **Verify Token**: the string you chose in step 3
5. Click **Verify and Save**
6. Subscribe to the **messages** webhook field

### 6. Start the gateway

```bash
openclaw gateway restart
```

Send a WhatsApp message to your business number — the bot will respond.

---

## Production deployment

### Architecture

```
User on WhatsApp
      |
      v
Meta Cloud API (graph.facebook.com)
      |
      v  HTTPS POST
+--------------------------------------------------+
|  Your server (VPS / Docker / Cloud)              |
|                                                  |
|  nginx/Caddy (TLS termination, port 443)         |
|      |                                           |
|      v  proxy_pass :3100                         |
|  OpenClaw Gateway (systemd service)              |
|    +-- whatsapp-cloud plugin                     |
|    |     webhook.ts  -> receives messages         |
|    |     crypto.ts   -> verifies HMAC signature   |
|    |     index.ts    -> dispatches to agent        |
|    |     api.ts      -> sends replies              |
|    +-- agent (Claude / GPT / ...)                |
+--------------------------------------------------+
```

### Recommended repo structure

Create a **deployment repository** separate from this plugin:

```
my-openclaw-bot/
  openclaw.json          # OpenClaw config (env var refs for secrets)
  .env.example           # Documents all required env vars
  .env                   # Actual secrets (NEVER commit this)
  .gitignore
  workspace/
    AGENTS.md            # Agent instructions, persona, behavior rules
    SOUL.md              # Personality, tone, boundaries
    IDENTITY.md          # Agent name, emoji
    USER.md              # Info about the user/company
    TOOLS.md             # Tool-specific notes
  scripts/
    deploy.sh            # Deployment automation
    backup.sh            # State backup
  docker-compose.yml     # Optional: containerized deployment
  Caddyfile              # Or nginx.conf — reverse proxy config
```

**`.gitignore`:**
```
.env
*.bak
sessions/
credentials/
```

**`openclaw.json`** (with env var references):
```json5
{
  "gateway": {
    "mode": "local",
    "bind": "loopback",
    "auth": {
      "mode": "token",
      "token": "${OPENCLAW_GATEWAY_TOKEN}"
    }
  },

  // LLM provider
  "auth": {
    "profiles": {
      "anthropic:default": {
        "provider": "anthropic",
        "mode": "token"
      }
    }
  },
  "agents": {
    "defaults": {
      "workspace": "./workspace",
      "models": {
        "anthropic/claude-sonnet-4-5": {}
      }
    }
  },

  // WhatsApp Cloud channel
  "channels": {
    "whatsapp-cloud": {
      "phoneNumberId": "${WHATSAPP_PHONE_NUMBER_ID}",
      "accessToken": "${WHATSAPP_ACCESS_TOKEN}",
      "appSecret": "${WHATSAPP_APP_SECRET}",
      "verifyToken": "${WHATSAPP_VERIFY_TOKEN}",
      "webhookPort": 3100,
      "dmPolicy": "open",
      "sendReadReceipts": true
    }
  },

  // Plugin
  "plugins": {
    "entries": {
      "whatsapp-cloud": { "enabled": true }
    }
  }
}
```

**`.env.example`:**
```bash
# Anthropic API key (get from https://console.anthropic.com/settings/keys)
ANTHROPIC_API_KEY=sk-ant-...

# OpenClaw gateway auth token (generate: openssl rand -hex 24)
OPENCLAW_GATEWAY_TOKEN=

# WhatsApp Cloud API (from https://developers.facebook.com/)
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=
```

### Install on a production server

```bash
# 1. Install OpenClaw
npm install -g openclaw

# 2. Clone the plugin (private repo — no npm publish needed)
git clone git@github.com:baiadigitale/openclaw-channel-whatsapp-cloud.git ~/extensions/whatsapp-cloud
cd ~/extensions/whatsapp-cloud && npm install && npm run build

# 3. Clone your deployment repo
git clone https://github.com/yourorg/my-openclaw-bot.git ~/openclaw-bot
cd ~/openclaw-bot

# 4. Copy env file and fill in secrets
cp .env.example .env
nano .env

# 5. Point OpenClaw to your config
export OPENCLAW_CONFIG_PATH=~/openclaw-bot/openclaw.json
export OPENCLAW_STATE_DIR=~/openclaw-bot/.state

# 6. Install and start the gateway
openclaw gateway install
systemctl --user start openclaw-gateway.service
systemctl --user enable openclaw-gateway.service
```

Make sure your `openclaw.json` loads the plugin from the cloned path:

```json
{
  "plugins": {
    "load": {
      "paths": ["~/extensions/whatsapp-cloud"]
    },
    "entries": {
      "whatsapp-cloud": { "enabled": true }
    }
  }
}
```

### Update the plugin

After pushing changes to the repo, run this on the server:

```bash
cd ~/extensions/whatsapp-cloud && git pull && npm install && npm run build && systemctl --user restart openclaw-gateway.service
```

### Reverse proxy (Caddy)

**`Caddyfile`:**
```
yourdomain.com {
    reverse_proxy /webhook/whatsapp-cloud localhost:3100
}
```

```bash
sudo caddy start --config Caddyfile
```

Caddy handles TLS automatically via Let's Encrypt.

**nginx alternative:**
```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location /webhook/whatsapp-cloud {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Docker deployment (optional)

**`docker-compose.yml`:**
```yaml
services:
  openclaw:
    image: node:22-slim
    working_dir: /app
    command: ["npx", "openclaw", "gateway", "--bind", "lan", "--port", "3100"]
    env_file: .env
    environment:
      OPENCLAW_CONFIG_PATH: /app/openclaw.json
      OPENCLAW_STATE_DIR: /data
      NODE_ENV: production
    volumes:
      - ./openclaw.json:/app/openclaw.json:ro
      - ./workspace:/app/workspace:ro
      - openclaw-data:/data
    ports:
      - "3100:3100"
    restart: unless-stopped

volumes:
  openclaw-data:
```

### Monitoring

```bash
# Live logs
journalctl --user -u openclaw-gateway.service -f

# Channel status
openclaw whatsapp-cloud status

# Gateway health
openclaw gateway status

# Send a test message
openclaw whatsapp-cloud test +39XXXXXXXXXX
```

### Security checklist

- [ ] `appSecret` is set (enables webhook HMAC signature verification)
- [ ] Access token is a **System User token** (permanent, not a temporary test token)
- [ ] `dmPolicy` is set to `"allowlist"` if the bot should only serve specific numbers
- [ ] Webhook endpoint is HTTPS-only
- [ ] `.env` file has `chmod 600` and is not committed to git
- [ ] Gateway auth token is set (`gateway.auth.mode: "token"`)
- [ ] Gateway binds to loopback only (reverse proxy handles external traffic)

---

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

### Inbound message types

- Text messages
- Images (with/without captions)
- Audio, video, documents, stickers
- Location sharing
- Contact cards
- Interactive replies (button and list selections)
- Quoted messages (reply context)

### Outbound capabilities

- Text messages (auto-split at 4096 chars)
- Interactive buttons (up to 3 quick reply buttons)
- Interactive lists (section-based menus)
- Media messages (image, audio, video, document)
- Template messages (for messages outside the 24h window)
- Read receipts

### Security

- HMAC-SHA256 webhook signature verification (via App Secret)
- Timing-safe comparison to prevent timing attacks
- DM policy (open / allowlist)
- Phone number normalization for allowlist matching

## The 24-hour messaging window

WhatsApp Cloud API enforces a **24-hour customer service window**:

- When a customer messages you, you have **24 hours** to respond with free-form text
- After the window closes, you can only send **pre-approved template messages**
- Each template must be submitted to Meta for review

This plugin handles free-form responses automatically. For proactive notifications, use the `sendTemplate` API:

```typescript
import { sendTemplate } from "@baia-digitale/whatsapp-cloud";
```

## Development

```bash
git clone https://github.com/baiadigitale/openclaw-channel-whatsapp-cloud.git
cd openclaw-channel-whatsapp-cloud
npm install

npm run type-check    # TypeScript strict mode
npm test              # 32 tests
npm run dev           # Watch mode (auto-rebuild)

# Link to OpenClaw for development
openclaw plugins install -l .
```

### Project structure

```
src/
  index.ts        — Plugin entry point + channel definition
  types.ts        — TypeScript interfaces
  api.ts          — Meta Cloud API client (outbound)
  webhook.ts      — HTTP server (inbound webhooks)
  crypto.ts       — HMAC-SHA256 signature verification
  setup.ts        — Interactive setup wizard
  runtime.ts      — OpenClaw runtime accessor
  __tests__/      — Vitest test suites
```

## Rate limits

New WhatsApp Business accounts start at **250 unique recipients per 24 hours**. As quality improves:

250 > 1,000 > 10,000 > 100,000 > unlimited

## Troubleshooting

**Webhook verification fails:**
- Ensure `verifyToken` in OpenClaw config matches what you entered in Meta dashboard
- The webhook URL must be reachable over HTTPS

**Messages not arriving:**
- Check that you subscribed to the `messages` webhook field in Meta dashboard
- Check logs: `journalctl --user -u openclaw-gateway.service -f`
- Verify `appSecret` is correct (wrong secret = messages silently dropped)

**"phoneNumberId?.trim is not a function":**
- The `phoneNumberId` was saved as a number instead of a string. Fix it in `~/.openclaw/openclaw.json` by wrapping the value in quotes: `"phoneNumberId": "878388375365101"`

**Plugin not found after `install -l .`:**
- OpenClaw has a symlink discovery bug. Add `plugins.load.paths` to your config pointing to the plugin directory (see install instructions above)

**Gateway won't start:**
- Set `gateway.mode`: `openclaw config set gateway.mode local`
- Check logs: `journalctl --user -u openclaw-gateway.service -n 50`

## License

MIT — [Baia Digitale SRL](https://baiadigitale.com)
