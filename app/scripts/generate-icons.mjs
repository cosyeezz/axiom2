// Regenerate platform assets from the approved SVG. Run from any directory.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

const app = fileURLToPath(new URL("../", import.meta.url));
const svg = await readFile(join(app, "assets/axiom-icon.svg"), "utf8");
const publicDir = join(app, "src/client/public");
async function save(path, data) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, data); }
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AXIOM_TEST_BROWSER ? { executablePath: process.env.AXIOM_TEST_BROWSER } : process.platform === "win32" ? { channel: "msedge" } : {}),
});
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const images = new Map();
  for (const size of [16, 24, 32, 48, 64, 128, 180, 192, 256, 512, 1024]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    images.set(size, await page.screenshot({ omitBackground: true }));
  }
  await save(join(app, "desktop/icon.png"), images.get(1024));
  await save(join(publicDir, "favicon.svg"), svg);
  await save(join(publicDir, "apple-touch-icon.png"), images.get(180));
  for (const size of [192, 512]) await save(join(publicDir, `icon-${size}.png`), images.get(size));
  // ICO directory entries with native-resolution PNG payloads (Windows Vista+).
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const at = 6 + index * 16, png = images.get(size);
    header[at] = header[at + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(png.length, at + 8); header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  await save(join(publicDir, "favicon.ico"), Buffer.concat([header, ...sizes.map(size => images.get(size))]));

  // Android VectorDrawable preserves the same paths, transforms and gradients.
  const vector = await page.evaluate(() => {
    const root = document.querySelector("svg");
    const gradient = (id, attribute) => {
      const node = root.querySelector(`#${id}`);
      const stops = [...node.querySelectorAll("stop")].map(stop => {
        const alpha = Math.round(Number(stop.getAttribute("stop-opacity") ?? 1) * 255).toString(16).padStart(2, "0");
        return `<item android:offset="${stop.getAttribute("offset") ?? 0}" android:color="#${alpha}${stop.getAttribute("stop-color").slice(1)}"/>`;
      }).join("");
      return `<aapt:attr name="android:${attribute}"><gradient android:type="linear" android:startX="${node.getAttribute("x1")}" android:startY="${node.getAttribute("y1")}" android:endX="${node.getAttribute("x2")}" android:endY="${node.getAttribute("y2")}">${stops}</gradient></aapt:attr>`;
    };
    const mark = root.querySelector(":scope > path");
    // Consolidate only the mark's local SVG transform, not the rendering viewport scale.
    const matrix = mark.transform.baseVal.consolidate().matrix;
    if (matrix.b !== 0 || matrix.c !== 0) throw Error("Android icon generator expects an axis-aligned mark transform");
    const wing = `<group android:scaleX="${matrix.a}" android:scaleY="${matrix.d}" android:translateX="${matrix.e}" android:translateY="${matrix.f}"><path android:pathData="${mark.getAttribute("d")}">${gradient("gold", "fillColor")}</path></group>`;
    return `<vector xmlns:android="http://schemas.android.com/apk/res/android" xmlns:aapt="http://schemas.android.com/aapt" android:width="108dp" android:height="108dp" android:viewportWidth="512" android:viewportHeight="512">\n${wing}\n</vector>\n`;
  });
  await save(join(app, "android/app/src/main/res/drawable/ic_launcher.xml"), vector);
  console.log("Generated desktop PNG, browser SVG/ICO, home-screen PNGs and Android vector from app/assets/axiom-icon.svg");
} finally { await browser.close(); }
