import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
for (const variant of ["baseline", "guard"] as const) test(`real pooled Kiro worker warming: ${variant}`, { timeout: 45_000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "axiom-kiro-host-warm-"));
  for (const dir of ["home", "sdk", "pi", "tmp", "config", "cache"]) mkdirSync(join(root, dir));
  try {
    // Do not spread the parent environment: profiles and every real child see
    // only this owned fixture home, SDK/account namespace and explicit settings.
    const { stdout, stderr } = await execute(process.execPath, ["--import", import.meta.resolve("tsx"),
      "--import", fileURLToPath(new URL("./vite-assets.mjs", import.meta.url)),
      fileURLToPath(new URL("./fixtures/kiro-warming-harness.ts", import.meta.url)), root, variant], {
      timeout: 40_000, maxBuffer: 1024 * 1024, env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: join(root, "home"), USERPROFILE: join(root, "home"),
        TMPDIR: join(root, "tmp"), XDG_CONFIG_HOME: join(root, "config"), XDG_CACHE_HOME: join(root, "cache"),
        PI_CODING_AGENT_DIR: join(root, "sdk"), AXIOM_PI_DIR: join(root, "pi"), AXIOM_EXECUTION_MODE: "managed",
        PI_OFFLINE: "1", NODE_ENV: "test",
      },
    });
    // The isolated environment deliberately does not inherit warning settings.
    // Permit only Node's known SQLite experimental warning, not arbitrary stderr.
    const unexpected = stderr.replace(/^\(node:\d+\) ExperimentalWarning: SQLite is an experimental feature and might change at any time\r?\n(?:\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\r?\n)?/gm, "");
    assert.equal(unexpected, "");
    const result = JSON.parse(stdout.trim());
    t.diagnostic(JSON.stringify(result));
    assert.equal(result.variant, variant); assert.equal(result.childrenClosed, true);
    if (variant === "baseline") {
      assert.ok(result.requests >= 2); assert.ok(result.warms >= 1); assert.notEqual(result.entrySha, result.sourceSha);
    } else {
      assert.equal(result.requests, 2); assert.equal(result.warms, 0); assert.equal(result.reused, true);
      assert.equal(result.entrySha, result.sourceSha);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
