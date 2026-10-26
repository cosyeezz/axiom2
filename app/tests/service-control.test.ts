import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, realpath, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

test("service stop waits through a transient control failure while the same instance is stopping", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "axiom-service-stop-"));
  const previousRoot = process.env.AXIOM_DATA_DIR;
  const previousPort = process.env.AXIOM_PORT;
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  process.env.AXIOM_PORT = String((probe.address() as { port: number }).port);
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  process.env.AXIOM_DATA_DIR = root;
  t.after(async () => {
    if (previousRoot === undefined) delete process.env.AXIOM_DATA_DIR;
    else process.env.AXIOM_DATA_DIR = previousRoot;
    if (previousPort === undefined) delete process.env.AXIOM_PORT;
    else process.env.AXIOM_PORT = previousPort;
    await rm(root, { recursive: true, force: true });
  });
  const token = "a".repeat(64);
  const descriptor = join(root, "service-control.json");
  await writeFile(descriptor, JSON.stringify({ port: 12345, token }));
  let stopping = false;
  let polls = 0;
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    if (options.method === "POST") stopping = true;
    else if (stopping) {
      polls++;
      if (polls === 1) throw new TypeError("simulated connection reset");
      if (polls === 3) {
        await rm(descriptor);
        throw new TypeError("service has closed its control listener");
      }
    }
    return new Response(JSON.stringify({ instance: token, state: stopping ? "stopping" : "running", active: [] }));
  });
  const { stop } = await import(new URL("../../bin/service.mjs", import.meta.url).href);
  assert.equal((await stop()).state, "stopped");
  assert.equal(polls, 3, "stop must continue after reconnecting to the same stopping instance");
});

test("failed foreground launch cannot overwrite the registration of an existing service", async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "fg-serve-")));
  const oldRoot = process.env.AXIOM_DATA_DIR, oldPort = process.env.AXIOM_PORT;
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  process.env.AXIOM_DATA_DIR = root; process.env.AXIOM_PORT = String((probe.address() as { port: number }).port);
  t.after(async () => {
    if (oldRoot === undefined) delete process.env.AXIOM_DATA_DIR; else process.env.AXIOM_DATA_DIR = oldRoot;
    if (oldPort === undefined) delete process.env.AXIOM_PORT; else process.env.AXIOM_PORT = oldPort;
    await new Promise<void>((resolve) => probe.close(() => resolve())); await rm(root, { recursive: true, force: true });
  });
  const registration = JSON.stringify({ node: "retained-node", cli: "retained-service-cli" });
  await writeFile(join(root, "installation.json"), registration);
  const module = new URL("../../bin/service.mjs", import.meta.url); module.search = "?failed-foreground-isolated";
  const { serve } = await import(module.href);
  let initialized = false;
  await assert.rejects(serve(false, { initialize: async () => { initialized = true; throw Error("must not initialize a real backend"); } }), /服务已经运行或正在启动/);
  assert.equal(initialized, false); assert.equal(await readFile(join(root, "installation.json"), "utf8"), registration);
});
