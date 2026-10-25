import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("execution permits preserve rejection identity across batched retirement and ignore stale leases", () => {
  // A separate process gives the production protocol an immutable worker identity
  // without changing the test runner's IPC channel or module cache.
  const script = `
    import assert from "node:assert/strict";
    import { awaitExecutionPermit, ExecutionPermitDeniedError, workerInstance } from "./src/server/execution-protocol.ts";
    const lease = { instanceId: workerInstance.instanceId, generation: workerInstance.generation, leaseId: "current" };
    const denied = { type: "execution_permit", lease, allowed: false, rejection: { check: "auth", secret: "PRIVATE_CANARY" } };
    const shutdown = { type: "shutdown", instance: workerInstance };
    const stop = { type: "stop", lease };
    const allowed = { type: "execution_permit", lease, allowed: true };
    const cases = [
      { name: "denial before retirement", events: [denied, shutdown], expected: "denied" },
      { name: "retirement alone", events: [shutdown], expected: "cancelled" },
      { name: "retirement before denial", events: [shutdown, denied], expected: "cancelled" },
      { name: "stop before denial", events: [stop, denied, shutdown], expected: "cancelled" },
      { name: "stale lease cannot reject current permit", events: [{ ...denied, lease: { ...lease, leaseId: "old" } }, allowed], expected: "allowed" },
    ];
    for (const scenario of cases) {
      const messagesBefore = process.listenerCount("message");
      const disconnectsBefore = process.listenerCount("disconnect");
      const pending = awaitExecutionPermit(lease, true).then(() => "allowed", (error) => {
        if (error instanceof ExecutionPermitDeniedError) {
          assert.deepEqual(error.rejection, { check: "auth" });
          assert.equal(error.message.includes("PRIVATE_CANARY"), false);
          return "denied";
        }
        assert.equal(error.message, "执行已取消", scenario.name);
        return "cancelled";
      });
      // Node IPC can deliver several nextTick messages before Promise handlers.
      for (const event of scenario.events) process.nextTick(() => process.emit("message", event));
      assert.equal(await pending, scenario.expected, scenario.name);
      assert.equal(process.listenerCount("message"), messagesBefore, scenario.name);
      assert.equal(process.listenerCount("disconnect"), disconnectsBefore, scenario.name);
    }
    console.log("5 protocol scenarios passed");
  `;
  const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, AXIOM_EXECUTION_INSTANCE: "permit-test", AXIOM_EXECUTION_GENERATION: "1", AXIOM_EXECUTION_PROFILE: "test-profile" },
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(output.trim(), "5 protocol scenarios passed");
});
