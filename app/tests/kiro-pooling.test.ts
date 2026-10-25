import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const fixture = fileURLToPath(new URL("./fixtures/kiro-pooling.ts", import.meta.url));
const certificate = fileURLToPath(new URL("./fixtures/kiro-pooling-cert.pem", import.meta.url));

for (const mode of ["kiro-direct", "kiro-proxy", "other-direct", "kiro-h2"] as const) {
  test(`model connection pooling: ${mode}`, { timeout: 30000 }, async () => {
    // A fresh process isolates global dispatcher, proxy environment and test CA.
    // Never disable certificate verification or change the parent process trust.
    const { stdout, stderr } = await execute(process.execPath, ["--import", "tsx", fixture, mode], {
      env: { ...process.env, NODE_EXTRA_CA_CERTS: certificate }, timeout: 25000, maxBuffer: 1024 * 1024,
    });
    assert.equal(stderr, "");
    const result = JSON.parse(stdout);
    assert.equal(result.mode, mode);
    assert.equal(result.passed, true);
    assert.equal(result.idempotent, true);
    assert.equal(result.afterIdle, mode === "other-direct" ? 2 : 1);
    if (mode === "kiro-proxy") {
      assert.equal(result.connectsAfterIdle, 1, "reuse the same CONNECT tunnel after >4s idle");
      assert.equal(result.proxyRejectionFailed, true);
      assert.equal(result.noProxyBypass, true);
    }
    if (mode !== "kiro-h2") assert.equal(result.shortHintReconnected, true);
    assert.equal(result.peerCloseReconnected, true);
  });
}
