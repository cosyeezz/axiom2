import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, linkSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { usageModelNames } from "../src/server/model-metadata.js";
import { modelDisplay } from "../src/shared/model-display.js";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "axiom-usage-names-"));
  return { dir, write: (name: string, value: unknown) => writeFileSync(join(dir, name), JSON.stringify(value)), close: () => rmSync(dir, { recursive: true, force: true }) };
}
const row = (provider: string | null, model: string | null) => ({ provider, model, total: { records: 2, knownCost: 1.25 } });

test("usage names preserve local copy identities and prefer explicit overrides, definitions, then local catalog", t => {
  const f = fixture(); t.after(f.close);
  f.write("models.json", { providers: {
    openai: { apiKey: "!touch NEVER_EXECUTE", headers: { secret: "PRIVATE_HEADER" }, models: [
      { id: "axiom-copy-a", axiomRequestModelId: "gpt-upstream", name: "我的高强度模型" },
      { id: "axiom-copy-b", axiomRequestModelId: "gpt-upstream", name: "我的低强度模型" },
      { id: "upstream-fallback", axiomRequestModelId: "gpt-upstream" },
    ], modelOverrides: { "axiom-copy-a": { name: "覆盖名称" } } },
    other: { models: [{ id: "axiom-copy-a", name: "另一连接同 ID" }] },
  } });
  f.write("models-store.json", { openai: { models: [{ id: "gpt-upstream", name: "GPT 本地目录名称", apiKey: "PRIVATE_CATALOG" }, { id: "catalog-only", name: "目录模型" }] } });
  writeFileSync(join(f.dir, "auth.json"), "PRIVATE_AUTH_IS_NOT_EVEN_JSON");
  const original = [row("openai", "axiom-copy-a"), row("openai", "axiom-copy-b"), row("openai", "gpt-upstream"), row("openai", "catalog-only"), row("other", "axiom-copy-a"), row("openai", "upstream-fallback")];
  const snapshot = structuredClone(original), files = readdirSync(f.dir).map(name => [name, readFileSync(join(f.dir, name), "utf8")] as const);
  const result = usageModelNames(f.dir, original);
  assert.deepEqual(result.map(item => item.name), ["覆盖名称", "我的低强度模型", "GPT 本地目录名称", "目录模型", "另一连接同 ID", undefined]);
  assert.deepEqual(result.map(({ name: _name, ...rest }) => rest), snapshot);
  assert.deepEqual(original, snapshot);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|NEVER_EXECUTE|headers|models\.json/);
  assert.deepEqual(readdirSync(f.dir), files.map(([name]) => name));
  for (const [name, content] of files) assert.equal(readFileSync(join(f.dir, name), "utf8"), content);
  assert.equal(existsSync(join(f.dir, "NEVER_EXECUTE")), false);
});

test("missing, corrupt, oversized or partial metadata never hides accounting or creates files", t => {
  const f = fixture(); t.after(f.close);
  const rows = [row("openai", "axiom-copy-deleted"), row(null, null), row("constructor", "toString")];
  assert.deepEqual(usageModelNames(join(f.dir, "absent"), rows), rows);
  assert.equal(existsSync(join(f.dir, "absent")), false);
  for (const value of ["PRIVATE_BAD_JSON", "[]", "null", JSON.stringify({ providers: [] }), " ".repeat(4 * 1024 * 1024 + 1)]) {
    writeFileSync(join(f.dir, "models.json"), value); writeFileSync(join(f.dir, "models-store.json"), "PRIVATE_BAD_CACHE");
    assert.deepEqual(usageModelNames(f.dir, rows), rows);
  }
  writeFileSync(join(f.dir, "models.json"), '\uFEFF{"providers":{"openai":{"models":[null,3,{"id":"axiom-copy-deleted","name":"  可读名称  "}]}}}');
  assert.equal(usageModelNames(f.dir, rows)[0].name, "可读名称");
  assert.equal(modelDisplay([], { provider: "openai", id: "axiom-copy-deleted" }).model, "未知模型配置");
  assert.equal(modelDisplay([], { provider: "openai", id: "old-real-model-id" }).model, "old-real-model-id");
});

test("optional name metadata refuses symlink and hardlink aliases instead of interpreting credentials as models", t => {
  const f = fixture(); t.after(f.close);
  const auth = join(f.dir, "auth.json"), models = join(f.dir, "models.json"), content = '{"providers":{"openai":{"models":[{"id":"copy","name":"PRIVATE_AUTH_NAME"}]}}}';
  writeFileSync(auth, content);
  for (const link of [symlinkSync, linkSync]) {
    link(auth, models); assert.equal(usageModelNames(f.dir, [row("openai", "copy")])[0].name, undefined);
    assert.equal(readFileSync(auth, "utf8"), content); unlinkSync(models);
  }
});

test("name projection is bounded, ignores internal or blank names and never restores account-scoped catalogs", t => {
  const f = fixture(); t.after(f.close);
  f.write("models.json", { providers: { openai: { models: [{ id: "blank", name: "   " }, { id: "internal", name: "axiom-copy-name" }, { id: "long", name: "名称".repeat(200) }], modelOverrides: { "axiom-copy-fallback": { axiomRequestModelId: "real-upstream-id" } } }, kiro: { models: [{ id: "explicit", name: "本地显式名称" }] } } });
  f.write("models-store.json", { kiro: { cacheScope: "ANOTHER_ACCOUNT_SCOPE", models: [{ id: "scoped", name: "禁止恢复" }] }, custom: { cacheScope: "OTHER_SCOPE", models: [{ id: "scoped", name: "禁止恢复" }] } });
  const result = usageModelNames(f.dir, [row("openai", "blank"), row("openai", "internal"), row("openai", "long"), row("openai", "axiom-copy-fallback"), row("kiro", "explicit"), row("kiro", "scoped"), row("custom", "scoped")]);
  assert.deepEqual(result.map(item => item.name), [undefined, undefined, "名称".repeat(80), undefined, "本地显式名称", undefined, undefined]);
  const limited = usageModelNames(f.dir, Array.from({ length: 1001 }, () => row("openai", "long")));
  assert.equal(limited[999].name?.length, 160); assert.equal(limited[1000].name, undefined);
});
