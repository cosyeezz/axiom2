import assert from "node:assert/strict";
import test from "node:test";
import catalog from "../src/client/font-catalog.json" with { type: "json" };
import { onlineFonts, fontCatalogCommit } from "../src/client/online-fonts.js";
import { isCustomFontId, MAX_FONT_BYTES } from "../src/client/font-library.js";

test("catalog has unique compatible IDs and pinned, licensed complete font files", () => {
  assert.match(fontCatalogCommit, /^[a-f0-9]{40}$/);
  assert.equal(new Set(catalog.fonts.map(font => font.family)).size, catalog.fonts.length);
  assert.equal(new Set(onlineFonts.map(font => font.id)).size, onlineFonts.length);
  assert.equal(onlineFonts.length, catalog.fonts.length);
  assert.ok(onlineFonts.length > 1000);
  for (const font of catalog.fonts) {
    assert.ok(isCustomFontId(font.id));
    assert.match(font.path, /^(ofl|apache)\/[a-z0-9]+\/[^/]+\.(ttf|otf)$/i);
    assert.match(font.licensePath, /^(ofl|apache)\/[a-z0-9]+\/(OFL\.txt|LICENSE\.txt|LICENSE)$/);
    assert.equal(font.path.split("/")[1], font.licensePath.split("/")[1]);
    assert.ok(font.size > 0 && font.size <= Math.min(catalog.maxFontBytes, MAX_FONT_BYTES));
    assert.ok(["OFL-1.1", "Apache-2.0"].includes(font.license));
    assert.match(font.blobSha, /^[a-f0-9]{40}$/);
  }
  for (const font of onlineFonts) {
    assert.ok(font.url.startsWith(`https://raw.githubusercontent.com/google/fonts/${fontCatalogCommit}/`));
    assert.ok(font.licenseUrl.includes(fontCatalogCommit));
    assert.deepEqual(font.languages, catalog.fonts.find(item => item.id === font.id)?.subsets);
  }
  for (const id of ["custom:noto-sans-sc", "custom:noto-serif-sc", "custom:inter", "custom:lora"]) assert.equal(onlineFonts.filter(font => font.id === id).length, 1);
});

test("Chinese filtering and aliases refer to explicitly declared language support", () => {
  const chinese = onlineFonts.filter(font => font.languages?.some(value => value.startsWith("chinese-")));
  assert.ok(chinese.length >= 20);
  assert.ok(chinese.some(font => font.name.includes("霞鹜文楷")));
  assert.ok(chinese.some(font => font.name.includes("站酷")));
  assert.ok(chinese.some(font => font.category === "handwriting"));
  assert.equal(onlineFonts.find(font => font.id === "custom:noto-sans-sc")?.variable, true);
  assert.equal(onlineFonts.find(font => font.id === "custom:noto-sans-sc")?.weight, 400);
  assert.equal(onlineFonts.find(font => font.id === "custom:inter")?.languages?.some(value => value.startsWith("chinese")), false);
});
