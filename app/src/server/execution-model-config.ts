/** Execution captures only the chosen provider. A broken neighbour is not a global gate. */
export function executionModelsRaw(raw: string, provider?: string): string {
  try {
    const config = JSON.parse(raw.replace(/^\uFEFF/, ""));
    if (!config || typeof config !== "object" || !config.providers || typeof config.providers !== "object" || Array.isArray(config.providers)) return raw;
    if (!provider) return JSON.stringify(config);
    return JSON.stringify({ providers: Object.hasOwn(config.providers, provider) ? { [provider]: config.providers[provider] } : {} });
  } catch {
    // Keep the failure local to the eventual model request; resource operations
    // still need a session even while its model configuration is being repaired.
    return raw;
  }
}
