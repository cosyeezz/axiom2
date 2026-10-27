import type { SettingsManager } from "@earendil-works/pi-coding-agent";

type CompactionModel = { provider: string; id: string; contextWindow: number };
export const nativeCompactionPercent = 70;

/** Pi owns the checks, summary and commit. Only adapt its public settings getter:
 * a fixed reserve would drift with model switches, and reload clears overrides.
 * Keep this independent of Axiom's optional asynchronous compression policy.
 */
export function installNativeCompactionPolicy(
  settings: Pick<SettingsManager, "getCompactionSettings">,
  currentModel: () => CompactionModel | undefined,
) {
  const getSettings = settings.getCompactionSettings.bind(settings);
  settings.getCompactionSettings = (requested) => {
    const resolved = getSettings(requested);
    const model = currentModel();
    if (!model || (requested && (requested.provider !== model.provider || requested.id !== model.id)) ||
        !Number.isSafeInteger(model.contextWindow) || model.contextWindow <= 0)
      return { ...resolved, enabled: false };
    return { ...resolved,
      reserveTokens: model.contextWindow - Math.floor(model.contextWindow * nativeCompactionPercent / 100) };
  };
}
