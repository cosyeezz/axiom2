import { createHash, randomUUID } from "node:crypto";
import { lstatSync, opendirSync, realpathSync, rmdirSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { assertBuiltinDirectoryOwned, assertBuiltinFilesSafe, builtinRemovalDirectories, forgetBuiltinDirectory, markBuiltinRemovals } from "./builtin-operation.js";
import { storedEngineDownload } from "./rea-engine-download.js";
import { managedDirectory } from "./managed-removal.js";
import { atomicReaJson, readReaConfig, reaConfigPath, reaDirectory, reaDownloadDirectoryPattern } from "./rea-runtime.js";
const parents = ["integrations", "rea", "downloads"];
function stat(path) {
    try {
        return lstatSync(path, { bigint: true });
    }
    catch (error) {
        if (error.code === "ENOENT")
            return;
        throw error;
    }
}
function identity(path) {
    const value = stat(path);
    return value ? [path, ...[value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].map(String)] : [path, "missing"];
}
function entries(directory, id) {
    const files = [], handle = opendirSync(directory);
    try {
        let entry;
        while ((entry = handle.readSync())) {
            if (![id === "ghidra" ? "package.zip" : "package.dmg", "source.json"].includes(entry.name))
                throw Error("登记下载目录含未识别文件，整个目录已保留，请先核实。");
            const path = join(directory, entry.name), value = stat(path);
            if (!value?.isFile() || value.nlink !== 1n)
                throw Error("安装包或来源文件存在链接或类型异常，已保留。");
            files.push(path);
        }
    }
    finally {
        handle.closeSync();
    }
    return files.sort();
}
export function reaDownloadPlan(root, config, id, previous = []) {
    root = realpathSync(root);
    const base = join(reaDirectory(root), "downloads"), record = config.downloads?.[id];
    const pending = [...new Set([...(config.downloadRemovalPending ?? []), ...previous.filter(path => dirname(path) === base).map(path => basename(path))])].filter(name => name.startsWith(`${id}-`));
    const names = [...new Set([...pending, ...(record ? [record.directory] : [])])].sort();
    const paths = names.map(name => join(base, name)), files = new Map(), identities = new Map();
    for (const name of names) {
        const directory = managedDirectory(root, parents, name, reaDownloadDirectoryPattern);
        if (!directory)
            continue;
        files.set(directory, entries(directory, id));
        for (const path of files.get(directory))
            identities.set(path, JSON.stringify(identity(path)));
        if (!pending.includes(name)) {
            const stored = storedEngineDownload(root, id, record);
            if (!stored || stored.directory !== directory || stored.source.installerCopy)
                throw Error("登记安装包或来源记录无法核实，已保留文件。");
        }
    }
    const revision = createHash("sha256").update(JSON.stringify([id, config.revision, record, pending.sort(), paths.map(path => [identity(path), ...(files.get(path) ?? []).map(file => identities.get(file))])])).digest("hex");
    const scope = { paths, revision };
    return { names, paths, files, identities, scope };
}
/** Global builtin operation, configuration lock and worker barrier must be held. */
export function clearReaDownloads(root, id, revision, cleanupRevision) {
    const config = readReaConfig(root), plan = reaDownloadPlan(root, config, id, builtinRemovalDirectories());
    if (config.revision !== revision || typeof cleanupRevision !== "string" || !/^[a-f0-9]{64}$/.test(cleanupRevision) || plan.scope.revision !== cleanupRevision)
        throw Error("下载包清理范围已变化，请重新读取并确认。");
    // Unlike legacy program installs, a download config alone never adopts an inode.
    for (const path of plan.paths)
        if (stat(path))
            assertBuiltinDirectoryOwned(path);
    markBuiltinRemovals(plan.paths);
    const downloads = { ...config.downloads };
    delete downloads[id];
    const next = { ...config, revision: randomUUID(), downloads, downloadRemovalPending: [...new Set([...(config.downloadRemovalPending ?? []), ...plan.names])] };
    atomicReaJson(reaConfigPath(root), next);
    for (const name of plan.names) {
        assertBuiltinFilesSafe();
        const directory = managedDirectory(root, parents, name, reaDownloadDirectoryPattern);
        if (!directory)
            continue;
        // No recursive removal: new or unrecognized children keep the directory intact.
        const selected = entries(directory, id);
        for (const path of selected) {
            assertBuiltinFilesSafe();
            if (!managedDirectory(root, parents, name, reaDownloadDirectoryPattern))
                throw Error("下载目录已变化，已停止清理。");
            const value = stat(path);
            if (!value?.isFile() || value.nlink !== 1n || JSON.stringify(identity(path)) !== plan.identities.get(path))
                throw Error("下载文件已变化，已停止清理。");
            unlinkSync(path);
        }
        assertBuiltinFilesSafe();
        rmdirSync(directory);
    }
    if (plan.paths.some(path => stat(path)))
        throw Error("仍存在选定下载目录，请重新核实。");
    const remaining = next.downloadRemovalPending.filter(name => !plan.names.includes(name));
    atomicReaJson(reaConfigPath(root), { ...next, downloadRemovalPending: remaining.length ? remaining : undefined });
    for (const path of plan.paths)
        forgetBuiltinDirectory(path);
}
//# sourceMappingURL=rea-download-cleanup.js.map