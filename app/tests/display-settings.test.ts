import assert from "node:assert/strict";
import { test } from "node:test";
import postcss from "postcss";
import { displayTypography } from "../scripts/display-typography.js";
import { displayColor } from "../src/client/display-colors.js";
import { defaultDisplaySettings, normalizeDisplaySettings } from "../src/client/display-settings.js";

test("display preferences tolerate corrupt data, retain continuous scale and clamp bounds", () => {
  for (const value of [null, false, "bad", [], { fontScale: "150", contrast: NaN, brightness: Infinity, fontFamily: "bad" }]) assert.deepEqual(normalizeDisplaySettings(value), defaultDisplaySettings);
  assert.deepEqual(normalizeDisplaySettings({ fontScale: 1000, brightness: -1, contrast: 123.6, fontFamily: "mono" }), { fontScale: 200, brightness: 40, contrast: 124, fontFamily: "mono" });
  assert.equal(normalizeDisplaySettings({ fontScale: 101.234 }).fontScale, 101.23);
});

test("scaling coordinates text and geometry while preserving viewports, hairlines and breakpoints", async () => {
  const css = '.a{font:500 12px/20px var(--font-mono);width:32px;padding:8px 12px;gap:6px;border:1px solid #fff;margin-top:-12px;max-width:90vw}.b{font-size:1em;line-height:1.6}@media(max-width:600px){.a{height:44px}}:root{--space-2:8px;--thread-line-height:24px}';
  const result = await postcss([displayTypography()]).process(css, { from: undefined });
  for (const value of ['calc(12px * var(--display-font-scale, 1))', 'width:calc(32px * var(--display-font-scale, 1))', 'padding:calc(8px * var(--display-font-scale, 1))', 'gap:calc(6px * var(--display-font-scale, 1))', 'calc(-12px * var(--display-font-scale, 1))', 'border:1px solid', 'max-width:90vw', '@media(max-width:600px)', 'font-size:1em;line-height:1.6', '--space-2:calc(8px * var(--display-font-scale, 1))']) assert.ok(result.css.includes(value), value);
  assert.equal((await postcss([displayTypography()]).process(result.css, { from: undefined })).css, result.css);
});

test("color compilation covers literals without touching strings, URLs or alpha", async () => {
  const result = await postcss([displayTypography()]).process('.a{color:#abc;background:rgba(0,0,0,.4);border:1px solid white;--muted:#8a8f98;content:"white #fff";background-image:url("/white.svg#fff")}', { from: undefined });
  assert.ok(result.css.includes('color:var(--display-color-aabbccff, #abc)'));
  assert.match(result.css, /:root\s*\{[^}]*--display-color-aabbccff:\s*#aabbccff/);
  assert.ok(result.css.includes('--display-color-00000066'));
  assert.ok(result.css.includes('content:"white #fff"'));
  assert.ok(result.css.includes('url("/white.svg#fff")'));
  assert.equal((await postcss([displayTypography()]).process(result.css, { from: undefined })).css, result.css);
});

test("reused build plugin keeps each stylesheet's palette isolated", async () => {
  const processor = postcss([displayTypography()]);
  await processor.process('.a{color:#abc}', { from: undefined });
  const next = await processor.process('.b{color:#123}', { from: undefined });
  assert.ok(next.css.includes('--display-color-112233ff'));
  assert.ok(!next.css.includes('--display-color-aabbccff'));
});

const luminance = (hex: string) => [1, 3, 5].reduce((sum, offset, i) => {
  const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return sum + (c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i];
}, 0);
test("tone adjustments keep text readable at range corners and preserve original colors at default", () => {
  assert.equal(displayColor("8a8f98ff", defaultDisplaySettings), "#8a8f98ff");
  for (const brightness of [40, 75, 100, 150, 200]) for (const contrast of [50, 100, 150, 200]) {
    const settings = { brightness, contrast };
    const background = displayColor("191a1bff", settings);
    for (const hex of ["f7f8f8ff", "d0d6e0ff", "8a8f98ff"]) {
      const foreground = displayColor(hex, settings);
      assert.ok((luminance(foreground) + .05) / (luminance(background) + .05) >= 4.5, `${brightness}/${contrast}: ${foreground} on ${background}`);
    }
    assert.ok(displayColor("ffffff14", settings).endsWith("14"));
    const lightSettings = { brightness, contrast, theme: "light" as const };
      for (const [fg, bg] of [["646c65ff", "f7f6f3ff"], ["806120ff", "f7f6f3ff"], ["ffffffff", "a94f1dff"], ["454b46ff", "ffffffff"]]) {
        const a = luminance(displayColor(fg, lightSettings)), b = luminance(displayColor(bg, lightSettings));
        assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `light ${brightness}/${contrast}: ${fg} on ${bg}`);
      }
    }
});
