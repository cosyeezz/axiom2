// Evaluated directly by the native host: no CLI import, helper publication,
// startup database access, stale-owner reclamation, or filesystem writes.
import { open, constants } from "node:fs/promises";
import { join } from "node:path";

async function cleanupStatus() {
  const root = process.env.AXIOM_DATA_DIR;
  if (!root) throw Error("缺少数据目录");
  const file = await open(join(root, "service-control.json"), constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  let meta;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16384) throw Error("后台控制记录无效");
    const bytes = Buffer.alloc(16385);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 16384) throw Error("后台控制记录过大");
    meta = JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
  } finally { await file.close(); }
  if (!Number.isInteger(meta?.port) || meta.port < 1 || meta.port > 65535 || !/^[a-f0-9]{64}$/.test(meta.token)) throw Error("后台控制记录无效");
  const response = await fetch(`http://127.0.0.1:${meta.port}/status`, {
    method: "GET", redirect: "error", headers: { Authorization: `Bearer ${meta.token}` }, signal: AbortSignal.timeout(2000),
  });
  if (!response.ok || !response.body) throw Error("后台控制通道不可用");
  const chunks = []; let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65536) throw Error("后台状态过大");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (result.instance !== meta.token || !["starting", "running", "stopping"].includes(result.state)) throw Error("后台身份不匹配");
  // Only forward the fields needed by the native cleanup router, never the token.
  return { state: result.state, url: result.url };
}
try { console.log(JSON.stringify(await cleanupStatus())); }
catch { console.log(JSON.stringify({ state: "unknown", message: "后台运行状态未获只读核实" })); }
