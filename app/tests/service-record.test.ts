import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("native installation record reader rejects FIFO, links and oversize without writes", { timeout: 120000 }, () => {
  const fixture = mkdtempSync(join(tmpdir(), "axiom-service-record-test-"));
  try {
    mkdirSync(join(fixture, "src"));
    writeFileSync(join(fixture, "Cargo.toml"), '[package]\nname = "axiom-service-record-fixture"\nversion = "0.0.0"\nedition = "2021"\n[dependencies]\nlibc = "=0.2.182"\n');
    const source = fileURLToPath(new URL("../desktop/axiom_service_record.rs", import.meta.url));
    writeFileSync(join(fixture, "src/lib.rs"), `#[path = ${JSON.stringify(source)}]\nmod record;\n`);
    const options = { cwd: fixture, encoding: "utf8" as const, timeout: 90000, env: { ...process.env, CARGO_TARGET_DIR: join(fixture, "target") } };
    // Explicit CI-only dependency preparation; test execution remains offline.
    if (process.env.AXIOM_TEST_CARGO_FETCH === "1") execFileSync("cargo", ["fetch"], options);
    const result = execFileSync("cargo", ["test", "--offline", "--", "--test-threads=1"], options);
    assert.match(result, /test result: ok/);
    assert.match(result, new RegExp(`${process.platform === "win32" ? 3 : 5} passed; 0 failed`));
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
test("every native installation lookup uses the bounded registration reader", () => {
  const service = readFileSync(new URL("../desktop/axiom_service.rs", import.meta.url), "utf8");
  const lookup = service.slice(service.indexOf("fn installation_paths("), service.indexOf("fn run("));
  assert.ok(lookup.includes("service_record::read(&path)"));
  assert.ok(!lookup.includes("fs::read("));
  assert.ok(service.includes('#[path = "axiom_service_record.rs"]'));
  const build = readFileSync(new URL("../../scripts/build-desktop.mjs", import.meta.url), "utf8");
  assert.ok(build.includes('"axiom_service_record.rs"'));
});
