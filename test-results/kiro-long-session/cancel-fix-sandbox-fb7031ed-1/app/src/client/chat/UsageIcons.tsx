import { CacheDataIcon } from "../DataIcons.js";
import type { CostLevel } from "./cost-level.js";

// Instance-local SVG animation remains active when Windows disables system motion.
// Only the activity outline pulses; the level always reflects actual input usage.
export function CacheUsageIcon({ active, percent = null }: { active: boolean; percent?: number | null }) {
  return <CacheDataIcon percent={percent} active={active} />;
}

/** Original chart-column-increasing geometry, split so only its bars carry state. */
export function CostUsageIcon({ level }: { level: CostLevel | null }) {
  const tones = [level != null ? "success" : "neutral", level != null && level >= 1 ? "warning" : "neutral", level != null && level >= 3 ? "danger" : "neutral"];
  return <svg className="ui-glyph cost-usage-icon" viewBox="2 2 20 20" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-level={level ?? "unknown"}>
    <path className="cost-axis" d="M3 3v16a2 2 0 0 0 2 2h16" />
    {["M8 17v-3", "M13 17V9", "M18 17V5"].map((d, index) => <path key={d} className="cost-bar" d={d} data-tone={tones[index]} data-pulse={(index === 1 && level === 1) || (index === 2 && level === 3) ? "true" : undefined} />)}
  </svg>;
}
