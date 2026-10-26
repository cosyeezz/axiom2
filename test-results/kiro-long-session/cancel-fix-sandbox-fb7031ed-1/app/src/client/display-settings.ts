import { displayColor } from "./display-colors.js";
import { customFontFamily, getFontLibrary, initializeFontLibrary, isCustomFontId, subscribeFontLibrary, type CustomFontId } from "./font-library.js";

export const DISPLAY_STORAGE_KEY = "axiom.display.v1";
export const displayRanges = {
  fontScale: { min: 50, max: 200, step: .1 },
  brightness: { min: 40, max: 200, step: 1 },
  contrast: { min: 50, max: 200, step: 1 },
} as const;
export const fontOptions = [
  { value: "default", label: "默认字体" },
  { value: "system", label: "系统字体" },
  { value: "serif", label: "衬线字体" },
  { value: "mono", label: "等宽字体" },
];
export type DisplaySettings = {
  fontScale: number;
  brightness: number;
  contrast: number;
  fontFamily: "default" | "system" | "serif" | "mono" | CustomFontId;
};
export const defaultDisplaySettings: DisplaySettings = {
  fontScale: 100, brightness: 100, contrast: 100, fontFamily: "default",
};
export function normalizeDisplaySettings(value: unknown): DisplaySettings {
  const source = value && typeof value === "object" ? value as Partial<DisplaySettings> : {};
  const result = { ...defaultDisplaySettings };
  for (const key of ["fontScale", "brightness", "contrast"] as const) {
    const number = source[key], { min, max } = displayRanges[key];
    const precision = key === "fontScale" ? 100 : 1;
    if (typeof number === "number" && Number.isFinite(number)) result[key] = Math.min(max, Math.max(min, Math.round(number * precision) / precision));
  }
  if (fontOptions.some(option => option.value === source.fontFamily) || isCustomFontId(source.fontFamily)) result.fontFamily = source.fontFamily!;
  return result;
}
function readSettings(): DisplaySettings {
  try { return normalizeDisplaySettings(JSON.parse(localStorage.getItem(DISPLAY_STORAGE_KEY) || "null")); }
  catch { return { ...defaultDisplaySettings }; }
}
let settings = readSettings();
let fontSelectionRevision = 0;
export function getFontSelectionRevision() { return fontSelectionRevision; }
let storageAvailable = true;
const listeners = new Set<() => void>();
const fonts = {
  system: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: '"Songti SC", "Noto Serif CJK SC", "STSong", Georgia, serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace',
};
let palette: string[] = [], paletteKey = "";
function applyColors(refresh = false) {
  const root = document.documentElement;
  if (refresh || !palette.length) palette = Array.from(getComputedStyle(root)).filter(name => /^--display-color-[\da-f]{8}$/.test(name));
  const theme = root.dataset.theme === "light" ? "light" : "dark";
  const key = `${theme}:${settings.brightness}:${settings.contrast}`;
  if (!refresh && key === paletteKey) return;
  paletteKey = key;
  for (const name of palette) {
    if (settings.brightness === 100 && settings.contrast === 100) root.style.removeProperty(name);
    else root.style.setProperty(name, displayColor(name.slice(-8), { ...settings, theme }));
  }
}
function apply() {
  const style = document.documentElement.style;
  style.setProperty("--display-font-scale", String(settings.fontScale / 100));
  style.setProperty("--display-content-scale", String(settings.fontScale / 100));
  applyColors();
  for (const property of ["--font-body", "--font-display"]) {
    if (settings.fontFamily === "default") style.removeProperty(property);
    else style.setProperty(property, isCustomFontId(settings.fontFamily) ? customFontFamily(settings.fontFamily) : fonts[settings.fontFamily]);
  }
}
function save() {
  try { localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(settings)); storageAvailable = true; }
  catch { storageAvailable = false; }
}
export function getDisplaySettings() { return settings; }
export function isDisplayStorageAvailable() { return storageAvailable; }
export function subscribeDisplaySettings(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function update(patch: Partial<DisplaySettings>, persist: boolean) {
  if (patch.fontFamily !== undefined) ++fontSelectionRevision;
  settings = normalizeDisplaySettings({ ...settings, ...patch });
  apply();
  if (persist) save();
  listeners.forEach(listener => listener());
}
export function setDisplaySettings(patch: Partial<DisplaySettings>) { update(patch, true); }

export function initializeDisplaySettings() {
  applyColors(true); apply();
  const stopFonts = subscribeFontLibrary(() => {
    const library = getFontLibrary();
    if (!library.loading && library.available && isCustomFontId(settings.fontFamily) && !library.fonts.some(font => font.id === settings.fontFamily)) {
      setDisplaySettings({ fontFamily: "default" });
    }
  });
  void initializeFontLibrary();
  // Late-loaded page styles can contribute colors, without per-frame CSS scans.
  const refreshColors = () => applyColors(true);
  const styles = new MutationObserver(refreshColors);
  styles.observe(document.head, { childList: true, subtree: true, characterData: true });
  styles.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  document.head.addEventListener("load", refreshColors, true);
  const storage = (event: StorageEvent) => {
    if (event.key !== DISPLAY_STORAGE_KEY && event.key !== null) return;
    const next = readSettings();
    if (next.fontFamily !== settings.fontFamily) ++fontSelectionRevision;
    settings = next; apply(); listeners.forEach(listener => listener());
  };
  let target: number | undefined, frame = 0, lastFrame = 0, wheelUpdating = false;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const persistWheel = () => { clearTimeout(saveTimer); save(); listeners.forEach(listener => listener()); };
  const stopWheel = subscribeDisplaySettings(() => {
    if (wheelUpdating) return;
    cancelAnimationFrame(frame); frame = 0; target = undefined; lastFrame = 0;
  });
  const animate = (now: number) => {
    frame = 0;
    if (target === undefined) return;
    const elapsed = lastFrame ? Math.min(32, now - lastFrame) : 16;
    lastFrame = now;
    const next = settings.fontScale + (target - settings.fontScale) * (1 - Math.exp(-elapsed / 45));
    const finished = Math.abs(target - next) < .03;
    wheelUpdating = true;
    update({ fontScale: finished ? target : next }, false);
    wheelUpdating = false;
    window.dispatchEvent(new Event("axiom:font-scale"));
    if (finished) { target = undefined; lastFrame = 0; saveTimer = setTimeout(persistWheel, 160); }
    else frame = requestAnimationFrame(animate);
  };
  const wheel = (event: WheelEvent) => {
    if ((!event.ctrlKey && !event.metaKey) || event.altKey || !event.deltaY || !event.cancelable) return;
    event.preventDefault(); event.stopPropagation();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
    target = Math.max(50, Math.min(200, (target ?? settings.fontScale) - Math.max(-240, Math.min(240, delta)) * .05));
    clearTimeout(saveTimer);
    if (!frame) frame = requestAnimationFrame(animate);
  };
  const reset = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.code === "Digit0") {
      event.preventDefault(); clearTimeout(saveTimer); setDisplaySettings({ fontScale: 100 });
      window.dispatchEvent(new Event("axiom:font-scale"));
    }
  };
  const flush = () => {
    if (target !== undefined) settings = normalizeDisplaySettings({ ...settings, fontScale: target });
    clearTimeout(saveTimer); save();
  };
  window.addEventListener("storage", storage);
  window.addEventListener("wheel", wheel, { passive: false, capture: true });
  window.addEventListener("keydown", reset);
  window.addEventListener("pagehide", flush);
  return () => {
    flush(); cancelAnimationFrame(frame); stopWheel(); stopFonts(); styles.disconnect();
    document.head.removeEventListener("load", refreshColors, true);
    window.removeEventListener("storage", storage);
    window.removeEventListener("wheel", wheel, true);
    window.removeEventListener("keydown", reset);
    window.removeEventListener("pagehide", flush);
  };
}
