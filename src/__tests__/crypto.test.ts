import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyWebhookSignature } from "../crypto.js";

const APP_SECRET = "test_app_secret_1234567890";

function sign(body: string, secret: string = APP_SECRET): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyWebhookSignature", () => {
  it("accepts a valid signature", () => {
    const body = '{"object":"whatsapp_business_account"}';
    const sig = sign(body);
    expect(verifyWebhookSignature(body, sig, APP_SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = '{"object":"whatsapp_business_account"}';
    const sig = sign(body);
    const tampered = '{"object":"whatsapp_business_account","extra":true}';
    expect(verifyWebhookSignature(tampered, sig, APP_SECRET)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const body = '{"test":true}';
    const sig = sign(body, "wrong_secret");
    expect(verifyWebhookSignature(body, sig, APP_SECRET)).toBe(false);
  });

  it("rejects missing signature header", () => {
    expect(verifyWebhookSignature("{}", undefined, APP_SECRET)).toBe(false);
  });

  it("rejects missing app secret", () => {
    const body = "{}";
    const sig = sign(body);
    expect(verifyWebhookSignature(body, sig, "")).toBe(false);
  });

  it("rejects a malformed signature", () => {
    expect(verifyWebhookSignature("{}", "not-a-valid-sig", APP_SECRET)).toBe(false);
  });

  it("handles unicode body correctly", () => {
    const body = '{"text":"Ciao! 🦞 Come stai?"}';
    const sig = sign(body);
    expect(verifyWebhookSignature(body, sig, APP_SECRET)).toBe(true);
  });
});
