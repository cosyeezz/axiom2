import { maintainedFetch, maintenancePhase } from "../maintenance.js";
import { MaintenanceError } from "../../shared/maintenance.js";
import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream, createWriteStream, lstatSync, realpathSync } from "node:fs";
import { trackBuiltinDirectory, assertBuiltinFilesSafe, forgetBuiltinDirectory } from "./builtin-operation.js";
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extractEngineArchive } from "./rea-engine-archive.js";
import { engineHost, engineInstallable } from "./rea-engines.js";
import { ghidraVersion, jadxVersion, jadxSha256, wabtVersion, engineContractSupported, engineContractVersion } from "./rea-engine-policy.js";
import { readReaConfig, reaDirectory } from "./rea-runtime.js";
import { reuseEngineDownload } from "./rea-engine-download.js";
import { buildGhidraNatives, ghidraBuildEnvironment } from "./rea-engine-ghidra.js";
import { runEngine } from "./rea-engine-process.js";
export function officialEngineUrl(raw) {
    const url = new URL(raw);
    const hopper = url.hostname === "www.hopperapp.com" && (url.pathname === "/include/files-api.php" && url.search === "?request=releases&public=true" || /^\/downloader\/public\/Hopper-\d+\.\d+\.\d+-demo\.dmg$/.test(url.pathname) && !url.search);
    const gradle = ["services.gradle.org", "downloads.gradle.org"].includes(url.hostname) && /^\/distributions\/gradle-\d+\.\d+(?:\.\d+)?-bin\.zip(?:\.sha256)?$/.test(url.pathname) && !url.search;
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || !hopper && !gradle && !["api.adoptium.net", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(url.hostname))
        throw Error("组件下载地址不属于受信任的官方发布服务。");
}
export const fetchEngine = async (initial, signal) => {
    const timed = signal;
    let url = initial;
    for (let hop = 0; hop < 6; hop++) {
        officialEngineUrl(url);
        const response = await maintainedFetch(url, { signal: timed, redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 Axiom-REA" } });
        if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
            await response.body?.cancel();
            url = new URL(response.headers.get("location"), url).href;
            continue;
        }
        if (!response.ok) {
            await response.body?.cancel();
            throw new MaintenanceError("http", `组件官方发布服务返回 HTTP ${response.status}。`);
        }
        return response;
    }
    throw Error("组件下载重定向过多。");
};
export async function smallText(url, signal, fetcher) {
    const response = await fetcher(url, signal), reader = response.body?.getReader();
    if (!reader)
        throw Error("官方服务未返回内容。");
    const chunks = [];
    let length = 0;
    try {
        while (true) {
            const item = await reader.read();
            if (item.done)
                break;
            length += item.value.length;
            if (length > 2 * 1024 * 1024)
                throw Error("官方元数据超出大小限制。");
            chunks.push(item.value);
        }
    }
    finally {
        await reader.cancel();
    }
    return Buffer.concat(chunks).toString("utf8");
}
export async function engineRelease(id, signal, host = engineHost(), fetcher = fetchEngine, reaVersion = engineContractVersion) {
    if (!engineContractSupported(reaVersion))
        throw Error(`REA ${reaVersion} 的配套依赖契约尚未验证，未选择不兼容的最新版组件。`);
    const manualGhidra = id === "ghidra" && ["darwin", "linux"].includes(host.platform) && ["x64", "arm64"].includes(host.arch);
    const manualHopper = id === "hopper" && host.platform === "darwin" && ["x64", "arm64"].includes(host.arch);
    if (!engineInstallable(id, host) && !manualGhidra && !manualHopper)
        throw Error("当前后台系统/架构没有受支持的发行包，请通过官方说明配置已有安装。");
    if (id === "hopper") {
        const metadata = JSON.parse(await smallText("https://www.hopperapp.com/include/files-api.php?request=releases&public=true", signal, fetcher));
        const item = metadata?.["OS X"];
        if (!item || !/^\d+\.\d+\.\d+$/.test(item.version) || item.public !== "1" || item.beta !== "0" || !/^[a-f0-9]{40}$/.test(item.file_hash) || !/^\d+(?:\.\d+){1,2}$/.test(item.deployment_target) || !/^\d+$/.test(item.file_length))
            throw Error("Hopper 官方发行元数据无效。");
        const url = new URL(item.filename);
        if (url.origin !== "https://www.hopperapp.com" || url.pathname !== `/downloader/public/Hopper-${item.version}-demo.dmg`)
            throw Error("Hopper 未返回对应版本的官方 macOS 安装包。");
        officialEngineUrl(url.href);
        const size = Number(item.file_length);
        if (!Number.isSafeInteger(size) || size < 1 || size > 800 * 1024 * 1024)
            throw Error("Hopper 安装包大小无效。");
        return { url: url.href, sha1: item.file_hash, size, version: item.version, format: "dmg", minimumSystem: `macOS ${item.deployment_target}+` };
    }
    if (id === "ghidra")
        return { url: "https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_12.1.4_build/ghidra_12.1.4_PUBLIC_20260921.zip", sha256: "ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db", size: 569649598, version: ghidraVersion, format: "zip" };
    if (id === "jadx")
        return { url: "https://github.com/1013503897/jadx-headless-mcp/releases/download/v0.7.1/jadx-headless-mcp-0.7.1-all.jar", sha256: jadxSha256, version: jadxVersion, format: "jar" };
    if (id === "wabt") {
        const os = { darwin: "macos", win32: "windows", linux: "linux" }[host.platform];
        const asset = `wabt-1.0.42-${os}-${host.arch}.tar.gz`, url = `https://github.com/WebAssembly/wabt/releases/download/1.0.42/${asset}`;
        const checksum = await smallText(`${url}.sha256`, signal, fetcher);
        const match = /^([a-f0-9]{64})(?:\s+\*?([^\s]+))?\s*$/i.exec(checksum);
        if (!match || match[2] && match[2] !== asset)
            throw Error("WABT 校验清单无效。");
        return { url, sha256: match[1].toLowerCase(), version: wabtVersion, format: "tar.gz" };
    }
    const os = { darwin: "mac", win32: "windows", linux: "linux" }[host.platform], architecture = host.arch === "arm64" ? "aarch64" : "x64";
    const metadata = JSON.parse(await smallText(`https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=${architecture}&image_type=jdk&os=${os}&vendor=eclipse`, signal, fetcher));
    const item = Array.isArray(metadata) && metadata.find(item => item.binary?.os === os && item.binary?.architecture === architecture && item.binary?.image_type === "jdk" && item.binary?.jvm_impl === "hotspot" && item.version?.major === 21);
    const pkg = item?.binary?.package, format = host.platform === "win32" ? "zip" : "tar.gz";
    if (!pkg || typeof pkg.link !== "string" || !pkg.link.startsWith("https://github.com/adoptium/temurin21-binaries/releases/download/") || !pkg.link.endsWith(`.${format}`) || !/^[a-f0-9]{64}$/i.test(pkg.checksum) || typeof item.version.semver !== "string")
        throw Error("Adoptium 未返回当前平台的有效 JDK 21 包与校验值。");
    officialEngineUrl(pkg.link);
    return { url: pkg.link, sha256: pkg.checksum.toLowerCase(), version: item.version.semver, format };
}
export async function downloadEngineFile(release, output, signal, fetcher = fetchEngine) {
    signal.throwIfAborted();
    officialEngineUrl(release.url);
    const limit = 800 * 1024 * 1024;
    const sha1 = release.format === "dmg" && new URL(release.url).hostname === "www.hopperapp.com" && !release.sha256;
    const digest = sha1 ? release.sha1 : release.sha256;
    if (!digest || !(sha1 ? /^[a-f0-9]{40}$/ : /^[a-f0-9]{64}$/).test(digest))
        throw Error("组件缺少有效的官方文件校验值。");
    const response = await fetcher(release.url, signal);
    if (!response.body || Number(response.headers.get("content-length")) > limit) {
        await response.body?.cancel();
        throw Error("组件下载为空或超过限制。");
    }
    const hash = createHash(sha1 ? "sha1" : "sha256");
    let size = 0;
    const meter = new Transform({ transform(chunk, _encoding, callback) { size += chunk.length; hash.update(chunk); callback(size > limit ? Error("组件下载超过大小限制。") : null, chunk); } });
    await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(output, { flags: "wx", mode: 0o600 }), { signal });
    maintenancePhase("verifying");
    if (!size || release.size !== undefined && size !== release.size || hash.digest("hex") !== digest)
        throw Error(`组件 ${sha1 ? "SHA-1" : "SHA-256"} 校验失败；未切换当前安装。`);
}
export async function verifyEngineFile(path, release, signal) {
    const hash = createHash(release.sha256 ? "sha256" : "sha1");
    let size = 0;
    for await (const chunk of createReadStream(path, { signal })) {
        size += chunk.length;
        if (size > 800 * 1024 * 1024)
            throw Error("组件安装包超出大小限制。");
        hash.update(chunk);
    }
    signal.throwIfAborted();
    if (!size || release.size !== undefined && release.size !== size || hash.digest("hex") !== (release.sha256 ?? release.sha1))
        throw Error("组件安装包校验失败，原安装包已保留，请重新检查更新。");
}
export async function findEnginePath(root, id, host) {
    const matches = [], suffix = host.platform === "win32" ? ".exe" : "";
    async function visit(directory, depth) {
        if (depth > 5)
            return;
        const entries = await readdir(directory, { withFileTypes: true });
        if (id === "java" && entries.some(item => item.name === "release" && item.isFile()) && entries.some(item => item.name === "bin" && item.isDirectory()))
            matches.push(directory);
        if (id === "ghidra" && ["Ghidra", "support"].every(name => entries.some(item => item.name === name && item.isDirectory())))
            matches.push(directory);
        if (id === "wabt" && ["wasm-validate", "wasm-objdump", "wasm2wat"].every(name => entries.some(item => item.name === name + suffix && item.isFile())))
            matches.push(directory);
        for (const item of entries)
            if (item.isDirectory())
                await visit(join(directory, item.name), depth + 1);
    }
    await visit(root, 0);
    if (matches.length !== 1)
        throw Error("组件压缩包布局不符合预期。");
    return matches[0];
}
export async function prepareEngine(root, id, signal, notify, fetcher = fetchEngine, selected, options = {}) {
    const host = engineHost(), run = options.run ?? runEngine;
    if (!engineInstallable(id, host))
        throw Error("当前组件需要手动安装，请使用下载安装包。");
    const release = selected ?? await engineRelease(id, signal, host, fetcher, readReaConfig(root).installation?.version);
    if (release.format === "dmg")
        throw Error("Hopper 安装由用户通过官方安装器完成。");
    const buildEnv = id === "ghidra" && host.platform === "darwin" ? await ghidraBuildEnvironment(root, signal, run) : undefined;
    const directory = join(reaDirectory(root), "engines", `${id}-${randomUUID()}`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const original = lstatSync(directory, { bigint: true });
    const assertIdentity = () => {
        const current = lstatSync(directory, { bigint: true });
        if (!current.isDirectory() || current.isSymbolicLink() || realpathSync(directory) !== directory || current.dev !== original.dev || current.ino !== original.ino)
            throw new MaintenanceError("stop-unconfirmed", "组件候选目录身份已变化，已保留文件与记录。");
        assertBuiltinFilesSafe();
    };
    trackBuiltinDirectory(directory);
    try {
        const archive = join(directory, release.format === "jar" ? "jadx-headless-mcp.jar" : `download.${release.format}`);
        const cached = await reuseEngineDownload(root, id, readReaConfig(root).downloads?.[id], release, signal);
        if (cached) {
            notify(`正在使用已下载的 ${id} ${release.version} 安装包…`);
            await copyFile(cached.path, archive, constants.COPYFILE_EXCL);
            // Hash the private copy too: a cache replacement during copy must never execute.
            await verifyEngineFile(archive, release, signal);
        }
        else {
            if (options.cachedOnly)
                throw Error("已下载的安装包缺失或校验失败，请重新检查更新。原文件已保留。");
            maintenancePhase("downloading");
            notify(`正在下载 ${id} ${release.version}（${host.platform}/${host.arch}）…`);
            await downloadEngineFile(release, archive, signal, fetcher);
        }
        maintenancePhase("installing");
        notify("SHA-256 校验通过，正在准备组件…");
        const unpacked = join(directory, "files");
        if (release.format !== "jar") {
            await mkdir(unpacked);
            await extractEngineArchive(archive, unpacked, release.format, signal);
            await rm(archive);
        }
        const path = release.format === "jar" ? archive : await findEnginePath(unpacked, id, host);
        if (buildEnv)
            await buildGhidraNatives(root, path, directory, host, buildEnv, signal, notify, fetcher, run);
        await writeFile(join(directory, "source.json"), JSON.stringify({ ...release, ...host, installedAt: Date.now() }, null, 2), { flag: "wx", mode: 0o600 });
        signal.throwIfAborted();
        assertIdentity();
        return { directory, path };
    }
    catch (error) {
        assertIdentity();
        await rm(directory, { recursive: true, force: true });
        forgetBuiltinDirectory(directory);
        throw error;
    }
}
//# sourceMappingURL=rea-engine-install.js.map