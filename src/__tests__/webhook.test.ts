import { describe, it, expect, vi, beforeEach } from "vitest";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import type { WhatsAppCloudConfig, WebhookPayload } from "../types.js";
import { CONFIG_DEFAULTS } from "../types.js";

// We test the webhook server via HTTP to exercise the full stack
import { startWebhookServer, type ParsedInboundMessage } from "../webhook.js";

const TEST_PORT = 13100;
const APP_SECRET = "test_secret_for_webhook";

function makeConfig(overrides: Partial<WhatsAppCloudConfig> = {}): WhatsAppCloudConfig {
  return {
    enabled: true,
    phoneNumberId: "111222333",
    businessAccountId: "444555666",
    accessToken: "test_token",
    appSecret: APP_SECRET,
    verifyToken: "test-verify",
    webhookPort: TEST_PORT,
    webhookPath: "/webhook/whatsapp-cloud",
    apiVersion: "v21.0",
    dmPolicy: "open",
    allowFrom: [],
    sendReadReceipts: false, // disable in tests to avoid API calls
    ...overrides,
  };
}

function sign(body: string): string {
  return "sha256=" + createHmac("sha256", APP_SECRET).update(body).digest("hex");
}

function makeTextPayload(from: string, text: string): WebhookPayload {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "BUSINESS_ACCOUNT_ID",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550001234",
                phone_number_id: "111222333",
              },
              contacts: [{ profile: { name: "Test User" }, wa_id: from }],
              messages: [
                {
                  from,
                  id: "wamid.test123",
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: text },
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

function makeInteractivePayload(
  from: string,
  replyType: "button_reply" | "list_reply",
  replyId: string,
  replyTitle: string
): WebhookPayload {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "BUSINESS_ACCOUNT_ID",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550001234",
                phone_number_id: "111222333",
              },
              contacts: [{ profile: { name: "Test User" }, wa_id: from }],
              messages: [
                {
                  from,
                  id: "wamid.interactive123",
                  timestamp: "1700000001",
                  type: "interactive",
                  interactive: {
                    type: replyType,
                    [replyType]: { id: replyId, title: replyTitle },
                  },
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

function makeImagePayload(from: string, caption?: string): WebhookPayload {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "BUSINESS_ACCOUNT_ID",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550001234",
                phone_number_id: "111222333",
              },
              contacts: [{ profile: { name: "Test User" }, wa_id: from }],
              messages: [
                {
                  from,
                  id: "wamid.image123",
                  timestamp: "1700000002",
                  type: "image",
                  image: {
                    id: "media_id_123",
                    mime_type: "image/jpeg",
                    sha256: "abc123",
                    ...(caption ? { caption } : {}),
                  },
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

async function postWebhook(
  payload: WebhookPayload,
  port: number = TEST_PORT,
  skipSignature: boolean = false
): Promise<Response> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (!skipSignature) {
    headers["X-Hub-Signature-256"] = sign(body);
  }
  return fetch(`http://localhost:${port}/webhook/whatsapp-cloud`, {
    method: "POST",
    headers,
    body,
  });
}

describe("Webhook Server", () => {
  let server: ReturnType<typeof startWebhookServer>;
  let receivedMessages: ParsedInboundMessage[];
  let receivedStatuses: Array<{ id: string; status: string; recipientId: string }>;

  beforeEach(async () => {
    receivedMessages = [];
    receivedStatuses = [];
    vi.clearAllMocks();
  });

  async function startServer(configOverrides: Partial<WhatsAppCloudConfig> = {}) {
    const config = makeConfig(configOverrides);
    server = startWebhookServer(
      config,
      (msg) => receivedMessages.push(msg),
      (id, status, recipientId) => receivedStatuses.push({ id, status, recipientId }),
      mockLog
    );
    // Wait for server to be ready
    await new Promise<void>((resolve) => {
      if (server.listening) return resolve();
      server.on("listening", resolve);
    });
    return server;
  }

  async function stopServer() {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  // --- Verification ---

  it("handles webhook verification challenge", async () => {
    await startServer({ webhookPort: 13101 });
    try {
      const url = new URL("http://localhost:13101/webhook/whatsapp-cloud");
      url.searchParams.set("hub.mode", "subscribe");
      url.searchParams.set("hub.verify_token", "test-verify");
      url.searchParams.set("hub.challenge", "challenge_code_42");

      const res = await fetch(url.toString());
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe("challenge_code_42");
    } finally {
      await stopServer();
    }
  });

  it("rejects verification with wrong token", async () => {
    await startServer({ webhookPort: 13102 });
    try {
      const url = new URL("http://localhost:13102/webhook/whatsapp-cloud");
      url.searchParams.set("hub.mode", "subscribe");
      url.searchParams.set("hub.verify_token", "WRONG_TOKEN");
      url.searchParams.set("hub.challenge", "challenge_code");

      const res = await fetch(url.toString());
      expect(res.status).toBe(403);
    } finally {
      await stopServer();
    }
  });

  // --- Message handling ---

  it("processes a text message", async () => {
    await startServer({ webhookPort: 13103 });
    try {
      const payload = makeTextPayload("393491234567", "Hello bot!");
      const res = await postWebhook(payload, 13103);
      expect(res.status).toBe(200);

      // Small delay for async processing
      await new Promise((r) => setTimeout(r, 50));

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].from).toBe("393491234567");
      expect(receivedMessages[0].text).toBe("Hello bot!");
      expect(receivedMessages[0].senderName).toBe("Test User");
      expect(receivedMessages[0].messageId).toBe("wamid.test123");
    } finally {
      await stopServer();
    }
  });

  it("processes an image with caption", async () => {
    await startServer({ webhookPort: 13104 });
    try {
      const payload = makeImagePayload("393491234567", "Check this out");
      const res = await postWebhook(payload, 13104);
      expect(res.status).toBe(200);

      await new Promise((r) => setTimeout(r, 50));

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].text).toBe("Check this out");
      expect(receivedMessages[0].media?.id).toBe("media_id_123");
      expect(receivedMessages[0].media?.mimeType).toBe("image/jpeg");
    } finally {
      await stopServer();
    }
  });

  it("processes an image without caption", async () => {
    await startServer({ webhookPort: 13105 });
    try {
      const payload = makeImagePayload("393491234567");
      const res = await postWebhook(payload, 13105);
      expect(res.status).toBe(200);

      await new Promise((r) => setTimeout(r, 50));

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].text).toBe("[📷 Image]");
    } finally {
      await stopServer();
    }
  });

  it("processes interactive button reply", async () => {
    await startServer({ webhookPort: 13106 });
    try {
      const payload = makeInteractivePayload(
        "393491234567",
        "button_reply",
        "btn_yes",
        "Yes"
      );
      const res = await postWebhook(payload, 13106);
      expect(res.status).toBe(200);

      await new Promise((r) => setTimeout(r, 50));

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].text).toBe("Yes");
      expect(receivedMessages[0].interactiveReply?.id).toBe("btn_yes");
      expect(receivedMessages[0].interactiveReply?.type).toBe("button_reply");
    } finally {
      await stopServer();
    }
  });

  // --- Access control ---

  it("allows all messages with dmPolicy=open", async () => {
    await startServer({ webhookPort: 13107, dmPolicy: "open" });
    try {
      const payload = makeTextPayload("unknown_number", "Hi");
      await postWebhook(payload, 13107);
      await new Promise((r) => setTimeout(r, 50));
      expect(receivedMessages).toHaveLength(1);
    } finally {
      await stopServer();
    }
  });

  it("blocks non-allowlisted numbers with dmPolicy=allowlist", async () => {
    await startServer({
      webhookPort: 13108,
      dmPolicy: "allowlist",
      allowFrom: ["+393491111111"],
    });
    try {
      const payload = makeTextPayload("393499999999", "Hi");
      await postWebhook(payload, 13108);
      await new Promise((r) => setTimeout(r, 50));
      expect(receivedMessages).toHaveLength(0);
    } finally {
      await stopServer();
    }
  });

  it("allows allowlisted numbers", async () => {
    await startServer({
      webhookPort: 13109,
      dmPolicy: "allowlist",
      allowFrom: ["+393491234567"],
    });
    try {
      const payload = makeTextPayload("393491234567", "Hello!");
      await postWebhook(payload, 13109);
      await new Promise((r) => setTimeout(r, 50));
      expect(receivedMessages).toHaveLength(1);
    } finally {
      await stopServer();
    }
  });

  // --- Signature verification ---

  it("rejects unsigned webhooks when appSecret is set", async () => {
    await startServer({ webhookPort: 13110 });
    try {
      const payload = makeTextPayload("393491234567", "Sneaky");
      const res = await postWebhook(payload, 13110, true); // skip signature
      expect(res.status).toBe(200); // Always 200 to Meta

      await new Promise((r) => setTimeout(r, 50));
      expect(receivedMessages).toHaveLength(0); // But message is NOT processed
      expect(mockLog.warn).toHaveBeenCalled();
    } finally {
      await stopServer();
    }
  });

  // --- Health check ---

  it("responds to health check", async () => {
    await startServer({ webhookPort: 13111 });
    try {
      const res = await fetch("http://localhost:13111/health");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe("ok");
      expect(data.channel).toBe("whatsapp-cloud");
    } finally {
      await stopServer();
    }
  });

  // --- 404 ---

  it("returns 404 for unknown paths", async () => {
    await startServer({ webhookPort: 13112 });
    try {
      const res = await fetch("http://localhost:13112/unknown");
      expect(res.status).toBe(404);
    } finally {
      await stopServer();
    }
  });
});
