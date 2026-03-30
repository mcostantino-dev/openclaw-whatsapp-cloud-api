// ---------------------------------------------------------------------------
// Runtime accessor — stores the PluginRuntime reference provided by OpenClaw
// ---------------------------------------------------------------------------
// PluginRuntime is provided by OpenClaw at load time via api.runtime.
// We store it here so all modules can access it without circular deps.
let runtime = null;
export function setWhatsAppCloudRuntime(next) {
    runtime = next;
}
export function getWhatsAppCloudRuntime() {
    if (!runtime) {
        throw new Error("WhatsApp Cloud runtime not initialized — plugin not loaded correctly");
    }
    return runtime;
}
