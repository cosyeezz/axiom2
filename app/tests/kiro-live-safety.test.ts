// Synthetic CLI safety fixtures only. Child networking is explicitly forbidden.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const { matrixModels, matrixLabels } = await import(new URL("../scripts/kiro-live-evidence.mjs", import.meta.url).href);
function local(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "axiom-kiro-cli-safety-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const preload = join(directory, "no-network.mjs");
  writeFileSync(preload, "import { Socket } from 'node:net'; Socket.prototype.connect = function () { throw new Error('NETWORK_FORBIDDEN_IN_LOCAL_FIXTURE'); };");
  return { directory, run: (name: string, args: string[]) => spawnSync(process.execPath,
    ["--import", pathToFileURL(preload).href, fileURLToPath(new URL("../scripts/" + name, import.meta.url)), ...args],
    { cwd: directory, encoding: "utf8", timeout: 10000 }) };
}
function mockState(id: string) {
  const vision = ["auto", "claude-sonnet-4.5", "claude-haiku-4.5"].includes(id);
  const labels = matrixLabels.map((l: string) => l.replace("INPUT_VARIANT", vision ? "user-image" : "text-table").replace("TOOL_VARIANT", vision ? "tool-image" : "code-review"));
  return { sessionId: "synthetic-child-" + id, taskRef: "synthetic-task-" + id, completedAt: "2026-10-25T18:00:00.000Z", longSessionPassed: true, checkFailures: [],
    checks: labels.map((label: string) => ({ label, passed: true })),
    turns: labels.map((label: string, i: number) => {
      const runId = "synthetic-" + id + "-" + i;
      const thinking = !id.startsWith("claude-") ? "off" : i < 4 ? "high" : i < 8 ? "off" : i < 11 ? "minimal" : i < 15 ? "low" : i < 18 ? "medium" : "high";
      return { label, answer: "PRIVATE_FIXTURE_ANSWER", run: { id: runId, status: "completed", selection: { provider: "kiro", id, thinking } },
        messageIds: [{ id: "message-" + i, role: "assistant", runId }] };
    }) };
}
test("Kiro evidence CLI creates one synthetic export then refuses to overwrite it", t => {
  const f = local(t), input = join(f.directory, "input"), output = join(f.directory, "evidence.json");
  for (const model of matrixModels as string[]) {
    const path = join(input, model); mkdirSync(path, { recursive: true }); writeFileSync(join(path, "state.json"), JSON.stringify(mockState(model)));
  }
  const first = f.run("kiro-live-evidence.mjs", ["--input-root", input, "--output", output]);
  assert.equal(first.signal, null); assert.equal(first.status, 0, first.stderr);
  const bytes = readFileSync(output, "utf8"); assert.equal(JSON.parse(bytes).matrixRoundCount, 160); assert.doesNotMatch(bytes, /PRIVATE_FIXTURE_ANSWER/);
  const second = f.run("kiro-live-evidence.mjs", ["--input-root", input, "--output", output]);
  assert.equal(second.status, 1); assert.match(second.stderr, /EEXIST/); assert.doesNotMatch(second.stderr, /NETWORK_FORBIDDEN/);
  assert.equal(readFileSync(output, "utf8"), bytes);
});
test("Kiro evidence CLI rejects missing, duplicate and unknown options before reading or writing", t => {
  const f = local(t), output = join(f.directory, "preserved.json"); writeFileSync(output, "PRESERVED");
  const cases = [["--input-root"], ["--output"], ["--input-root", "--output", output], ["--output", "--allow-incomplete"], ["--output", ""], ["--output", output, "--output", output], ["--recovery", "--recovery"], ["--input-root", "a", "--input-root", "b"], ["--unknown"], ["positional"]];
  for (const flags of cases) {
    const result = f.run("kiro-live-evidence.mjs", flags);
    assert.equal(result.status, 1); assert.match(result.stderr, /Pass a value for|Duplicate option|Unknown option/);
    assert.doesNotMatch(result.stderr, /NETWORK_FORBIDDEN|ENOENT/); assert.equal(readFileSync(output, "utf8"), "PRESERVED");
  }
});

test("Kiro lifecycle CLI refuses an existing attempt before any network or model operation", t => {
  const f = local(t), state = join(f.directory, "state.json"), output = join(f.directory, "existing.json");
  writeFileSync(state, JSON.stringify({ workspaceId: "synthetic-workspace", parentSessionId: "synthetic-parent", sessionId: "synthetic-child", taskRef: "synthetic-task" }));
  const before = "PRESERVE_OLD_ATTEMPT"; writeFileSync(output, before);
  const result = f.run("kiro-live-lifecycle.mjs", [state, output, "medium"]);
  assert.equal(result.signal, null); assert.equal(result.status, 1); assert.match(result.stderr, /EEXIST/);
  assert.doesNotMatch(result.stderr, /NETWORK_FORBIDDEN/); assert.equal(readFileSync(output, "utf8"), before);
});
