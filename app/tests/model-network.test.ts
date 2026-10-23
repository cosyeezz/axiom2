import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket, AddressInfo } from "node:net";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { modelNetwork, closeModelNetworks } from "../src/server/model-network.js";
import { ModelService } from "../src/server/model-service.js";

async function bounded<T>(promise: Promise<T>, ms = 15000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("fixture deadline")), ms); })]); }
  finally { clearTimeout(timer); }
}
async function until(check: () => boolean) {
  const deadline = Date.now() + 15000;
  while (!check()) { assert.ok(Date.now() < deadline, "expected worker request"); await new Promise(resolve => setTimeout(resolve, 10)); }
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-model-network-")), dir = join(root, "pi");
  mkdirSync(dir);
  return { root, dir, file: join(dir, "models.json") };
}

test("malformed provider configuration never returns secret JSON fragments", async () => {
  const { root, dir, file } = fixture();
  try {
    writeFileSync(file, '{"providers":PRIVATE_SECRET_FRAGMENT}');
    await assert.rejects(modelNetwork(root, dir, "fixture", file, "checkAuth"), error =>
      (error as any).code === "CONFIG_READ_FAILED" && !String(error).includes("PRIVATE_SECRET"));
  } finally { await closeModelNetworks(root); rmSync(root, { recursive: true, force: true }); }
});

test("queued catalog cancellation does not wait for the configuration writer", { timeout: 10000 }, async () => {
  const { root, dir } = fixture(), previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = dir;
  try {
    for (const network of [modelNetwork, null]) {
      const service = new ModelService(root, network), controller = new AbortController();
      let release: (() => void) | undefined;
      const writer = service.serial(() => new Promise<void>(resolve => { release = resolve; }));
      try {
        await until(() => !!release);
        const pending = assert.rejects(service.catalog("fixture", "unused", controller.signal), { code: "AGENT_STOPPED" });
        controller.abort(); await bounded(pending, 1000);
      } finally { release?.(); await writer; }
    }
  } finally {
    await closeModelNetworks(root);
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("catalog workers never migrate credentials belonging to another provider", { timeout: 20000 }, async () => {
  const { root, dir, file } = fixture(), previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = dir;
  const server = createServer((_request, response) => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ data: [{ id: "remote-model" }] })); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const connection = { api: "openai-completions", baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, models: [] };
  const raw = JSON.stringify({ providers: {
    primary: connection,
    foreign: { ...connection, apiKey: "UNRELATED-LEGACY-KEY", axiomProxy: { mode: "builtin", profileId: "00000000-0000-0000-0000-000000000000" } },
  } });
  writeFileSync(file, raw);
  writeFileSync(join(dir, "auth.json"), JSON.stringify({ primary: { type: "api_key", key: "PRIMARY-KEY" } }));
  try {
    const service = new ModelService(root), revision = createHash("sha256").update(raw).digest("hex");
    const result = await bounded(service.catalog("primary", revision));
    assert.equal(result.models[0].id, "remote-model");
    assert.equal(readFileSync(file, "utf8"), raw, "another provider's legacy key stays in its original configuration");
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, "auth.json"), "utf8"))), ["primary"]);
  } finally {
    await closeModelNetworks(root); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("real IPC relays native API key prompts, persists credentials and cancels an active prompt", { timeout: 30000 }, async () => {
  const { root, dir, file } = fixture();
  writeFileSync(file, JSON.stringify({ providers: { fixture: { api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", models: [] } } }));
  try {
    let prompts = 0;
    await bounded(modelNetwork(root, dir, "fixture", file, "login", { type: "api_key" }, {
      prompt: async prompt => { assert.equal(prompt.type, "secret"); prompts++; return "IPC-FIXTURE-KEY"; },
    }));
    assert.equal(prompts, 1);
    assert.equal(JSON.parse(readFileSync(join(dir, "auth.json"), "utf8")).fixture.key, "IPC-FIXTURE-KEY");
    const controller = new AbortController();
    const cancelled = assert.rejects(modelNetwork(root, dir, "fixture", file, "login", { type: "api_key" }, {
      signal: controller.signal,
      prompt: async prompt => { prompts++; return new Promise<string>((_, reject) => prompt.signal!.addEventListener("abort", () => reject(prompt.signal!.reason), { once: true })); },
    }), { code: "MODEL_NETWORK_CANCELLED" });
    await until(() => prompts === 2); controller.abort(); await bounded(cancelled, 5000);
    assert.equal(JSON.parse(readFileSync(join(dir, "auth.json"), "utf8")).fixture.key, "IPC-FIXTURE-KEY", "cancellation preserves prior credentials");
  } finally { await closeModelNetworks(root); rmSync(root, { recursive: true, force: true }); }
});

test("provider workers isolate proxy routes, serialize requests and settle queued cancellation and shutdown", { timeout: 45000 }, async () => {
  const { root, dir, file } = fixture(), sockets = new Set<Socket>();
  const requests: { label: string; host: string | undefined }[] = [], held: (() => void)[] = [];
  const servers: ReturnType<typeof createServer>[] = [];
  let hold = false, active = 0, maxActive = 0;
  const previous = process.env.HTTP_PROXY;
  const respond = (response: ServerResponse, id: string) => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ data: [{ id }] })); };
  async function proxy(label: string) {
    const handler = (request: IncomingMessage, response: ServerResponse) => {
      requests.push({ label, host: request.headers.host }); active++; maxActive = Math.max(maxActive, active);
      response.once("close", () => { active--; });
      if (hold) held.push(() => respond(response, label)); else respond(response, label);
    };
    const inner = createServer(handler), outer = createServer(handler); servers.push(inner, outer);
    outer.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
    outer.on("connect", (_request, socket, head) => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n"); inner.emit("connection", socket); if (head.length) socket.unshift(head);
    });
    await new Promise<void>(resolve => outer.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(outer.address() as AddressInfo).port}`;
  }
  try {
    const a = await proxy("A"), b = await proxy("B");
    process.env.HTTP_PROXY = "http://127.0.0.1:1";
    const raw = JSON.stringify({ providers: Object.fromEntries([["alpha", a], ["beta", b]].map(([id, url]) => [id, {
      api: "openai-completions", baseUrl: `http://${id}.invalid/v1`, models: [{ id: "seed" }], axiomProxy: { mode: "external", url },
    }])) });
    writeFileSync(file, raw);
    writeFileSync(join(dir, "auth.json"), JSON.stringify({ alpha: { type: "api_key", key: "A" }, beta: { type: "api_key", key: "B" } }));
    const revision = createHash("sha256").update(raw).digest("hex");
    const call = (provider: string, signal?: AbortSignal) => modelNetwork<any>(root, dir, provider, file, "catalog", { revision }, { signal });
    hold = true;
    const parallel = Promise.all([call("alpha"), call("beta")]);
    void parallel.catch(() => {}); // A deadline failure must still await cleanup without an unhandled rejection.
    await until(() => requests.length === 2);
    hold = false; held.splice(0).forEach(reply => reply());
    const [alpha, beta] = await bounded(parallel);
    assert.equal(alpha.models[0].id, "A"); assert.equal(beta.models[0].id, "B");
    assert.ok(requests.every(request => request.host === (request.label === "A" ? "alpha.invalid" : "beta.invalid")));
    assert.equal(maxActive, 2); assert.equal(process.env.HTTP_PROXY, "http://127.0.0.1:1");
    maxActive = 0;
    await bounded(Promise.all([call("alpha"), call("alpha"), call("alpha")]));
    assert.equal(maxActive, 1);
    hold = true;
    const before = requests.length, head = call("alpha");
    void head.catch(() => {});
    await until(() => requests.length === before + 1);
    const controller = new AbortController();
    const queued = assert.rejects(call("alpha", controller.signal), { code: "MODEL_NETWORK_CANCELLED" });
    controller.abort(); await bounded(queued, 1000);
    assert.equal(requests.length, before + 1, "cancelled queued work never reaches the provider");
    hold = false; held.splice(0).forEach(reply => reply()); await bounded(head);
    assert.equal((await bounded(call("alpha"))).models[0].id, "A");
    hold = true;
    const closeStart = requests.length, running = assert.rejects(call("beta"), { code: "MODEL_NETWORK_FAILED" });
    await until(() => requests.length === closeStart + 1);
    const waiting = assert.rejects(call("beta"), { code: "MODEL_NETWORK_FAILED" });
    await bounded(closeModelNetworks(root), 5000); await bounded(Promise.all([running, waiting]), 1000);
  } finally {
    await closeModelNetworks(root);
    for (const socket of sockets) socket.destroy();
    for (const server of servers) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    if (previous === undefined) delete process.env.HTTP_PROXY; else process.env.HTTP_PROXY = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
