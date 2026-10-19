import { CacheDataIcon } from "../DataIcons.js";

// Instance-local SVG animation remains active when Windows disables system motion.
// Only the activity outline pulses; the level always reflects actual input usage.
export function CacheUsageIcon({ active, percent = null }: { active: boolean; percent?: number | null }) {
  return <CacheDataIcon percent={percent} active={active} />;
}
