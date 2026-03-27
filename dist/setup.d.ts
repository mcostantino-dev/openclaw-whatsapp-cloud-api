import type { WhatsAppCloudConfig, Logger } from "./types.js";
/** Minimal prompter interface compatible with OpenClaw's CLI toolkit */
interface Prompter {
    input(message: string, options?: {
        default?: string;
    }): Promise<string>;
    password(message: string): Promise<string>;
    confirm(message: string, options?: {
        default?: boolean;
    }): Promise<boolean>;
    select<T>(message: string, choices: Array<{
        name: string;
        value: T;
    }>): Promise<T>;
}
export interface SetupResult {
    phoneNumberId: string;
    businessAccountId: string;
    accessToken: string;
    appSecret: string;
    verifyToken: string;
    webhookPort: number;
    webhookPath: string;
    dmPolicy: "open" | "allowlist";
}
/**
 * Run the interactive setup wizard.
 * Returns the config values to be saved under channels.whatsapp-cloud.
 */
export declare function runSetupWizard(prompter?: Prompter, log?: Logger): Promise<SetupResult>;
/**
 * Validate an existing config and report what's missing.
 */
export declare function validateConfig(config: Partial<WhatsAppCloudConfig>): {
    valid: boolean;
    errors: string[];
    warnings: string[];
};
export {};
