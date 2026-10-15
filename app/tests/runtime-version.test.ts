import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const versions: [string, boolean][] = [
  ["20.19.0", false], ["22.0.0", false], ["22.18.0", false],
  ["22.19.0", true], ["22.23.2", true], ["23.0.0", true], ["24.0.0", true],
];
function run(version: string, file: string, args: string[], data?: string) {
  // Exercise the real entry points; the CI matrix separately runs real Node 22/24.
  const preload = `Object.defineProperty(process.versions, "node", { value: ${JSON.stringify(version)} });`;
  return spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(preload)}`, join(root, file), ...args], {
    encoding: "utf8", timeout: 15_000,
    env: { ...process.env, ...(data ? { AXIOM_DATA_DIR: data } : {}) },
  });
}
test("CLI accepts Node 22.19+ and rejects earlier runtimes", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  for (const [version, supported] of versions) {
    const result = run(version, "bin/axiom2.mjs", ["--version", "--json"]);
    assert.equal(result.error, undefined);
    assert.equal(result.status, supported ? 0 : 1, `${version}: ${result.stderr}`);
    if (supported) assert.equal(result.stdout.trim(), pkg.version);
    else assert.match(JSON.parse(result.stdout).message, /22\.19\.0\+/);
  }
});
test("standalone desktop updater accepts Node 22.19+ before service control", async () => {
  const data = await mkdtemp(join(tmpdir(), "axiom-runtime-floor-"));
  try {
    for (const [version, supported] of versions) {
      const result = run(version, "app/desktop/updater.mjs", ["busy"], data);
      assert.equal(result.error, undefined);
      assert.equal(result.status, supported ? 0 : 1, `${version}: ${result.stderr}`);
      const body = JSON.parse(result.stdout);
      if (supported) assert.deepEqual(body, { busy: false });
      else { assert.equal(body.state, "error"); assert.match(body.message, /22\.19\.0\+/); }
    }
  } finally { await rm(data, { recursive: true, force: true }); }
});
