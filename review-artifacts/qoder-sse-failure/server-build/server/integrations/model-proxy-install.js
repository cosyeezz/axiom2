import { MaintenanceError } from "../../shared/maintenance.js";
import { maintainedFetch, maintenancePhase } from "../maintenance.js";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync, inflateRawSync } from "node:zlib";
import { Agent, fetch } from "undici";
import { proxyDirectory } from "./model-proxy-config.js";
import { runNative } from "./native-process.js";
export function proxyAsset(kernel, version, platform = process.platform, arch = process.arch) {
    const key = `${platform}-${arch}`;
    const target = kernel === "xray"
        ? { "darwin-arm64": "macos-arm64-v8a", "darwin-x64": "macos-64", "linux-arm64": "linux-arm64-v8a", "linux-x64": "linux-64", "win32-arm64": "windows-arm64-v8a", "win32-x64": "windows-64" }[key]
        : { "darwin-arm64": "darwin-arm64", "darwin-x64": "darwin-amd64-v1", "linux-arm64": "linux-arm64", "linux-x64": "linux-amd64-v1", "win32-arm64": "windows-arm64", "win32-x64": "windows-amd64-v1" }[key];
    return !target ? undefined : kernel === "xray" ? `Xray-${target}.zip` : `mihomo-${target}-v${version}.${platform === "win32" ? "zip" : "gz"}`;
}
// Explicit Agent: installation never inherits a model route or environment proxy.
export async function downloadProxyAsset(initial, signal, limit, progress) {
    const direct = new Agent();
    try {
        let url = new URL(initial);
        const timed = signal;
        for (let hop = 0; hop < 6; hop++) {
            if (url.protocol !== "https:" || url.username || url.password || url.port || !["api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(url.hostname))
                throw Error("内核下载地址不属于官方发布服务。");
            const response = await maintainedFetch(url.href, { signal: timed, redirect: "manual", headers: { "User-Agent": "Axiom-Model-Proxy" } }, ((input, init) => fetch(input, { ...init, dispatcher: direct })));
            if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
                await response.body?.cancel();
                url = new URL(response.headers.get("location"), url);
                continue;
            }
            if (!response.ok) {
                await response.body?.cancel();
                throw new MaintenanceError("http", `官方发布服务返回 HTTP ${response.status}。`);
            }
            if (Number(response.headers.get("content-length")) > limit) {
                await response.body?.cancel();
                throw Error("下载文件超过大小限制。");
            }
            const length = Number(response.headers.get("content-length")), total = Number.isFinite(length) && length > 0 ? length : undefined;
            const chunks = [];
            let size = 0, reported = Date.now();
            progress?.(0, total);
            const reader = response.body?.getReader();
            if (!reader)
                throw Error("下载未返回内容。");
            try {
                while (true) {
                    const next = await reader.read();
                    if (next.done)
                        break;
                    const data = next.value;
                    size += data.length;
                    if (size > limit)
                        throw Error("下载文件超过大小限制。");
                    chunks.push(Buffer.from(data));
                    if (Date.now() - reported >= 250) {
                        progress?.(size, total);
                        reported = Date.now();
                    }
                }
            }
            finally {
                await reader.cancel().catch(() => { });
            }
            progress?.(size, total);
            return Buffer.concat(chunks);
        }
        throw Error("下载重定向次数过多。");
    }
    finally {
        await direct.destroy();
    }
}
export async function latestProxyRelease(kernel, signal) {
    const repo = kernel === "xray" ? "XTLS/Xray-core" : "MetaCubeX/mihomo";
    const value = JSON.parse((await downloadProxyAsset(`https://api.github.com/repos/${repo}/releases/latest`, signal, 2 * 1024 * 1024)).toString());
    const version = String(value.tag_name).replace(/^v/, "");
    if (!/^\d+\.\d+\.\d+$/.test(version) || value.draft || value.prerelease || !Array.isArray(value.assets))
        throw Error("未找到有效的稳定版本。");
    const asset = proxyAsset(kernel, version);
    if (!asset)
        throw Error("当前平台没有官方发布包。");
    const url = `https://github.com/${repo}/releases/download/v${version}/${asset}`;
    const found = value.assets.find((a) => a.name === asset && a.browser_download_url === url);
    if (!found || !/^sha256:[a-f0-9]{64}$/.test(found.digest))
        throw Error("官方发布包缺少 SHA-256 校验信息。");
    return { kernel, version, asset, url, sha256: found.digest.slice(7) };
}
// Read one regular member only. Archive names never become filesystem paths.
export function proxyZipMember(archive, name) {
    let end = -1;
    for (let i = archive.length - 22; i >= Math.max(0, archive.length - 65557); i--)
        if (archive.readUInt32LE(i) === 0x06054b50 && i + 22 + archive.readUInt16LE(i + 20) === archive.length) {
            end = i;
            break;
        }
    if (end < 0 || archive.readUInt16LE(end + 4) || archive.readUInt16LE(end + 6))
        throw Error("不支持此 ZIP 发布包。");
    let pos = archive.readUInt32LE(end + 16);
    const count = archive.readUInt16LE(end + 10);
    let output;
    for (let i = 0; i < count; i++) {
        if (pos + 46 > end || archive.readUInt32LE(pos) !== 0x02014b50)
            throw Error("ZIP 目录损坏。");
        const length = archive.readUInt16LE(pos + 28), extra = archive.readUInt16LE(pos + 30), comment = archive.readUInt16LE(pos + 32);
        if (pos + 46 + length + extra + comment > end)
            throw Error("ZIP 目录越界。");
        if (archive.subarray(pos + 46, pos + 46 + length).toString() === name) {
            const method = archive.readUInt16LE(pos + 10), size = archive.readUInt32LE(pos + 24), packed = archive.readUInt32LE(pos + 20), local = archive.readUInt32LE(pos + 42), mode = archive.readUInt32LE(pos + 38) >>> 16;
            if (output || archive.readUInt16LE(pos + 8) & 1 || (mode & 0xf000) === 0xa000 || !size || size > 200 * 1024 * 1024 || local + 30 > pos || archive.readUInt32LE(local) !== 0x04034b50)
                throw Error("ZIP 程序成员无效。");
            const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
            if (start + packed > pos)
                throw Error("ZIP 程序成员越界。");
            const data = archive.subarray(start, start + packed);
            output = method === 0 ? Buffer.from(data) : method === 8 ? inflateRawSync(data, { maxOutputLength: size }) : undefined;
            if (!output || output.length !== size)
                throw Error("ZIP 程序解包失败。");
        }
        pos += 46 + length + extra + comment;
    }
    if (!output)
        throw Error("发布包中缺少内核程序。");
    return output;
}
export async function installProxyKernel(root, release, signal) {
    const directory = `${release.kernel}-${release.version}-${randomUUID()}`, dest = join(proxyDirectory(root), "versions", directory);
    mkdirSync(dest, { recursive: true, mode: 0o700 });
    try {
        const archive = await downloadProxyAsset(release.url, signal, 120 * 1024 * 1024);
        maintenancePhase("verifying");
        if (createHash("sha256").update(archive).digest("hex") !== release.sha256)
            throw Error("内核发布包 SHA-256 校验失败。");
        maintenancePhase("installing");
        const binary = release.kernel + (process.platform === "win32" ? ".exe" : "");
        // mihomo ZIP uses its asset basename for the executable.
        const member = release.kernel === "xray" ? binary : release.asset.replace(/\.zip$/, ".exe");
        const data = release.asset.endsWith(".gz") ? gunzipSync(archive, { maxOutputLength: 200 * 1024 * 1024 }) : proxyZipMember(archive, member);
        const file = join(dest, binary);
        writeFileSync(file, data, { flag: "wx", mode: 0o700 });
        chmodSync(file, 0o700);
        maintenancePhase("validating");
        const version = (await runNative(file, [release.kernel === "xray" ? "version" : "-v"], { root, signal, timeout: 10_000, environmentDirectory: join(dirname(file), "environment") })).toString();
        if (!version.includes(release.version) || !(release.kernel === "xray" ? /^Xray / : /^Mihomo /).test(version))
            throw Error("内核版本自检失败。");
        signal.throwIfAborted();
        return { version: release.version, directory };
    }
    catch (error) {
        if (!(error instanceof MaintenanceError && error.code === "stop-unconfirmed"))
            rmSync(dest, { recursive: true, force: true });
        throw error;
    }
}
//# sourceMappingURL=model-proxy-install.js.map