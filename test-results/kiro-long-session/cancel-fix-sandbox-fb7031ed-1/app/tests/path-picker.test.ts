import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "./temporary.js";
import { join } from "node:path";
import { startServer } from "../src/server/index.js";
import { jsonPathRange } from "../src/client/json-path.js";

test("JSON path selection targets values, including escaped Windows paths and masked arguments, never keys", () => {
  const config = JSON.stringify({ command: "C:\\程序\\tool.exe", args: ["[已保存，保持此值以保留]"], env: { ROOT: "" } }, null, 2);
  for (const value of ["C:\\程序\\tool.exe", "[已保存，保持此值以保留]", ""]) {
    const token = JSON.stringify(value), start = config.indexOf(token);
    const range = jsonPathRange(config, start + 1);
    assert.deepEqual(range, { start, end: start + token.length });
    const replacement = 'C:\\资料 空格\\目录\\a"b.json';
    const changed = config.slice(0, range!.start) + JSON.stringify(replacement) + config.slice(range!.end);
    assert.ok(JSON.stringify(JSON.parse(changed)).includes(JSON.stringify(replacement)));
  }
  assert.equal(jsonPathRange(config, config.indexOf('"command"') + 2), undefined);
  assert.equal(jsonPathRange(config, 0), undefined);
  assert.equal(jsonPathRange(config, 0, config.length), undefined);
  const quote = '{"command":"a\\\"b"}';
  assert.deepEqual(jsonPathRange(quote, quote.indexOf("b")), { start: 11, end: quote.length - 1 });
});

test("generic path picker and remote confirmation enforce file/folder, single selection and origins", async t => {
  const root = mkdtempSync(join(tmpdir(), "axiom-path-picker-"));
  const folder = join(root, "中文 目录"), file = join(root, "配置.json");
  mkdirSync(folder); writeFileSync(file, "{}");
  const previous = process.env.AXIOM_PI_DIR, previousPi = process.env.PI_CODING_AGENT_DIR;
  process.env.AXIOM_PI_DIR = join(root, "shared"); process.env.PI_CODING_AGENT_DIR = join(root, "shared");
  let selected: string[] = [], calls = 0, mode = "mixed";
  const app = await startServer({ root: join(root, "data"), port: 0, pickPaths: async options => {
    calls++; assert.equal(options.kind, mode); assert.equal(options.multiple, false); return selected;
  } });
  t.after(async () => {
    await app.close(); rmSync(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    if (previousPi === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousPi;
  });
  const headers = { Origin: app.origin }, url = app.origin + "/api/files/pick";
  assert.equal((await fetch(url, { method: "POST" })).status, 403);
  assert.equal((await fetch(url, { method: "POST", headers: { Origin: "https://invalid.example" } })).status, 403);
  assert.equal((await fetch(url, { headers })).status, 405);
  assert.equal((await fetch(url + "?kind=invalid", { method: "POST", headers })).status, 400);
  assert.equal(calls, 0);
  assert.deepEqual(await (await fetch(url, { method: "POST", headers })).json(), { items: [] });
  for (const [kind, path] of [["folder", folder], ["file", file], ["mixed", file]]) {
    mode = kind; selected = [path];
    const response = await fetch(`${url}?kind=${kind}`, { method: "POST", headers });
    assert.equal(response.status, 200); assert.equal((await response.json()).items[0].path, realpathSync.native(path));
  }
  mode = "file"; selected = [folder];
  assert.equal((await fetch(url + "?kind=file", { method: "POST", headers })).status, 400);
  mode = "folder"; selected = [file];
  assert.equal((await fetch(url + "?kind=folder", { method: "POST", headers })).status, 400);
  mode = "mixed"; selected = [folder, file];
  assert.equal((await fetch(url, { method: "POST", headers })).status, 400);
  const confirm = (paths: string[], kind: string, multiple = false) => fetch(app.origin + "/api/files/browse", {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ paths, kind, multiple }),
  });
  assert.equal((await confirm([folder], "file")).status, 400);
  assert.equal((await confirm([file], "folder")).status, 400);
  assert.equal((await confirm([folder, file], "mixed")).status, 400);
  assert.equal((await confirm([file], "invalid")).status, 400);
  assert.equal((await confirm([folder], "folder")).status, 200);
  assert.equal((await confirm([file], "file")).status, 200);
  assert.equal((await confirm([folder, file], "mixed", true)).status, 200);
});
