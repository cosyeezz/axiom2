import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, readdirSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createTrap } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { gzipSync } from "node:zlib";
import { test } from "node:test";
import { atomicProxyJson, proxyConfigPath, proxyDirectory, proxyExecutable, readProxyConfig } from "../src/server/integrations/model-proxy-config.js";
import { readProxyShareSource } from "../src/server/integrations/model-proxy-share-source.js";
import { shareSourceLines } from "../src/server/integrations/model-proxy-xray-import.js";
import { xrayImporterDirectory, xrayImporterRelease } from "../src/server/integrations/model-proxy-xray-installer.js";
import { ModelProxyService } from "../src/server/integrations/model-proxy.js";

const archive = process.env.AXIOM_TEST_XRAY_IMPORTER_ZIP, native = process.env.AXIOM_TEST_XRAY;
const cmd = (op: string, params: Record<string, unknown> = {}) => ({ op: `modelProxy.${op}`, requestId: randomUUID(), params });
async function completed(service: ModelProxyService) {
  const end = Date.now() + 20000;
  while (service.snapshot().job?.running && Date.now() < end) await delay(15);
  assert.equal(service.snapshot().job?.running, false); return service.snapshot();
}
function fixture(withCore = false) {
  const root = mkdtempSync(join(tmpdir(), "axiom-xray-import-"));
  if (archive) {
    mkdirSync(xrayImporterDirectory(root), { recursive: true });
    copyFileSync(archive, join(xrayImporterDirectory(root), xrayImporterRelease().asset));
  }
  const installation = { version: "26.10.21", directory: `xray-26.10.21-${randomUUID()}` };
  if (withCore && native) {
    const file = proxyExecutable(root, "xray", installation); mkdirSync(dirname(file), { recursive: true }); copyFileSync(native, file);
  }
  atomicProxyJson(proxyConfigPath(root), { revision: "initial", profiles: [], bindings: {}, installations: withCore ? { xray: installation } : {} });
  return { root, service: new ModelProxyService(root, () => {}) };
}
const key = generateKeyPairSync("x25519").publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64url");
const link = (name: string, port = 443, publicKey = key) => `vless://11111111-1111-4111-8111-111111111111@127.0.0.1:${port}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=example.invalid&fp=chrome&pbk=${publicKey}&sid=abcd&type=tcp&headerType=none#${encodeURIComponent(name)}`;

test("importer pins official assets and SHA256 for all six platforms", () => {
  const hashes = new Set<string>();
  for (const platform of ["darwin", "linux", "win32"]) for (const arch of ["arm64", "x64"]) {
    const release = xrayImporterRelease(platform, arch);
    assert.equal(release.version, "11.4.1"); assert.match(release.sha256, /^[0-9a-f]{64}$/);
    assert.equal(release.url, `https://github.com/lilendian0x00/xray-knife/releases/download/v11.4.1/${release.asset}`);
    hashes.add(release.sha256);
  }
  assert.equal(hashes.size, 6); assert.throws(() => xrayImporterRelease("freebsd", "x64"));
});

test("subscription containers support plain, standard and URL-safe Base64 lists with bounded entry counts", () => {
  const source = `${link("中文 A")}\n${link("中文 B")}`;
  for (const input of [source, Buffer.from(source).toString("base64"), Buffer.from(source).toString("base64url")]) assert.deepEqual(shareSourceLines(input), source.split("\n"));
  assert.deepEqual(shareSourceLines(`# comment\n${source}\n`), source.split("\n"));
  assert.throws(() => shareSourceLines(Array(2001).fill("vless://example").join("\n")));
  assert.throws(() => shareSourceLines("vless://" + "x".repeat(2_000_000)));
});

test("subscription fetch bounds decoded bytes, redirects, errors and cancellation without credential echoes", { timeout: 15000 }, async () => {
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    if (req.url === "/redirect") { res.writeHead(302, { location: "/ok" }); res.end(); }
    else if (req.url === "/loop") { res.writeHead(302, { location: "/loop" }); res.end(); }
    else if (req.url === "/ok") res.end(link("订阅节点"));
    else if (req.url === "/exact") res.end("x".repeat(2_000_000));
    else if (req.url === "/gzip") { res.writeHead(200, { "Content-Encoding": "gzip" }); res.end(gzipSync("x".repeat(2_000_001))); }
    else if (req.url === "/oversize") { res.writeHead(200, { "Content-Length": "2000001" }); res.end(); }
    else if (req.url === "/slow") { res.writeHead(200); res.write("x"); }
    else { res.writeHead(403); res.end("PRIVATE-TOKEN"); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    assert.equal(await readProxyShareSource(`${origin}/redirect`, AbortSignal.timeout(5000)), link("订阅节点"));
    assert.equal((await readProxyShareSource(`${origin}/exact`, AbortSignal.timeout(5000))).length, 2_000_000);
    for (const path of ["/gzip", "/oversize", "/loop", "/PRIVATE-TOKEN"]) await assert.rejects(readProxyShareSource(origin + path, AbortSignal.timeout(5000)), error => !String(error).includes("PRIVATE-TOKEN"));
    const before = requests;
    await assert.rejects(readProxyShareSource(origin.replace("http://", "http://PRIVATE-TOKEN@") + "/ok", AbortSignal.timeout(5000)), error => !String(error).includes("PRIVATE-TOKEN"));
    assert.equal(requests, before);
    const controller = new AbortController();
    const waiting = readProxyShareSource(`${origin}/slow`, controller.signal);
    const rejected = assert.rejects(waiting, /取消/); await delay(50); controller.abort(); await rejected;
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("Xray invalid inputs require neither core and return sanitized errors", async () => {
  const { root, service } = fixture();
  try {
    await assert.rejects(service.command(cmd("inspect", { kernel: "unknown", source: "PRIVATE-TOKEN" })), { code: "INVALID_INPUT" });
    await service.command(cmd("inspect", { kernel: "xray", source: "PRIVATE-TOKEN" }));
    const result = await completed(service);
    assert.ok(result.job?.error); assert.equal(JSON.stringify(result).includes("PRIVATE-TOKEN"), false);
    assert.equal(result.inspection, undefined); assert.deepEqual(result.installations, {});
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("real CLI imports without mihomo or Xray, binds private results to source and node, and preserves blank edits", { skip: !archive, timeout: 30000 }, async () => {
  const { root, service } = fixture();
  const source = `${link("节点 A")}\n${link("节点 B")}\n${link("节点 A")}\nunsupported://PRIVATE-TOKEN`;
  try {
    const request = cmd("inspect", { kernel: "xray", source });
    const accepted = await service.command(request);
    assert.equal(accepted.job?.id, request.requestId);
    const result = await completed(service); assert.equal(result.job?.error, undefined);
    assert.equal(result.inspection?.id, request.requestId);
    assert.deepEqual(result.inspection?.nodes, [{ name: "节点 A", type: "vless" }, { name: "节点 B", type: "vless" }]);
    assert.match(result.job!.message, /跳过 2/); assert.deepEqual(result.installations, {});
    for (const secret of [key, "11111111-1111", "PRIVATE-TOKEN", "outbounds", "streamSettings"]) assert.equal(JSON.stringify(result).includes(secret), false);
    const fields = { revision: "initial", name: "选择 B", kernel: "xray", source, node: "节点 B", inspectionId: result.inspection!.id };
    for (const invalid of [{ source: source + "\nx" }, { node: "missing" }, { inspectionId: "expired" }]) await assert.rejects(service.command(cmd("save", { ...fields, ...invalid })), { code: "INSPECTION_REQUIRED" });
    const saved = await service.command(cmd("save", fields));
    const profile = readProxyConfig(root).profiles[0], outbound = JSON.parse(profile.source);
    assert.equal(outbound.protocol, "vless"); assert.equal(outbound.streamSettings.security, "reality");
    assert.equal(outbound.settings.vnext[0].users[0].flow, "xtls-rprx-vision");
    assert.equal(profile.node, "节点 B"); assert.equal(profile.enabled, false); assert.equal(saved.inspection, undefined);
    assert.equal(profile.source.includes("unsupported://"), false);
    await assert.rejects(service.command(cmd("save", { ...fields, revision: saved.revision })), { code: "INSPECTION_REQUIRED" });
    const edited = await service.command(cmd("save", { revision: saved.revision, id: profile.id, name: "重命名", kernel: "xray", source: "", node: "" }));
    assert.equal(readProxyConfig(root).profiles[0].source, profile.source); assert.equal(edited.profiles[0].node, "节点 B");
    await assert.rejects(service.command(cmd("save", { revision: edited.revision, id: profile.id, name: "切换", kernel: "mihomo", source: "", node: "new" })), { code: "INVALID_INPUT" });
    // No source or outbound is written into the tool cache.
    for (const file of readdirSync(xrayImporterDirectory(root))) assert.ok(!file.endsWith(".tmp") && !file.endsWith(".json"));
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("a later inspection invalidates old tokens, native JSON remains available, subscriptions snapshot the selected node", { skip: !archive, timeout: 30000 }, async () => {
  const { root, service } = fixture();
  const source = link("old"); let hits = 0;
  const server = createServer((_req, res) => { hits++; res.end(Buffer.from(`${link("订阅 A")}\n${link("订阅 B")}`).toString("base64")); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/sub?token=SYNTHETIC`;
  try {
    await service.command(cmd("inspect", { kernel: "xray", source })); const old = (await completed(service)).inspection!;
    await service.command(cmd("inspect", { kernel: "xray", source: url })); const current = await completed(service);
    assert.equal(current.job?.error, undefined); assert.equal(hits, 1);
    await assert.rejects(service.command(cmd("save", { revision: "initial", kernel: "xray", name: "old", source, node: "old", inspectionId: old.id })), { code: "INSPECTION_REQUIRED" });
    await service.command(cmd("save", { revision: "initial", kernel: "xray", name: "订阅 B", source: url, node: "订阅 B", inspectionId: current.inspection!.id }));
    assert.equal(hits, 1); assert.equal(readFileSync(proxyConfigPath(root), "utf8").includes("SYNTHETIC"), false);
    const nativeJson = JSON.stringify({ protocol: "socks", settings: { servers: [{ address: "127.0.0.1", port: 9 }] } });
    await service.command(cmd("save", { revision: service.snapshot().revision, kernel: "xray", name: "native", source: nativeJson, node: "ignored" }));
    assert.equal(service.snapshot().profiles[1].node, "");
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("service cancellation closes a hanging subscription and cannot leave stale inspection state", { timeout: 10000 }, async () => {
  const { root, service } = fixture();
  const server = createServer((_req, res) => { res.writeHead(200); res.write("waiting"); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const source = `http://127.0.0.1:${(server.address() as { port: number }).port}/slow`;
    const started = await service.command(cmd("inspect", { kernel: "xray", source }));
    await assert.rejects(service.command(cmd("save", { revision: "initial" })), { code: "BUSY" });
    await delay(50); const cancelled = await service.command(cmd("cancel", { jobId: started.job!.id }));
    assert.equal(cancelled.job?.running, false); assert.equal(cancelled.job?.message, "操作已取消。"); assert.equal(cancelled.inspection, undefined);
    await service.command(cmd("inspect", { kernel: "xray", source })); await delay(50); await service.close();
    assert.equal(service.snapshot().inspection, undefined); assert.equal(service.snapshot().job?.running, false);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("real Xray validates and starts an imported Reality/Vision outbound without dialing the node; bad key fails closed", { skip: !archive || !native, timeout: 30000 }, async () => {
  const { root, service } = fixture(true); let connections = 0;
  const trap = createTrap(socket => { connections++; socket.destroy(); });
  await new Promise<void>(resolve => trap.listen(0, "127.0.0.1", resolve));
  const port = (trap.address() as { port: number }).port;
  try {
    for (const publicKey of [key, "bad-key"]) {
      const source = link("本地离线", port, publicKey);
      await service.command(cmd("inspect", { kernel: "xray", source })); const imported = await completed(service);
      assert.equal(imported.job?.error, undefined);
      const saved = await service.command(cmd("save", { revision: imported.revision, kernel: "xray", name: "native", node: "本地离线", source, inspectionId: imported.inspection!.id }));
      const id = saved.profiles.at(-1)!.id;
      await service.command(cmd("start", { revision: saved.revision, id })); const running = await completed(service);
      if (publicKey === key) {
        assert.equal(running.job?.error, undefined); assert.equal(running.profiles.at(-1)!.status, "running");
        await service.command(cmd("stop", { revision: running.revision, id }));
      } else {
        assert.match(running.job?.error ?? "", /内核配置校验失败/); assert.equal(running.profiles.at(-1)!.status, "error");
      }
      assert.equal(connections, 0);
    }
    const runs = join(proxyDirectory(root), "runs"); assert.deepEqual(existsSync(runs) ? readdirSync(runs) : [], []);
  } finally { await service.close(); await new Promise<void>(resolve => trap.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});
