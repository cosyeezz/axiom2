import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream, lstatSync, readFileSync, realpathSync } from "node:fs";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MaintenanceError } from "../../shared/maintenance.js";
import { maintenancePhase } from "../maintenance.js";
import { assertBuiltinFilesSafe, forgetBuiltinDirectory, trackBuiltinDirectory } from "./builtin-operation.js";
import { downloadEngineFile, fetchEngine, officialEngineUrl, verifyEngineFile } from "./rea-engine-install.js";
import { reaDirectory, reaDownloadDirectoryPattern } from "./rea-runtime.js";
import { runEngine } from "./rea-engine-process.js";
import { managedDirectory } from "./managed-removal.js";
/** Inspect only a recorded package. Refreshing never hashes or downloads it. */
export function storedEngineDownload(root, id, record) {
    if (!record || !["ghidra", "hopper"].includes(id))
        return;
    const directory = managedDirectory(root, ["integrations", "rea", "downloads"], record.directory, reaDownloadDirectoryPattern);
    if (!directory || !record.directory.startsWith(`${id}-`) || record.filename !== (id === "ghidra" ? "package.zip" : "package.dmg"))
        return;
    const path = join(directory, record.filename), metadata = join(directory, "source.json");
    try {
        const file = lstatSync(path, { bigint: true }), sourceFile = lstatSync(metadata, { bigint: true });
        if (!file.isFile() || !sourceFile.isFile())
            throw new MaintenanceError("stop-unconfirmed", "安装包或来源文件已被替换，已保留原文件。");
        if (file.size < 1 || file.size > 800 * 1024 * 1024 || sourceFile.size > 65536)
            return;
        const source = JSON.parse(readFileSync(metadata, "utf8"));
        if (!source || typeof source !== "object" || source.installed !== false || source.version !== record.version || source.format !== (id === "ghidra" ? "zip" : "dmg"))
            return;
        if (source.size !== undefined && (!Number.isSafeInteger(source.size) || source.size < 1 || BigInt(source.size) !== file.size))
            return;
        if (typeof source.url !== "string" || !(id === "hopper" ? /^[a-f0-9]{40}$/.test(source.sha1 ?? "") : /^[a-f0-9]{64}$/.test(source.sha256 ?? "")))
            return;
        try {
            officialEngineUrl(source.url);
        }
        catch {
            return;
        }
        const identity = [file, sourceFile].map(stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":")).join(";");
        return { directory, filename: record.filename, path, version: record.version, source, identity };
    }
    catch (error) {
        if (error.code === "ENOENT" || error instanceof SyntaxError)
            return;
        throw error;
    }
}
/** Reuse requires the exact confirmed release and a fresh, cancellable digest. */
export async function reuseEngineDownload(root, id, record, release, signal) {
    signal.throwIfAborted();
    const cached = storedEngineDownload(root, id, record);
    if (!cached || ["version", "url", "format", "sha256", "sha1", "size"].some(key => cached.source[key] !== release[key]))
        return;
    const hash = createHash(id === "hopper" ? "sha1" : "sha256");
    for await (const chunk of createReadStream(cached.path, { signal }))
        hash.update(chunk);
    signal.throwIfAborted();
    const after = storedEngineDownload(root, id, record);
    if (!after || after.identity !== cached.identity)
        throw new MaintenanceError("stop-unconfirmed", "安装包在校验期间发生变化，已保留原文件。");
    return hash.digest("hex") === (id === "hopper" ? release.sha1 : release.sha256) ? cached : undefined;
}
/** Hand an already verified DMG to macOS; opening it is not installation success. */
export async function openHopperInstaller(root, record, signal, run = runEngine) {
    if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch))
        throw Error("Hopper 安装入口仅支持 macOS。");
    const stored = storedEngineDownload(root, "hopper", record);
    if (!stored || stored.source.url !== `https://www.hopperapp.com/downloader/public/Hopper-${record.version}-demo.dmg` || !Number.isSafeInteger(stored.source.size) || !stored.source.size)
        throw Error("Hopper 安装包记录无效，请重新检查更新。原文件已保留。");
    const cached = await reuseEngineDownload(root, "hopper", record, stored.source, signal);
    if (!cached)
        throw Error("Hopper 安装包缺失或校验失败，请重新检查更新。原文件已保留。");
    assertBuiltinFilesSafe();
    signal.throwIfAborted();
    const directory = join(reaDirectory(root), "downloads", `hopper-${randomUUID()}`), path = join(directory, "package.dmg");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const original = lstatSync(directory, { bigint: true });
    const assertIdentity = () => {
        const info = lstatSync(directory, { bigint: true });
        if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(directory) !== directory || info.dev !== original.dev || info.ino !== original.ino)
            throw new MaintenanceError("stop-unconfirmed", "安装映像目录身份已变化，已保留文件与记录。");
        assertBuiltinFilesSafe();
    };
    trackBuiltinDirectory(directory);
    let handedOff = false;
    try {
        // LaunchServices reads asynchronously. Keep a verified private copy after handoff,
        // including uncertain/cancelled opens; later cache changes cannot affect its bytes.
        await copyFile(cached.path, path, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
        await verifyEngineFile(path, stored.source, signal);
        await writeFile(join(directory, "source.json"), JSON.stringify({ ...stored.source, installed: false, installerCopy: true, preparedAt: Date.now() }), { flag: "wx", mode: 0o600 });
        assertIdentity();
        signal.throwIfAborted();
        handedOff = true;
        const result = await run("/usr/bin/open", [path], { cwd: root, signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), timeout: 15_000 });
        signal.throwIfAborted();
        assertIdentity();
        if (result.code)
            throw Error(`无法打开 Hopper 安装映像：${result.stderr.trim() || "请确认后台 Mac 已登录桌面。"}`);
    }
    catch (error) {
        assertIdentity();
        if (!handedOff) {
            await rm(directory, { recursive: true, force: true });
            forgetBuiltinDirectory(directory);
        }
        throw error;
    }
}
/** Keep downloaded packages separate from active engine paths. Never execute them here. */
export async function prepareEngineDownload(root, id, release, signal, notify, fetcher = fetchEngine) {
    if (!(id === "ghidra" && release.format === "zip" || id === "hopper" && release.format === "dmg"))
        throw Error("此组件不支持单独下载安装包。");
    const directory = join(reaDirectory(root), "downloads", `${id}-${randomUUID()}`), filename = `package.${release.format}`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const original = lstatSync(directory, { bigint: true });
    const assertIdentity = () => {
        const info = lstatSync(directory, { bigint: true });
        if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(directory) !== directory || info.dev !== original.dev || info.ino !== original.ino)
            throw new MaintenanceError("stop-unconfirmed", "下载目录身份已变化，已保留文件与记录。");
        assertBuiltinFilesSafe();
    };
    trackBuiltinDirectory(directory);
    try {
        notify(`正在下载 ${id} ${release.version} 安装包…`);
        await downloadEngineFile(release, join(directory, filename), signal, fetcher);
        maintenancePhase("validating");
        await writeFile(join(directory, "source.json"), JSON.stringify({ ...release, downloadedAt: Date.now(), installed: false }, null, 2), { flag: "wx", mode: 0o600 });
        signal.throwIfAborted();
        assertIdentity();
        return { directory, filename, path: join(directory, filename) };
    }
    catch (error) {
        assertIdentity();
        await rm(directory, { recursive: true, force: true });
        forgetBuiltinDirectory(directory);
        throw error;
    }
}
//# sourceMappingURL=rea-engine-download.js.map