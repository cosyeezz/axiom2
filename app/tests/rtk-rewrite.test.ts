import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { atomicRtkJson, readRtkConfig, rtkConfigPath, rtkDirectory } from "../src/server/integrations/rtk-config.js";
import { rtkExtension } from "../src/server/integrations/rtk-runtime.js";
import { bindRtkRewrite, rtkRewriteEligibility } from "../src/server/integrations/rtk-rewrite.js";
import { runRtk, runRtkCommand, type RtkCommandRun } from "../src/server/integrations/rtk-process.js";
import { recordRtkEvent, rtkStats } from "../src/server/integrations/rtk-stats.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-rtk-rewrite-"));
  const directory = `v1.0.1-${randomUUID()}`, file = join(rtkDirectory(root), "versions", directory, "rtk");
  mkdirSync(join(rtkDirectory(root), "versions", directory), { recursive: true }); writeFileSync(file, "fixture");
  atomicRtkJson(rtkConfigPath(root), { format: 1, revision: randomUUID(), enabled: true, subagents: true, level: "aggressive", installation: { directory, version: "1.0.1" } });
  return { root, file, close: () => rmSync(root, { recursive: true, force: true }) };
}
function event(command = "ls .", extra: object = {}): any {
  return { type: "tool_call", toolCallId: randomUUID(), toolName: "bash", input: { command, timeout: 10 }, ...extra };
}
function harness(f: ReturnType<typeof fixture>, options: { run?: RtkCommandRun; permission?: (event: any) => any; signal?: AbortSignal; role?: "main" | "subagent"; rewriteAllowed?: () => boolean } = {}) {
  const handlers = new Map<string, Function[]>(), seen: string[] = [];
  let rewrites = 0, pipes = 0;
  const emit = async (name: string, value: any): Promise<any> => {
    if (name === "tool_call") { seen.push(value.input.command); const decision = await options.permission?.(value); if (decision?.block) return decision; }
    let result: any;
    for (const handler of handlers.get(name) ?? []) { result = await handler(value, { signal: options.signal }); if (result?.block) return result; }
    return result;
  };
  const factory = rtkExtension(f.root, options.role ?? "main", { authorizeRewrite: value => emit("tool_call", value), rewriteAllowed: options.rewriteAllowed, runRewrite: async (...args) => {
    rewrites++; args[2].admissionCheck?.();
    return options.run ? options.run(...args) : { code: 3, stdout: Buffer.from("rtk ls .\n") };
  }, runPostprocess: async () => { pipes++; return Buffer.from("120 files\n"); } });
  factory({ on: (name: string, fn: Function) => { handlers.set(name, [...handlers.get(name) ?? [], fn]); } } as any);
  return { emit, seen, get rewrites() { return rewrites; }, get pipes() { return pipes; } };
}
function result(call: any, isError = false) {
  const output = Array.from({ length: 120 }, (_, i) => `./long-project-path-测试-file-number-${i}.ts`).join("\n");
  return { ...call, type: "tool_result", isError, content: [{ type: "text", text: output }], structuredContent: { output, truncated: false, exit_code: isError ? 7 : 0 }, details: { marker: true } };
}

test("RTK binding supports literal compounds, multiline and terminal pipelines without replacing arguments", () => {
  const root = "/data/axiom's root", file = "/managed/rtk's bin/rtk";
  for (const [original, candidate] of [
    ["cd 'my app' && git status && ls .", "cd 'my app' && rtk git status && rtk ls ."],
    ["git status\nls .", "rtk git status\nrtk ls ."],
    ["A='B C' git status", "A='B C' rtk git status"],
    ["git log | grep 'rtk'", "git log | rtk grep 'rtk'"],
    ["X=1 git log --oneline --grep 'rtk'", "X=1 rtk git log --oneline --grep 'rtk'"],
  ]) {
    const bound = bindRtkRewrite(root, original, candidate, file, "aggressive");
    assert.ok(bound, candidate); assert.ok(bound.includes("'/managed/rtk'\\''s bin/rtk'"));
    assert.ok(bound.includes("RTK_RECALL=0 RTK_TEE=0"));
    if (candidate.includes("'rtk'")) assert.ok(bound.includes("'rtk'"), "quoted argument is not a command position");
    assert.ok(!bound.includes(" | rtk "));
  }
  assert.equal(bindRtkRewrite(root, "git status", "rtk git status", file, "conservative"), undefined);
  assert.equal(bindRtkRewrite(root, "rg foo", "rtk grep foo", file, "balanced"), undefined);
  assert.equal(bindRtkRewrite(root, "cat x", "rtk read x", file, "aggressive"), undefined);
});

test("RTK binding rejects producers, expansions, redirection, explicit RTK and machine contracts", () => {
  for (const source of ["git status | head -5", "git status > out", 'git log "$(secret)"', "git `secret`", "git status &", "git status # note", "git status\0", "git status &&", "find . -exec echo x {} +", "find . -delete", "git status --porcelain", "git diff --raw", "rg --json foo", "git log --format=%H", "rtk git status", "X=1 /managed/rtk git status", "rtk git status && git diff", "RTK_DISABLED=1 git status"]) {
    assert.equal(bindRtkRewrite("/tmp", source, `rtk ${source}`, "/managed/rtk", "aggressive"), undefined, source);
  }
  for (const source of ["find missing-path", "find missing-path && ls sub", "git status\nfind missing-path"]) {
    assert.equal(rtkRewriteEligibility(source), "rewrite_policy", "upstream find must not change failure/control flow");
  }
  assert.equal(bindRtkRewrite("/tmp", "rg --files", "rtk find .", "/managed/rtk", "aggressive"), undefined);
  for (const prefix of ["'A=B'", '"A=B"', String.raw`A\=B`, "A'='B"]) {
    assert.equal(bindRtkRewrite("/tmp", `${prefix} git status`, `${prefix} rtk git status`, "/managed/rtk", "balanced"), undefined, "quoted/escaped NAME= is a command, not an assignment");
  }
  assert.equal(rtkRewriteEligibility("rtk git status"), "already_rtk");
  assert.equal(rtkRewriteEligibility("git status | head -5"), "eligible", "official may propose it, binding still rejects compressed producer");
  assert.equal(bindRtkRewrite("/tmp", "git status | head -5", "rtk git status | head -5", "/managed/rtk", "balanced"), undefined);
});

test("RTK grammar rejects non-Bash whitespace and unquoted expansion without normalizing commands", () => {
  for (const space of ["\u00a0", "\u2003", "\v", "\f", "\ufeff"]) {
    const original = `ls .; X=1${space}git status`, candidate = `rtk ls .; X=1${space}rtk git status`;
    assert.equal(rtkRewriteEligibility(original), "rewrite_policy");
    assert.equal(bindRtkRewrite("/tmp", original, candidate, "/managed/rtk", "balanced"), undefined);
    assert.equal(bindRtkRewrite("/tmp", "git status", `rtk${space}git status`, "/managed/rtk", "balanced"), undefined);
  }
  for (const source of ["ls *.ts", "ls file?.ts", "ls [ab].ts", "ls ~", "ls ~/project"]) assert.equal(rtkRewriteEligibility(source), "rewrite_policy");
  assert.ok(bindRtkRewrite("/tmp", "ls\t'*.ts'", "rtk ls\t'*.ts'", "/managed/rtk", "balanced"), "quoted glob and real Bash tabs stay literal");
});

test("RTK grammar rejects mixed wrappers and shell-state injection instead of partially binding PATH RTK", () => {
  for (const command of ["time git status", "env git status", "/usr/bin/env git status", "command git status", "builtin command git status", "nice git status", "nohup git status", "exec git status", "sudo git status", "bash -c 'git status'", "eval 'git() { echo custom; }'", "builtin eval 'git() { echo custom; }'", "source file", ". file", "enable -f file git", "hash -p /tmp/custom-git git", "history -s 'git status'", "fc -s", "shopt -s expand_aliases", "alias git='echo custom'", "printf -v 'BASH_ALIASES[git]' 'echo custom'", "set -o pipefail", "if true", "for x in a"]) {
    const source = `ls .; ${command}; git status`;
    assert.equal(rtkRewriteEligibility(source), "rewrite_policy", command);
    assert.equal(bindRtkRewrite("/tmp", "ls", `rtk ls; ${command}`, "/managed/rtk", "balanced"), undefined, command);
  }
  assert.equal(bindRtkRewrite("/tmp", "ls; custom-wrapper git status", "rtk ls; custom-wrapper rtk git status", "/managed/rtk", "balanced"), undefined, "unrecognized bare RTK must not escape to PATH");
  assert.equal(bindRtkRewrite("/tmp", "ls; git status", "rtk ls; /external/rtk git status", "/managed/rtk", "balanced"), undefined);
});

describe("RTK pre-execution gate", { skip: process.platform === "win32" ? "Bash front path intentionally disabled on Windows" : false }, () => {
  for (const code of [0, 3]) test(`official decision ${code} is reauthorized, executes once and never pipes even failed results`, async () => {
    const f = fixture(); try {
      const h = harness(f, { run: async () => ({ code, stdout: Buffer.from("rtk ls .\n") }) }), call = event();
      const original = structuredClone(call);
      assert.equal(await h.emit("tool_call", call), undefined);
      assert.equal(h.rewrites, 1); assert.equal(h.seen.length, 2); assert.equal(h.seen[0], original.input.command);
      assert.ok(call.input.command.includes(f.file)); assert.equal(call.input.timeout, 10);
      const output = result(call, true), before = structuredClone(output);
      assert.equal(await h.emit("tool_result", output), undefined); assert.deepEqual(output, before); assert.equal(h.pipes, 0);
      const stats = rtkStats(f.root); assert.equal(stats.rewritten, 1); assert.equal(stats.rewriteCount, 1);
      assert.equal(stats.count, 0); assert.equal(stats.inputBytes, 0); assert.equal(stats.outputBytes, 0);
      assert.equal(existsSync(join(rtkDirectory(f.root), "originals")), false);
    } finally { f.close(); }
  });
  test("original denial never probes; rewrite denial and permission exceptions fail closed", async () => {
    const f = fixture(); try {
      let h = harness(f, { permission: () => ({ block: true, reason: "original-denied" }) });
      assert.equal((await h.emit("tool_call", event())).reason, "original-denied"); assert.equal(h.rewrites, 0);
      h = harness(f, { permission: e => e.input.command.includes(f.file) ? { block: true, reason: "rewrite-denied" } : undefined });
      const call = event(); assert.equal((await h.emit("tool_call", call)).reason, "rewrite-denied"); assert.equal(call.input.command, "ls .");
      h = harness(f, { permission: e => { if (e.input.command.includes(f.file)) throw Error("permission failed"); } });
      await assert.rejects(h.emit("tool_call", event()), /permission failed/); assert.equal(h.rewrites, 1);
      h = harness(f, { permission: e => { if (e.input.command.includes(f.file)) e.input.timeout = 99; } });
      assert.equal((await h.emit("tool_call", event())).block, true);
      assert.equal(rtkStats(f.root).rewritten, 0);
    } finally { f.close(); }
  });
  test("official deny is not permission, malformed/no-match/error fall back before business execution", async () => {
    const f = fixture(); try {
      const denied = harness(f, { run: async () => ({ code: 2, stdout: Buffer.alloc(0) }) });
      assert.equal((await denied.emit("tool_call", event())).block, true);
      for (const run of [async () => ({ code: 1, stdout: Buffer.alloc(0) }), async () => ({ code: 7, stdout: Buffer.alloc(0) }), async () => ({ code: 3, stdout: Buffer.from([0xff]) }), async () => ({ code: 3, stdout: Buffer.alloc(0) }), async () => { throw Error("timeout PRIVATE"); }]) {
        const h = harness(f, { run }), call = event("rg --files"); await h.emit("tool_call", call);
        assert.equal(call.input.command, "rg --files"); assert.equal(h.rewrites, 1);
        assert.ok(await h.emit("tool_result", result(call))); assert.equal(h.pipes, 1, "legacy postprocessor remains available only on non-adopted calls");
      }
      const stats = rtkStats(f.root); assert.equal(stats.rewritten, 0); assert.equal(stats.filtered, 5);
      assert.ok(!JSON.stringify(stats).includes("PRIVATE"));
    } finally { f.close(); }
  });
  test("parallel calls use independent reentry guards", async () => {
    const f = fixture(); try {
      let arrivals = 0, release!: () => void; const barrier = new Promise<void>(r => { release = r; });
      const h = harness(f, { run: async (_file, args) => { if (++arrivals === 2) release(); await barrier; return { code: 3, stdout: Buffer.from(`rtk ${args[1]}`) }; } });
      const calls = [event("ls a"), event("ls b")];
      await Promise.all(calls.map(call => h.emit("tool_call", call)));
      assert.equal(h.rewrites, 2); assert.equal(h.seen.length, 4); assert.equal(rtkStats(f.root).rewritten, 2);
      for (const call of calls) await h.emit("tool_result", result(call)); assert.equal(h.pipes, 0);
    } finally { f.close(); }
  });
  test("hot revision/disable or cancellation discards candidate without records or originals", async () => {
    const f = fixture(); try {
      for (const where of ["probe", "permission"]) {
        atomicRtkJson(rtkConfigPath(f.root), { ...readRtkConfig(f.root), enabled: true, revision: randomUUID() });
        const update = () => atomicRtkJson(rtkConfigPath(f.root), { ...readRtkConfig(f.root), enabled: false, revision: randomUUID() });
        const h = harness(f, { run: async () => { if (where === "probe") update(); return { code: 3, stdout: Buffer.from("rtk ls .") }; }, permission: e => { if (where === "permission" && e.input.command.includes(f.file)) update(); } });
        const call = event(); await h.emit("tool_call", call); assert.equal(call.input.command, "ls ."); assert.equal(h.rewrites, 1);
      }
      assert.equal(rtkStats(f.root).rewriteCount, 0);
      atomicRtkJson(rtkConfigPath(f.root), { ...readRtkConfig(f.root), enabled: true, revision: randomUUID() });
      const abort = new AbortController(), h = harness(f, { signal: abort.signal, run: async () => { abort.abort(); return { code: 3, stdout: Buffer.from("rtk ls .") }; } });
      const call = event(); await h.emit("tool_call", call); assert.equal(call.input.command, "ls .");
      assert.equal(rtkStats(f.root).recent[0].reason, "cancelled"); assert.equal(existsSync(join(rtkDirectory(f.root), "originals")), false);
    } finally { f.close(); }
  });
  test("custom shell/prefix permission gate and initialization environment bypass rewriting", async () => {
    const f = fixture(), saved = { BASH_ENV: process.env.BASH_ENV, ENV: process.env.ENV, SHELLOPTS: process.env.SHELLOPTS, BASHOPTS: process.env.BASHOPTS, RTK_DISABLED: process.env.RTK_DISABLED, "BASH_FUNC_git%%": process.env["BASH_FUNC_git%%"] };
    try {
      const h = harness(f, { rewriteAllowed: () => false }); await h.emit("tool_call", event()); assert.equal(h.rewrites, 0);
      for (const key of ["BASH_ENV", "ENV", "SHELLOPTS", "BASHOPTS", "RTK_DISABLED", "BASH_FUNC_git%%"] as const) {
        process.env[key] = "1";
        const blocked = harness(f); await blocked.emit("tool_call", event()); assert.equal(blocked.rewrites, 0);
        if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
      }
      const find = harness(f); await find.emit("tool_call", event("find missing-path")); assert.equal(find.rewrites, 0);
      const hot = harness(f, { run: async () => { process.env.ENV = "late-initialization"; return { code: 3, stdout: Buffer.from("rtk ls .") }; } });
      const call = event(); await hot.emit("tool_call", call); assert.equal(call.input.command, "ls ."); assert.equal(hot.seen.length, 1, "initialization environment is rechecked after probe");
    } finally {
      for (const key of ["BASH_ENV", "ENV", "SHELLOPTS", "BASHOPTS", "RTK_DISABLED", "BASH_FUNC_git%%"] as const) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
      f.close();
    }
  });
  test("nested programmatic calls, PowerShell, disabled settings and child switch keep original contracts", async () => {
    const f = fixture(); try {
      const h = harness(f), call = event("find . -type f", { parentToolCallId: "code-mode" });
      await h.emit("tool_call", call); const output = result(call), before = structuredClone(output);
      assert.equal(await h.emit("tool_result", output), undefined); assert.deepEqual(output, before);
      await h.emit("tool_call", event("find .", { toolName: "powershell" }));
      for (const patch of [{ enabled: false }, { enabled: true, subagents: false }, { enabled: true, subagents: true, level: "conservative" }]) {
        atomicRtkJson(rtkConfigPath(f.root), { ...readRtkConfig(f.root), ...patch, revision: randomUUID() });
        const child = harness(f, { role: "subagent" }); await child.emit("tool_call", event()); assert.equal(child.rewrites, 0);
      }
      assert.equal(h.rewrites, 0); assert.equal(h.pipes, 0);
    } finally { f.close(); }
  });
});

test("RTK raw protocol preserves code3 but installation runner remains strict code0", { timeout: 30000 }, async () => {
  const f = fixture(); try {
    const args = ["-e", "process.stdout.write('rtk git status');process.exit(3)"];
    const result = await runRtkCommand(process.execPath, args, { root: f.root }); assert.equal(result.code, 3); assert.equal(result.stdout.toString(), "rtk git status");
    await assert.rejects(runRtk(process.execPath, args, { root: f.root }));
    const abort = new AbortController(); abort.abort(); await assert.rejects(runRtkCommand(process.execPath, args, { root: f.root, signal: abort.signal }));
  } finally { f.close(); }
});

test("RTK stats migrate legacy ten-column rows and exclude rewrite bytes/duration from savings", () => {
  const f = fixture(); try {
    const db = new DatabaseSync(join(rtkDirectory(f.root), "effects.sqlite"));
    db.exec("CREATE TABLE effects (id TEXT PRIMARY KEY,at INTEGER,role TEXT,level TEXT,filter TEXT,reason TEXT,inputBytes INTEGER,outputBytes INTEGER,durationMs REAL,version TEXT)");
    db.prepare("INSERT INTO effects VALUES(?,?,?,?,?,?,?,?,?,?)").run(randomUUID(), Date.now(), "main", "balanced", "find", "filtered", 1000, 100, 5, "1.0.1"); db.close();
    recordRtkEvent(f.root, { id: randomUUID(), at: Date.now(), role: "subagent", level: "balanced", filter: "rewrite", reason: "rewritten", stage: "rewrite", inputBytes: 99999, outputBytes: 123, durationMs: 20, version: "1.0.1" });
    const stats = rtkStats(f.root); assert.equal(stats.count, 1); assert.equal(stats.filtered, 1); assert.equal(stats.inputBytes, 1000); assert.equal(stats.outputBytes, 100); assert.equal(stats.durationMs, 5);
    assert.equal(stats.rewriteCount, 1); assert.equal(stats.rewritten, 1); assert.equal(stats.rewriteDurationMs, 20); assert.equal(stats.recent.length, 2);
    assert.ok(stats.recent.some(e => e.stage === "postprocess"));
  } finally { f.close(); }
});
