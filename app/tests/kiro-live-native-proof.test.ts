import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/kiro-live-native-proof.mjs", import.meta.url));
const answer = "SYNTHETIC-ANSWER", answerHash = createHash("sha256").update(answer).digest("hex");
const sourcePaths = ["dist/server/providers/kiro-chat.js", "dist/server/providers/kiro-chat-protocol.js", "scripts/kiro-live-check.mjs",
  "scripts/kiro-live-plan.mjs", "scripts/kiro-live-lifecycle.mjs", "scripts/kiro-live-native-proof.mjs"];

function entry(id: string, runId: string, messageId: string, reasoning = true, interrupted = true) {
  return { type: "message", id, message: {
    role: "assistant", provider: "kiro", model: "claude-sonnet-4.5", axiomRunId: runId, axiomId: messageId,
    timestamp: 1, stopReason: "stop", thinkingLevel: "medium", providerThinkingLevel: 16000,
    content: [{ type: "thinking", thinking: "PRIVATE-THOUGHT", thinkingSignature: "PRIVATE-SIGNATURE" }, { type: "text", text: answer }],
    diagnostics: [
      ...(reasoning ? [{ type: "kiro-reasoning-history-omitted", timestamp: 2, details: { omittedReasoningTextBlocks: 3, secret: "PRIVATE-DETAIL" } }] : []),
      ...(interrupted ? [{ type: "kiro-interrupted-tools-omitted", timestamp: 2, details: { omittedToolCalls: 1, secret: "PRIVATE-DETAIL" } }] : []),
      { type: "unapproved-diagnostic", secret: "PRIVATE-ACCESS" },
    ],
  } };
}
function fixture(t: TestContext, entries: unknown[]) {
  const directory = mkdtempSync(join(tmpdir(), "axiom-kiro-native-proof-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const appdata = join(directory, "appdata"), root = join(appdata, "Axiom2"), statePath = join(directory, "state.json"), output = join(directory, "proof.json");
  const transcript = join(root, "sessions", "workspace-test", "local-fixture.jsonl");
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, entries.map(value => JSON.stringify(value)).join("\n") + "\n");
  writeFileSync(statePath, JSON.stringify({ workspaceId: "workspace-test", sessionId: "session-test", taskRef: "task-test" }));
  const db = new DatabaseSync(join(root, "axiom.sqlite"));
  try {
    db.exec("CREATE TABLE agent_sessions(sessionId TEXT PRIMARY KEY, file TEXT NOT NULL)");
    db.prepare("INSERT INTO agent_sessions VALUES (?, ?)").run("session-test", transcript);
  } finally { db.close(); }
  for (const relative of sourcePaths) { const path = join(directory, relative); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, "SYNTHETIC-HASH-FIXTURE"); }
  return { directory, root, statePath, output, transcript,
    run: (options: string[] = []) => spawnSync(process.execPath, [script, statePath, output, ...options], {
      cwd: directory, env: { ...process.env, APPDATA: appdata }, encoding: "utf8", timeout: 15_000,
    }),
    proof: () => JSON.parse(readFileSync(output, "utf8")),
  };
}
const scoped = ["--run-id", "target-run", "--message-id", "target-message", "--answer-sha256", answerHash, "--expect-interrupted-tools"];

test("Kiro native proof binds the unique run/message/answer and never copies private content", t => {
  const f = fixture(t, [entry("older-entry", "older-run", "older-message"), entry("target-entry", "target-run", "target-message")]);
  const result = f.run(scoped); assert.equal(result.status, 0, result.stderr);
  const proof = f.proof();
  assert.deepEqual(proof.selectedRecordIds, ["target-entry"]); assert.equal(proof.records.length, 2, "local debug output deliberately includes session metadata");
  assert.deepEqual(proof.scope, { axiomRunId: "target-run", axiomId: "target-message", expectedAnswerSha256: answerHash });
  assert.equal(proof.records[1].localThinkingBlocks, 1); assert.equal(proof.records[1].answerSha256, answerHash);
  assert.equal(proof.files.length, sourcePaths.length); assert.ok(proof.files.every((file: any) => /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.doesNotMatch(JSON.stringify(proof) + result.stdout, /PRIVATE-THOUGHT|PRIVATE-SIGNATURE|PRIVATE-DETAIL|PRIVATE-ACCESS|SYNTHETIC-ANSWER/);
});

test("Kiro native proof cannot borrow the omission diagnostic from another run with the same answer", t => {
  const f = fixture(t, [entry("older-entry", "older-run", "older-message"), entry("target-entry", "target-run", "target-message", false)]);
  const result = f.run(scoped);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Selected native responses must contain the NEW omission diagnostic/); assert.equal(existsSync(f.output), false);
});

test("Kiro native proof cannot borrow interrupted-tool cleanup from an unselected response", t => {
  const f = fixture(t, [entry("older-entry", "older-run", "older-message"), entry("target-entry", "target-run", "target-message", true, false)]);
  const result = f.run(scoped);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Selected native responses must prove interrupted-tool cleanup/); assert.equal(existsSync(f.output), false);
});

test("Kiro native proof rejects a message belonging to another run even when its answer hash matches", t => {
  const f = fixture(t, [entry("older-entry", "older-run", "older-message"), entry("target-entry", "target-run", "target-message")]);
  const result = f.run(["--run-id", "target-run", "--message-id", "older-message", "--answer-sha256", answerHash]);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /No native assistant matches/); assert.equal(existsSync(f.output), false);
});

test("Kiro native proof rejects duplicated native identities", t => {
  const f = fixture(t, [entry("target-entry", "target-run", "target-message"), entry("duplicate-entry", "target-run", "target-message")]);
  const result = f.run(scoped);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /selected native assistant identity must be unique/); assert.equal(existsSync(f.output), false);
});

test("Kiro native proof refuses an incorrect expected answer digest", t => {
  const f = fixture(t, [entry("target-entry", "target-run", "target-message")]);
  const result = f.run(["--run-id", "target-run", "--message-id", "target-message", "--answer-sha256", "a".repeat(64)]);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /selected run\/message must contain the expected answer/); assert.equal(existsSync(f.output), false);
});

test("Kiro native proof validates option dependencies, duplicates, unknown flags, and SHA-256 syntax", t => {
  const f = fixture(t, [entry("target-entry", "target-run", "target-message")]);
  const cases: [string[], RegExp][] = [
    [["--message-id", "target-message"], /Bind an AXIOM message to its run/],
    [["--answer-sha256", answerHash], /Bind the expected answer hash/],
    [["--run-id", "target-run", "--answer-sha256", "invalid"], /Invalid expected SHA-256/],
    [["--run-id"], /Pass a value for --run-id/],
    [["--run-id", "target-run", "--run-id", "target-run"], /Do not repeat --run-id/],
    [["--unexpected"], /Unknown proof option/],
    [["EXTRA-POSITIONAL"], /Pass only state and output positional paths/],
  ];
  for (const [options, expected] of cases) {
    const result = f.run(options); assert.notEqual(result.status, 0); assert.match(result.stderr, expected); assert.equal(existsSync(f.output), false);
  }
});

test("Kiro native proof confines transcript reads to the chosen workspace", t => {
  const f = fixture(t, [entry("target-entry", "target-run", "target-message")]);
  const outside = resolve(f.directory, "outside.jsonl"); writeFileSync(outside, readFileSync(f.transcript));
  const db = new DatabaseSync(join(f.root, "axiom.sqlite"));
  try { db.prepare("UPDATE agent_sessions SET file=?").run(outside); } finally { db.close(); }
  const result = f.run(scoped);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Read only the chosen task transcript/); assert.equal(existsSync(f.output), false);
});

test("Kiro native proof documents run-only scope as potentially multiple responses", t => {
  const f = fixture(t, [entry("first-entry", "target-run", "first-message", true, false), entry("second-entry", "target-run", "second-message", false, true)]);
  const result = f.run(["--run-id", "target-run", "--expect-interrupted-tools"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.proof().selectedRecordIds, ["first-entry", "second-entry"]); assert.equal(f.proof().scope.axiomId, null);
});

test("Kiro native proof refuses to overwrite any existing output", t => {
  const f = fixture(t, [entry("target-entry", "target-run", "target-message")]);
  const stateBefore = readFileSync(f.statePath), transcriptBefore = readFileSync(f.transcript);
  writeFileSync(f.output, "KEEP-EXISTING-EVIDENCE");
  const result = f.run(scoped);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /EEXIST/);
  assert.equal(readFileSync(f.output, "utf8"), "KEEP-EXISTING-EVIDENCE");
  assert.deepEqual(readFileSync(f.statePath), stateBefore); assert.deepEqual(readFileSync(f.transcript), transcriptBefore);
});
