import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "./temporary.js";
import { join } from "node:path";
import { startServer } from "../src/server/index.js";
import { skillImportName } from "../src/shared/skill-import.js";

test("resource picker shares native Open, returns one file/folder or cancellation, and requires same origin", async t => {
  const root = mkdtempSync(join(tmpdir(), "axiom-resource-pick-")), folder = join(root, "folder"), file = join(root, "single.md");
  mkdirSync(folder); writeFileSync(file, "guide");
  const old = process.env.PI_CODING_AGENT_DIR, shared = process.env.AXIOM_PI_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, "shared"); process.env.AXIOM_PI_DIR = join(root, "shared");
  let selected: string[] = [], calls = 0;
  const app = await startServer({ root, port: 0, pickResources: async options => {
    calls++; assert.equal(options.kind, "mixed"); assert.equal(options.multiple, false); return selected;
  } });
  t.after(async () => { await app.close(); if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old; if (shared === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = shared; rmSync(root, { recursive: true, force: true }); });
  const url = `${app.origin}/api/resources/pick`, headers = { Origin: app.origin };
  assert.equal((await fetch(url, { method: "POST" })).status, 403);
  assert.equal((await fetch(url, { method: "POST", headers: { Origin: "https://invalid.example" } })).status, 403);
  assert.equal((await fetch(url, { headers })).status, 405); assert.equal(calls, 0);
  assert.deepEqual(await (await fetch(url, { method: "POST", headers })).json(), { items: [] });
  for (const [path, kind] of [[folder, "folder"], [file, "file"]]) {
    selected = [path]; const response = await fetch(url, { method: "POST", headers }); assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.items[0].path, realpathSync.native(path)); assert.equal(result.items[0].kind, kind);
  }
  selected = [folder, file]; assert.equal((await fetch(url, { method: "POST", headers })).status, 400);
});

test("import defaults use a folder basename or a file stem on either platform", () => {
  assert.equal(skillImportName("/tmp/guide/", "folder"), "guide");
  assert.equal(skillImportName("C:\\skills\\review.md", "file"), "review");
  assert.equal(skillImportName("/tmp/a.b.md", "file"), "a.b");
  assert.equal(skillImportName("/tmp/folder.md", "folder"), "folder.md");
  assert.equal(skillImportName("npm:some-skill"), "");
});
