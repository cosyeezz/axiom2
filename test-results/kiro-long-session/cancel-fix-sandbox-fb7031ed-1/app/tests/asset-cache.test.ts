import assert from "node:assert/strict";
import test from "node:test";
import { assetCacheControl } from "../src/server/asset-cache.js";

test("only hashed build assets get private immutable browser caching", () => {
  for (const path of ["/assets/index-ABc_1234.js", "/assets/Settings-aBc12345.css", "/assets/font-name-A_12-abc.woff2", "/assets/font-catalog-A_12-abc.json"]) {
    assert.equal(assetCacheControl(path), "private, max-age=31536000, immutable", path);
  }
  for (const path of ["/", "/index.html", "/settings.html", "/assets/index.html", "/api/status", "/api/remote", "/api/configuration", "/assets/font-catalog.json", "/assets/configuration-12345678.json", "/assets/font-catalog-abcd.json", "/assets/unversioned.js", "/assets/foo-abcd.js", "/assets/../index-12345678.js", "/other/index-12345678.js", "/assets/index-12345678.js.map"]) {
    assert.equal(assetCacheControl(path), "no-store", path);
  }
});

test("changed content uses a distinct URL rather than invalidating cached code in place", () => {
  assert.equal(assetCacheControl("/assets/Settings-old12345.js"), assetCacheControl("/assets/Settings-new12345.js"));
  assert.equal(assetCacheControl("/settings.html"), "no-store");
});
