import assert from "node:assert/strict";
import { test } from "node:test";
import { clampImageScale, imageFitScale, imageScrollLayout, imageWheelScale, imageZoomAt } from "../src/client/chat/image-zoom.js";

test("fit uses real dimensions and does not enlarge small images", () => {
  assert.equal(imageFitScale({ width: 1000, height: 2000 }, { width: 800, height: 600 }), .276);
  assert.equal(imageFitScale({ width: 80, height: 60 }, { width: 800, height: 600 }), 1);
});
test("wheel is continuous, gentle, reversible and normalizes units", () => {
  const next = imageWheelScale(1, -100, 0, 600, .3);
  assert.ok(next > 1 && next < 1.06);
  assert.ok(Math.abs(imageWheelScale(next, 100, 0, 600, .3) - 1) < 1e-10);
  assert.ok(imageWheelScale(1, -1, 0, 600, .3) < imageWheelScale(1, -2, 0, 600, .3));
  assert.equal(imageWheelScale(1, -3, 1, 600, .3), imageWheelScale(1, -48, 0, 600, .3));
  assert.equal(imageWheelScale(1, -.1, 2, 600, .3), imageWheelScale(1, -60, 0, 600, .3));
  assert.equal(imageWheelScale(1, -10000, 0, 600, .3), next);
});
test("zoom bounds allow fit below minimum without a first-gesture jump", () => {
  assert.equal(clampImageScale(10, .3), 3);
  assert.equal(clampImageScale(0, .3), .05);
  assert.equal(clampImageScale(0, .002), .002);
  assert.ok(imageWheelScale(.002, -10, 0, 600, .002) < .0021);
});
test("pointer anchor survives both fit and overflow, with exact scroll projection", () => {
  const viewport = { width: 800, height: 600 }, image = { width: 1000, height: 2000 };
  for (const scale of [.05, .276, 1, 3]) {
    const before = { scale, x: (800 - 1000 * scale) / 2, y: (600 - 2000 * scale) / 2 };
    for (const point of [{ x: 300, y: 120 }, { x: 720, y: 550 }]) {
      const after = imageZoomAt(before, scale * 1.05, point);
      assert.ok(Math.abs((point.x - before.x) / before.scale - (point.x - after.x) / after.scale) < 1e-8);
      assert.ok(Math.abs((point.y - before.y) / before.scale - (point.y - after.y) / after.scale) < 1e-8);
      const layout = imageScrollLayout(after, image, viewport);
      assert.equal(layout.x - layout.scrollX, after.x);
      assert.equal(layout.y - layout.scrollY, after.y);
      assert.ok(Number.isInteger(layout.scrollX) && Number.isInteger(layout.scrollY));
      assert.ok(layout.x >= 24 && layout.y >= 24);
      assert.ok(layout.width >= viewport.width + layout.scrollX && layout.height >= viewport.height + layout.scrollY);
    }
  }
});
