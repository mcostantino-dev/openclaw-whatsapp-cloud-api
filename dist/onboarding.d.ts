interface WizardPrompter {
    intro: (title: string) => Promise<void>;
    outro: (message: string) => Promise<void>;
    note: (message: string, title?: string) => Promise<void>;
    select: <T>(params: {
        message: string;
        options: Array<{
            value: T;
            label: string;
            hint?: string;
        }>;
        initialValue?: T;
    }) => Promise<T>;
    text: (params: {
        message: string;
        initialValue?: string;
        placeholder?: string;
        validate?: (value: string) => string | undefined;
    }) => Promise<string>;
    confirm: (params: {
        message: string;
        initialValue?: boolean;
    }) => Promise<boolean>;
    progress: (label: string) => {
        update: (message: string) => void;
        stop: (message?: string) => void;
    };
}
type DmPolicy = "pairing" | "allowlist" | "open" | "disabled";
interface OnboardingStatusContext {
    cfg: any;
    options?: any;
    accountOverrides: Partial<Record<string, string>>;
}
interface OnboardingConfigureContext {
    cfg: any;
    runtime: any;
    prompter: WizardPrompter;
    options?: any;
    accountOverrides: Partial<Record<string, string>>;
    shouldPromptAccountIds: boolean;
    forceAllowFrom: boolean;
}
interface OnboardingResult {
    cfg: any;
    accountId?: string;
}
interface OnboardingDmPolicy {
    label: string;
    channel: string;
    policyKey: string;
    allowFromKey: string;
    getCurrent: (cfg: any) => DmPolicy;
    setPolicy: (cfg: any, policy: DmPolicy) => any;
    promptAllowFrom?: (params: {
        cfg: any;
        prompter: WizardPrompter;
        accountId?: string;
    }) => Promise<any>;
}
export declare const whatsappCloudOnboardingAdapter: {
    channel: string;
    dmPolicy: OnboardingDmPolicy;
    getStatus: ({ cfg }: OnboardingStatusContext) => Promise<{
        channel: string;
        configured: boolean;
        statusLines: string[];
        selectionHint: string;
    }>;
    configure: ({ cfg, prompter }: OnboardingConfigureContext) => Promise<OnboardingResult>;
    disable: (cfg: any) => any;
};
export {};
