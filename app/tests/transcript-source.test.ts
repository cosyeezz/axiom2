import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test, { type TestContext } from "node:test";
import { readTranscriptSource } from "../src/server/transcript-source.js";
import { openTranscript, transcriptMessages } from "../src/server/transcript.js";

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(join(tmpdir(), "axiom-source-")), cwd = join(root, "project"), file = join(root, "source.jsonl");
  fs.mkdirSync(cwd);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const content = (text = "original", id = "session", workspace = cwd) =>
    JSON.stringify({ type: "session", version: 3, id, cwd: workspace, timestamp: "2026-01-01T00:00:00.000Z" }) + "\n" +
    JSON.stringify({ type: "message", id: "entry", parentId: null, timestamp: "2026-01-01T00:00:00.000Z",
      message: { role: "user", content: text, timestamp: 1 } }) + "\n";
  fs.writeFileSync(file, content());
  return { root, cwd, file, content };
}
const saved = (file: string) => {
  const stat = fs.statSync(file, { bigint: true });
  return { bytes: fs.readFileSync(file), mtime: stat.mtimeNs, ctime: stat.ctimeNs, ino: stat.ino, size: stat.size };
};

test("source digest, header and projected messages refer to the same owned bytes", t => {
  const f = fixture(t), before = saved(f.file), source = readTranscriptSource(f.file, f.cwd);
  assert.equal(source.manager.getSessionId(), "session");
  assert.equal(source.source.digest, createHash("sha256").update(before.bytes).digest("hex"));
  assert.equal(source.source.file, f.file);
  assert.equal(transcriptMessages(source.manager)[0].text, "original");
  assert.deepEqual(saved(f.file), before);
});

test("readonly public entry preserves missing newline and a partial tail without repair", t => {
  const f = fixture(t);
  for (const bytes of [f.content().trimEnd(), f.content() + '{"type":"message","id":']) {
    fs.writeFileSync(f.file, bytes);
    const before = saved(f.file), files = fs.readdirSync(f.root);
    assert.equal(transcriptMessages(openTranscript(f.file, f.cwd, { readOnly: true }))[0].text, "original");
    assert.deepEqual(saved(f.file), before);
    assert.deepEqual(fs.readdirSync(f.root), files);
  }
});

test("same-inode rewrite during read retries instead of attaching old bytes to a new stamp", t => {
  const f = fixture(t), replacement = f.content("replacement with different length"), original = fs.readSync;
  let rewritten = false;
  const hook = t.mock.method(fs, "readSync", (...args: Parameters<typeof fs.readSync>) => {
    const count = Reflect.apply(original, fs, args) as number;
    if (!rewritten) { rewritten = true; fs.writeFileSync(f.file, replacement); }
    return count;
  });
  const result = readTranscriptSource(f.file, f.cwd);
  hook.mock.restore();
  assert.equal(rewritten, true);
  assert.equal(transcriptMessages(result.manager)[0].text, "replacement with different length");
  assert.equal(result.source.digest, createHash("sha256").update(replacement).digest("hex"));
});

test("replacement path cannot reuse the previous file header or source", t => {
  const f = fixture(t), replacement = join(f.root, "replacement.jsonl"), original = fs.readSync;
  fs.writeFileSync(replacement, f.content("new file", "replacement-session"));
  let replaced = false;
  const hook = t.mock.method(fs, "readSync", (...args: Parameters<typeof fs.readSync>) => {
    const count = Reflect.apply(original, fs, args) as number;
    if (!replaced) { replaced = true; fs.renameSync(replacement, f.file); }
    return count;
  });
  const result = readTranscriptSource(f.file, f.cwd);
  hook.mock.restore();
  assert.equal(result.manager.getSessionId(), "replacement-session");
  assert.equal(transcriptMessages(result.manager)[0].text, "new file");
});

test("same-inode replacement with a foreign header is rejected after retry", t => {
  const f = fixture(t), foreign = join(f.root, "foreign"), original = fs.readSync;
  fs.mkdirSync(foreign);
  let replaced = false;
  const hook = t.mock.method(fs, "readSync", (...args: Parameters<typeof fs.readSync>) => {
    const count = Reflect.apply(original, fs, args) as number;
    if (!replaced) { replaced = true; fs.writeFileSync(f.file, f.content("foreign", "foreign-id", foreign)); }
    return count;
  });
  assert.throws(() => readTranscriptSource(f.file, f.cwd), { code: "SESSION_FILE_ERROR" });
  hook.mock.restore();
});

test("continuous changes fail after three attempts, without retrying forever", t => {
  const f = fixture(t), original = fs.readSync;
  let reads = 0;
  const hook = t.mock.method(fs, "readSync", (...args: Parameters<typeof fs.readSync>) => {
    const count = Reflect.apply(original, fs, args) as number;
    reads++; fs.appendFileSync(f.file, "\n");
    return count;
  });
  assert.throws(() => readTranscriptSource(f.file, f.cwd), { code: "SESSION_FILE_ERROR" });
  hook.mock.restore();
  assert.equal(reads, 3);
});

test("short read fails closed and always closes each owned descriptor", t => {
  const f = fixture(t), close = fs.closeSync;
  let closes = 0;
  const read = t.mock.method(fs, "readSync", () => 0);
  const closing = t.mock.method(fs, "closeSync", (fd: number) => { closes++; return close(fd); });
  assert.throws(() => readTranscriptSource(f.file, f.cwd), { code: "SESSION_FILE_ERROR" });
  read.mock.restore(); closing.mock.restore();
  assert.equal(closes, 3);
});

test("invalid ownership, missing file and directory never become empty sessions", t => {
  const f = fixture(t);
  for (const bytes of ["", '{"type":"session"}\n', f.content("body", "id", join(f.root, "missing-workspace"))]) {
    fs.writeFileSync(f.file, bytes);
    const before = saved(f.file);
    assert.throws(() => openTranscript(f.file, f.cwd, { readOnly: true }), { code: "SESSION_FILE_ERROR" });
    assert.deepEqual(saved(f.file), before);
  }
  assert.throws(() => readTranscriptSource(join(f.root, "missing"), f.cwd), { code: "SESSION_FILE_ERROR" });
  assert.throws(() => readTranscriptSource(f.cwd, f.cwd), { code: "SESSION_FILE_ERROR" });
});
