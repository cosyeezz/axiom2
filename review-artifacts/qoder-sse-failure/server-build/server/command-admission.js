import { DatabaseSync } from "node:sqlite";
import { closeSync, constants, lstatSync, openSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
/** Permanent lock domain shared by command publication and destructive maintenance.
 * Never unlink this database: a second inode would create a second admission gate.
 * Lock order: service maintenance -> startup reservation -> command admission.
 * Commands release admission once their durable owner has been published. */
export function lockCommandAdmission(root) {
    if (!isAbsolute(root))
        throw Error("工具数据目录身份无效。");
    const directory = realpathSync(root);
    if (!lstatSync(directory).isDirectory())
        throw Error("工具数据目录身份无效。");
    const path = join(directory, "command-admission.sqlite");
    try {
        closeSync(openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW || 0), 0o600));
    }
    catch (error) {
        if (error.code !== "EEXIST")
            throw error;
    }
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
        try {
            const stat = lstatSync(path + suffix);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
                throw Error("工具启动锁路径无效，已保留程序文件。");
        }
        catch (error) {
            if (suffix && error.code === "ENOENT")
                continue;
            throw error;
        }
    }
    const db = new DatabaseSync(path);
    try {
        db.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE");
    }
    catch (error) {
        db.close();
        if ([5, 6].includes(error.errcode ?? 0))
            throw Error("工具正在启动或清理，请稍后重试。");
        throw error;
    }
    return () => { try {
        if (db.isTransaction)
            db.exec("ROLLBACK");
    }
    finally {
        db.close();
    } };
}
export function withCommandAdmission(root, work) {
    const release = lockCommandAdmission(root);
    try {
        return work();
    }
    finally {
        release();
    }
}
//# sourceMappingURL=command-admission.js.map