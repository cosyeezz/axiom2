import assert from "node:assert/strict";
import { test } from "node:test";
import { UsageQueryCache } from "../src/server/usage-query-cache.js";

test("query memo isolates input and output object mutations", () => {
  const cache = new UsageQueryCache<{ total: { records: number } }>();
  const value = { total: { records: 2 } }; cache.set("a", value); value.total.records = 10;
  const read = cache.get("a")!; assert.equal(read.total.records, 2); read.total.records = 20;
  assert.equal(cache.get("a")!.total.records, 2);
  cache.clear(); assert.equal(cache.get("a"), undefined);
});
test("query memo evicts the least recently used filter and replaces in place", () => {
  const cache = new UsageQueryCache<{ n: number }>(2);
  cache.set("a", { n: 1 }); cache.set("b", { n: 2 }); cache.get("a"); cache.set("c", { n: 3 });
  assert.equal(cache.get("b"), undefined); assert.equal(cache.get("a")?.n, 1);
  cache.set("a", { n: 4 }); assert.equal(cache.get("a")?.n, 4); assert.equal(cache.get("c")?.n, 3);
});
test("query memo bounds serialized UTF-8 bytes and refuses oversized replacements", () => {
  const cache = new UsageQueryCache<{ s: string }>(8, 30);
  cache.set("a", { s: "三三三" }); cache.set("b", { s: "四四四" });
  assert.equal(cache.get("a"), undefined); assert.equal(cache.get("b")?.s, "四四四");
  cache.set("b", { s: "多".repeat(20) }); assert.equal(cache.get("b"), undefined);
  cache.set("c", { s: "small" }); assert.equal(cache.get("c")?.s, "small");
});
