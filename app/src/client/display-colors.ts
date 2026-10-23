type ColorSettings = { brightness: number; contrast: number; theme?: "dark" | "light" };
const luminance = (channels: number[]) => channels.reduce((sum, channel, i) => {
  const value = channel / 255;
  return sum + (value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i];
}, 0);

/** Smooth bounded tone curves retain color levels; unlike a filter, these colors
 * are resolved before the browser rasterizes glyphs and their antialiased edges. */
export function displayColor(hex: string, settings: ColorSettings): string {
  const original = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  if (settings.brightness === 100 && settings.contrast === 100) return `#${hex}`;
  const contrast = Math.sqrt(settings.contrast / 100), brightness = settings.brightness / 100;
  const tone = (channel: number) => {
    const value = channel / 255;
    const a = value ** contrast, b = (1 - value) ** contrast;
    const contrasted = a / (a + b);
    return 255 * (brightness < 1 ? contrasted * Math.sqrt(brightness) : contrasted ** (1 / Math.sqrt(brightness)));
  };
  let adjusted = original.map(tone);
  // Protect foregrounds against the theme's least contrasting main surface.
  // Alpha stays intact for borders/shadows; native glyph antialiasing is untouched.
  const light = settings.theme === "light";
  const background = luminance((light ? [240, 238, 234] : [25, 26, 27]).map(tone));
  const ratio = (channels: number[]) => light
    ? (background + .05) / (luminance(channels) + .05)
    : (luminance(channels) + .05) / (background + .05);
  const foreground = light ? luminance(original) <= .4 : luminance(original) >= .18;
  if (foreground && hex.slice(6) === "ff" && ratio(adjusted) < 4.8) {
    const endpoint = light ? 0 : 255;
    let low = 0, high = 1;
    for (let i = 0; i < 12; i++) {
      const mix = (low + high) / 2;
      if (ratio(adjusted.map(value => value + (endpoint - value) * mix)) < 4.8) low = mix;
      else high = mix;
    }
    adjusted = adjusted.map(value => value + (endpoint - value) * high);
  }
  return `#${adjusted.map(value => Math.round(value).toString(16).padStart(2, "0")).join("")}${hex.slice(6)}`;
}
