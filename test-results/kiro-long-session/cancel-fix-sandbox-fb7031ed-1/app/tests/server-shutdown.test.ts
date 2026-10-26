import assert from "node:assert/strict";
import { test } from "node:test";
import { createConnection } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { startServer } from "../src/server/index.js";

test("shutdown closes incomplete HTTP requests and releases the service storage lock", { timeout: 30000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "axiom-http-shutdown-"));
  const previousPi = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  t.after(() => {
    if (previousPi === undefined) delete process.env.AXIOM_PI_DIR;
    else process.env.AXIOM_PI_DIR = previousPi;
  });
  const app = await startServer({ root, port: 0 });
  const url = new URL(app.origin);
  const socket = createConnection({ host: url.hostname, port: Number(url.port) });
  socket.on("error", () => {});
  const disconnected = new Promise<void>((resolve) => socket.once("close", () => resolve()));
  let closing: Promise<void> | undefined;
  try {
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    // Leave request headers incomplete; there is no response body to drain.
    socket.write(`GET / HTTP/1.1\r\nHost: ${url.host}\r\n`);
    await delay(50);
    closing = app.close();
    await Promise.race([
      Promise.all([closing, disconnected]),
      delay(5000, undefined, { ref: false }).then(() => { throw Error("Incomplete HTTP client blocked shutdown"); }),
    ]);
    assert.equal(socket.destroyed, true);
    const restarted = await startServer({ root, port: Number(url.port) });
    await restarted.close();
  } finally {
    socket.destroy();
    await (closing ?? app.close());
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
