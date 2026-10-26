import { createHash, randomUUID } from "node:crypto";
import { lstatSync, opendirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { managedDirectory } from "./managed-removal.js";
import { atomicRtkJson, readRtkConfig, rtkConfigPath, rtkDirectory } from "./rtk-config.js";
function info(path) {
    try {
        return lstatSync(path, { bigint: true });
    }
    catch (error) {
        if (error.code === "ENOENT")
            return;
        throw error;
    }
}
function regular(path) {
    const stat = info(path);
    if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n))
        throw Error("数据文件存在链接或类型异常，已保留文件。");
    return stat;
}
function identity(path) {
    const stat = info(path);
    return stat ? [path, String(stat.dev), String(stat.ino), String(stat.size), String(stat.mtimeNs), String(stat.ctimeNs)] : [path, "missing"];
}
/** Caller holds command admission; inspection never creates a data database. */
export function rtkDataScope(root, kind) {
    const base = rtkDirectory(root), paths = [], retained = [];
    managedDirectory(root, ["integrations"], "rtk", /^rtk$/);
    let count = 0, identities = [];
    if (kind === "stats") {
        const path = join(base, "effects.sqlite"), files = [path, ...["-wal", "-shm", "-journal"].map(suffix => path + suffix)];
        for (const file of files)
            regular(file);
        let rows = [];
        if (info(path)) {
            const db = new DatabaseSync(path, { readOnly: true });
            try {
                rows = db.prepare("SELECT * FROM effects ORDER BY id LIMIT 5001").all();
                if (rows.length > 5000)
                    throw Error("效果记录超过核实上限，已保留数据。");
                count = rows.length;
            }
            finally {
                db.close();
            }
            paths.push(path);
        }
        else if (files.slice(1).some(file => info(file)))
            throw Error("统计主文件缺失但仍有日志，已保留等待核实。");
        for (const file of files)
            regular(file);
        // SQLite may recreate SHM/WAL during a read-only connection. Bind the
        // database identity and committed rows, not these transient reader files.
        identities = [identity(path), rows];
    }
    else {
        const dir = managedDirectory(root, ["integrations", "rtk"], "originals", /^originals$/);
        if (dir) {
            const entries = opendirSync(dir);
            try {
                let entry, visited = 0;
                while ((entry = entries.readSync())) {
                    if (++visited > 1024)
                        throw Error("原文条目超过核实上限，未执行清理。");
                    const path = join(dir, entry.name), stat = info(path);
                    if (/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.txt$/.test(entry.name) && stat?.isFile() && stat.nlink === 1n)
                        paths.push(path);
                    else
                        retained.push(path);
                }
            }
            finally {
                entries.closeSync();
            }
        }
        paths.sort();
        retained.sort();
        count = paths.length;
        identities = [identity(join(base, "originals")), ...paths.map(identity), ...retained.map(identity)];
    }
    const revision = createHash("sha256").update(JSON.stringify([kind, readRtkConfig(root).revision, identity(base).slice(0, 3), identities, count])).digest("hex");
    return { revision, paths, count, retained };
}
/** The worker barrier and command admission must remain held throughout this call. */
export function clearRtkData(root, kind, revision) {
    const scope = rtkDataScope(root, kind);
    if (typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision) || scope.revision !== revision)
        throw Error("数据清理范围已变化，请重新读取并确认。");
    // Retire results selected before cleanup, including callbacks after command exit.
    const config = readRtkConfig(root);
    atomicRtkJson(rtkConfigPath(root), { ...config, revision: randomUUID() });
    if (kind === "stats" && scope.paths.length) {
        const db = new DatabaseSync(scope.paths[0]);
        try {
            db.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE; DELETE FROM effects; COMMIT");
            if (Number(db.prepare("SELECT count(*) AS count FROM effects").get().count) !== 0)
                throw Error("效果记录未清空。");
        }
        finally {
            db.close();
        }
    }
    else if (kind === "originals") {
        for (const path of scope.paths) {
            managedDirectory(root, ["integrations", "rtk"], "originals", /^originals$/);
            regular(path);
            unlinkSync(path);
        }
    }
    const after = rtkDataScope(root, kind);
    if (after.count)
        throw Error("仍有选定数据，清理尚未完成。");
    return after;
}
//# sourceMappingURL=rtk-data.js.map