import type { SettingsManager } from "@earendil-works/pi-coding-agent";

/** Install once per worker settings instance, before creating its SDK session.
 * Pi's warmer reads this public global-only getter, not applyOverrides(). Keep
 * storage/reload/save and every other provider's warming policy unchanged.
 */
export function disableKiroCacheWarming(
  settings: Pick<SettingsManager, "getCacheWarmingMode">,
  currentModel: () => { provider: string } | undefined,
) {
  const getMode = settings.getCacheWarmingMode.bind(settings);
  settings.getCacheWarmingMode = () => currentModel()?.provider === "kiro" ? "off" : getMode();
}
