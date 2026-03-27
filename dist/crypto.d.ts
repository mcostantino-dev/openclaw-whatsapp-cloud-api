/**
 * Verify the X-Hub-Signature-256 header from Meta webhook requests.
 *
 * Meta signs every webhook payload with HMAC-SHA256 using your App Secret.
 * Always validate this in production to prevent forged webhook calls.
 *
 * @see https://developers.facebook.com/docs/graph-api/webhooks/getting-started#event-notifications
 */
export declare function verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined, appSecret: string): boolean;
