/*!
 * Qoder protocol adapted from https://github.com/decolua/9router
 * commit 87a74e1bda3677193c6f71a7e2100c90311f0689.
 * Applies to qoder*.ts in this directory.
 *
 * MIT License
 * Copyright (c) 2024-2026 decolua and contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { constants, createCipheriv, createHash, publicEncrypt, randomUUID } from "node:crypto";

export type QoderRegion = "intl" | "cn";
export const qoderSites = {
  intl: { id: "qoder", name: "Qoder（实验性）", login: "https://qoder.com/device/selectAccounts", open: "https://openapi.qoder.sh", center: "https://center.qoder.sh", device: "https://api2.qoder.sh" },
  cn: { id: "qoder-cn", name: "Qoder 国内版（实验性）", login: "https://qoder.com.cn/device/selectAccounts", open: "https://openapi.qoder.com.cn", center: "https://gateway.qoder.com.cn", device: "https://gateway.qoder.com.cn" },
} as const;
export const qoderChatPath = "/algo/api/v2/service/pro/sse/agent_chat_generation";
export type QoderIdentity = { token: string; userId: string; machineId: string };
export class QoderError extends Error {}
const publicKey = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`;
const standard = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
const alphabet = "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!$";

export function encodeQoderBody(text: string): string {
  const base = Buffer.from(text, "utf8").toString("base64"), third = Math.floor(base.length / 3);
  return (base.slice(base.length - third) + base.slice(third, base.length - third) + base.slice(0, third))
    .split("").map(char => alphabet[standard.indexOf(char)]).join("");
}
// CLI 1.1.78 decrypt_server_response: swap thirds, custom Base64, strict UTF-8.
export function decodeQoderBody(text: string): string {
  if (!/^[\x00-\x7f]*$/.test(text)) throw new QoderError("Qoder 编码响应格式无效。");
  const third = Math.floor(text.length / 3);
  const rearranged = (text.slice(text.length - third) + text.slice(third, text.length - third) + text.slice(0, third)).replace(/[\r\n]/g, "");
  let base = "";
  for (const char of rearranged) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new QoderError("Qoder 编码响应含无效字符。");
    base += standard[index];
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base)) throw new QoderError("Qoder 编码响应填充无效。");
  const bytes = Buffer.from(base, "base64");
  if (bytes.toString("base64") !== base) throw new QoderError("Qoder 编码响应格式无效。");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new QoderError("Qoder 编码响应不是有效 UTF-8。"); }
}

// Never send bearer/COSY credentials to arbitrary election URLs, across regions or redirects.
export async function qoderInference(region: QoderRegion, identity: QoderIdentity, transport: typeof fetch, signal?: AbortSignal): Promise<string> {
  const data = await qoderJson(transport, `${qoderSites[region].center}/algo/api/v5/service/region/endpoints`, {
    signal, headers: { Accept: "application/json", Authorization: `Bearer ${identity.token}`, "x-gw-user-id": identity.userId,
      "Cosy-MachineId": identity.machineId, "Cosy-MachineToken": identity.machineId },
  }, true);
  if (!Array.isArray(data.inferNodes) || !data.inferNodes.length) throw new QoderError("Qoder 未返回可用推理端点；当前不支持私有或匿名 V3 端点选举。");
  const allowed: readonly string[] = region === "cn" ? ["https://gateway.qoder.com.cn"] : ["https://api1.qoder.sh", "https://api2.qoder.sh", "https://api3.qoder.sh"];
  const origins = data.inferNodes.map(node => {
    const value = typeof node === "string" ? node : object(node).url;
    if (typeof node !== "string" && object(node).type && object(node).type !== "public") throw new QoderError("Qoder 企业端点尚未支持。");
    if (typeof value !== "string") throw new QoderError("Qoder 端点格式无效。");
    let url: URL;
    try { url = new URL(value); } catch { throw new QoderError("Qoder 端点格式无效。"); }
    if (!allowed.includes(url.origin) || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
      throw new QoderError("Qoder 返回了未授权地区或私有端点，已阻止发送凭据。");
    return url.origin;
  });
  return origins[0];
}

const md5 = (value: string | Buffer) => createHash("md5").update(value).digest("hex");
export function qoderHeaders(body: string, url: string, identity: QoderIdentity): Record<string, string> {
  if (!identity.userId || !identity.token || !identity.machineId) throw Error("Qoder 凭据不完整，请重新登录。");
  const key = Buffer.from(randomUUID().slice(0, 16));
  const cipher = createCipheriv("aes-128-cbc", key, key);
  const info = Buffer.concat([cipher.update(JSON.stringify({ uid: identity.userId, security_oauth_token: identity.token, name: "", aid: "", email: "" }), "utf8"), cipher.final()]).toString("base64");
  const cosyKey = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_PADDING }, key).toString("base64");
  const payload = Buffer.from(JSON.stringify({ version: "v1", requestId: randomUUID(), info, cosyVersion: "1.0.0", ideVersion: "" })).toString("base64");
  const timestamp = String(Math.floor(Date.now() / 1000)), path = new URL(url).pathname.replace(/^\/algo(?=\/)/, "");
  const bytes = Buffer.from(body, "utf8");
  const signature = md5(Buffer.concat([Buffer.from(`${payload}\n${cosyKey}\n${timestamp}\n`), bytes, Buffer.from(`\n${path}`)]));
  return {
    Authorization: `Bearer COSY.${payload}.${signature}`, "Cosy-Key": cosyKey, "Cosy-User": identity.userId,
    "Cosy-Date": timestamp, "Cosy-Version": "1.0.0", "Cosy-Machineid": identity.machineId,
    "Cosy-Machinetoken": identity.machineId, "Cosy-Machinetype": "5", "Cosy-Machineos": "x86_64_windows",
    "Cosy-Clienttype": "5", "Cosy-Clientip": "127.0.0.1", "Cosy-Bodyhash": md5(bytes),
    "Cosy-Bodylength": String(bytes.length), "Cosy-Sigpath": path, "Cosy-Data-Policy": "disagree",
    "Cosy-Organization-Id": "", "Cosy-Organization-Tags": "", "Login-Version": "v2", "X-Request-Id": randomUUID(),
  };
}

export function qoderFailure(status: number, code?: unknown): Error {
  const numericCode = typeof code === "number" || typeof code === "string" && /^\d+$/.test(code) ? Number(code) : undefined;
  if (status === 401 || status === 403) return new QoderError(`Qoder 认证或权限失败（HTTP ${status}），请检查账号地区并重新登录。`);
  if (status === 429 || [110, 112, 10605].includes(numericCode ?? -1)) return new QoderError("Qoder 额度不足或请求过于频繁，请检查账号额度后重试。");
  return new QoderError(`Qoder 请求失败（HTTP ${status}${numericCode === undefined ? "" : `，code ${numericCode}`}）。`);
}
export function qoderSignal(signal?: AbortSignal | null, timeout = 15000) {
  return AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeout)]);
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new QoderError("Qoder 响应格式无效。");
  return value as Record<string, unknown>;
}
export async function qoderReadJson(response: Response, encoded = false, signal?: AbortSignal): Promise<Record<string, unknown>> {
  if (!response.body) throw new QoderError("Qoder 响应为空。");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const item = await reader.read();
      signal?.throwIfAborted();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > 4 * 1024 * 1024) throw new QoderError("Qoder 响应超过本地安全限制。");
      chunks.push(item.value);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    let value: unknown;
    try { value = JSON.parse(text); }
    catch { if (!encoded) throw new QoderError("Qoder 响应格式无效。"); value = JSON.parse(decodeQoderBody(text)); }
    return object(value);
  } finally { signal?.removeEventListener("abort", abort); void reader.cancel().catch(() => {}); }
}
export async function qoderJson(transport: typeof fetch, url: string, init: RequestInit, encoded = false): Promise<Record<string, unknown>> {
  const signal = qoderSignal(init.signal);
  try {
    const response = await transport(url, { ...init, redirect: "error", signal });
    if (!response.ok) { await response.body?.cancel(); throw qoderFailure(response.status); }
    return await qoderReadJson(response, encoded, signal);
  } catch (error) {
    init.signal?.throwIfAborted();
    if (error instanceof QoderError) throw error;
    throw Error(signal.aborted ? "Qoder 请求超时，请重试。" : "Qoder 网络或响应异常，请检查连接后重试。");
  }
}
