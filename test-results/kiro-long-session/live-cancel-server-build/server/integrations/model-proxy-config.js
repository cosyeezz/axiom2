import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
export const proxyDirectory = (root) => join(root, "integrations", "model-proxy");
export const proxyConfigPath = (root) => join(proxyDirectory(root), "config.json");
export const proxyRuntimePath = (root) => join(proxyDirectory(root), "runtime.json");
export const proxyExecutable = (root, kernel, install) => join(proxyDirectory(root), "versions", install.directory, kernel + (process.platform === "win32" ? ".exe" : ""));
export const proxyVersionDirectoryPattern = /^(xray|mihomo)-\d+\.\d+\.\d+-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const proxyImporterDirectoryPattern = /^xray-knife-\d+\.\d+\.\d+-(darwin|linux|win32)-(x64|arm64)$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
export function atomicProxyJson(file, value) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    if (process.platform !== "win32")
        chmodSync(dirname(file), 0o700);
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
        writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
        renameSync(temp, file);
    }
    finally {
        rmSync(temp, { force: true });
    }
}
export function readProxyConfig(root) {
    let value;
    try {
        value = JSON.parse(readFileSync(proxyConfigPath(root), "utf8"));
    }
    catch (error) {
        if (error.code === "ENOENT")
            return { revision: "", installations: {}, profiles: [], bindings: {} };
        throw Error("无法读取模型转发配置；请检查文件权限和内容。");
    }
    if (!record(value) || typeof value.revision !== "string" || !Array.isArray(value.profiles) || !record(value.bindings) || !record(value.installations))
        throw Error("模型转发配置格式无效。");
    if (value.removalPending !== undefined && (!Array.isArray(value.removalPending) || value.removalPending.some(name => typeof name !== "string" || !proxyVersionDirectoryPattern.test(name) && !proxyImporterDirectoryPattern.test(name))))
        throw Error("内核待清理记录无效。");
    const ids = new Set();
    for (const p of value.profiles) {
        if (!record(p) || typeof p.id !== "string" || !uuid.test(p.id) || ids.has(p.id) || (p.kernel !== "xray" && p.kernel !== "mihomo") || typeof p.source !== "string" || typeof p.name !== "string" || typeof p.node !== "string" || (p.enabled !== undefined && typeof p.enabled !== "boolean"))
            throw Error("模型转发线路格式无效或 ID 重复。");
        ids.add(p.id);
    }
    for (const [id, route] of Object.entries(value.bindings))
        if (!id || typeof route !== "string" || !ids.has(route))
            throw Error("供应商绑定的线路不存在。");
    for (const [kernel, install] of Object.entries(value.installations)) {
        if ((kernel !== "xray" && kernel !== "mihomo") || !record(install) || typeof install.version !== "string" || !/^\d+\.\d+\.\d+$/.test(install.version) || typeof install.directory !== "string")
            throw Error("内核安装记录无效。");
        const prefix = `${kernel}-${install.version}-`;
        if (!install.directory.startsWith(prefix) || !uuid.test(install.directory.slice(prefix.length)))
            throw Error("内核安装目录无效。");
    }
    return value;
}
const caches = new Map();
function cached(file, load, missing) {
    try {
        const stat = statSync(file), stamp = `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
        const old = caches.get(file);
        if (old?.stamp === stamp)
            return old.value;
        const value = load();
        caches.set(file, { stamp, value });
        return value;
    }
    catch (error) {
        if (error.code === "ENOENT") {
            caches.delete(file);
            return missing();
        }
        throw error;
    }
}
export function proxyBinding(root, provider) {
    const config = cached(proxyConfigPath(root), () => readProxyConfig(root), () => ({ bindings: {} }));
    const id = Object.hasOwn(config.bindings, provider) ? config.bindings[provider] : undefined;
    if (!id)
        return undefined;
    const runtime = cached(proxyRuntimePath(root), () => JSON.parse(readFileSync(proxyRuntimePath(root), "utf8")), () => ({}));
    const endpoint = record(runtime) ? runtime[id] : undefined;
    if (!validEndpoint(endpoint))
        return { id, endpoint: { status: "error", generation: "missing", message: "转发服务状态无效或尚未就绪，请启动或重启线路。" } };
    return { id, endpoint };
}
function validEndpoint(value) {
    if (!record(value) || !["starting", "running", "stopped", "error"].includes(value.status) || typeof value.generation !== "string" || !value.generation)
        return false;
    if (value.message !== undefined && typeof value.message !== "string")
        return false;
    if (value.port !== undefined && (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535))
        return false;
    if (value.token !== undefined && (typeof value.token !== "string" || !value.token))
        return false;
    return value.status !== "running" || (value.port !== undefined && value.token !== undefined);
}
//# sourceMappingURL=model-proxy-config.js.map