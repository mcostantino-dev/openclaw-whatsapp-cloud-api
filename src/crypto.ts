import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify the X-Hub-Signature-256 header from Meta webhook requests.
 *
 * Meta signs every webhook payload with HMAC-SHA256 using your App Secret.
 * Always validate this in production to prevent forged webhook calls.
 *
 * @see https://developers.facebook.com/docs/graph-api/webhooks/getting-started#event-notifications
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  if (!signatureHeader || !appSecret) return false;

  const expectedSignature =
    "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");

  // Use timing-safe comparison to prevent timing attacks
  try {
    const sigBuffer = Buffer.from(signatureHeader);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (sigBuffer.length !== expectedBuffer.length) return false;

    return timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    return false;
  }
}
