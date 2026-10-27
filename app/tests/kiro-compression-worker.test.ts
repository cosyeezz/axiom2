import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
for (const variant of ["priced", "missing", "zero", "partial", "retry", "auth", "cancel", "aborted-result"]) test(`real pooled Kiro compression accounting: ${variant}`, { timeout: 45_000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "axiom-kiro-host-compress-"));
  for (const dir of ["home", "sdk", "pi", "tmp", "config", "cache"]) mkdirSync(join(root, dir));
  try {
    const { stdout, stderr } = await execute(process.execPath, ["--import", import.meta.resolve("tsx"),
      "--import", new URL("./vite-assets.mjs", import.meta.url).href,
      fileURLToPath(new URL("./fixtures/kiro-compression-harness.ts", import.meta.url)), root, variant], {
      timeout: 40_000, maxBuffer: 1024 * 1024, env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: join(root, "home"), USERPROFILE: join(root, "home"),
        TMPDIR: join(root, "tmp"), TEMP: join(root, "tmp"), TMP: join(root, "tmp"), XDG_CONFIG_HOME: join(root, "config"), XDG_CACHE_HOME: join(root, "cache"),
        PI_CODING_AGENT_DIR: join(root, "sdk"), AXIOM_PI_DIR: join(root, "pi"), AXIOM_EXECUTION_MODE: "managed",
        PI_OFFLINE: "1", NODE_ENV: "test",
      },
    });
    const unexpected = stderr.replace(/^\(node:\d+\) ExperimentalWarning: SQLite is an experimental feature and might change at any time\r?\n(?:\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\r?\n)?/gm, "");
    assert.equal(unexpected, "");
    const result = JSON.parse(stdout.trim()); t.diagnostic(JSON.stringify(result));
    assert.equal(result.variant, variant); assert.equal(result.childrenClosed, true); assert.equal(result.permits, 1);
    const failed = ["auth", "cancel", "aborted-result"].includes(variant);
    assert.equal(result.requests, variant === "retry" ? 3 : failed ? 1 : 2);
    assert.equal(result.physical, result.requests); assert.equal(result.applied, failed ? 0 : 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
