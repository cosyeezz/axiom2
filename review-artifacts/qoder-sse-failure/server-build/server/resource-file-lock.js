import { DatabaseSync } from "node:sqlite";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { AppError } from "../shared/protocol.js";
/** These lock files live beside the shared configuration, never in an app's
 * private data root. Keep them permanently: unlinking an open SQLite file could
 * create two independent lock domains. The OS releases locks on host exit;
 * elapsed time and a paused event loop never revoke a live holder. */
function lockResources(paths, individual) {
    const files = paths.map(path => {
        const parent = dirname(resolve(path));
        mkdirSync(parent, { recursive: true, mode: 0o700 });
        const actual = realpathSync(parent);
        const directory = process.platform === "win32" ? actual.toLowerCase() : actual;
        const identity = join(directory, basename(resolve(path)));
        const key = process.platform === "win32" ? identity.toLowerCase() : identity;
        return join(directory, individual ? `.axiom-resource-${createHash("sha256").update(key).digest("hex")}.sqlite` : ".axiom-resources-lock.sqlite");
    });
    const databases = [];
    const release = () => {
        for (const db of databases.splice(0).reverse()) {
            try {
                if (db.isTransaction)
                    db.exec("ROLLBACK");
            }
            finally {
                db.close();
            }
        }
    };
    try {
        for (const path of [...new Set(files)].sort()) {
            if (!existsSync(path)) {
                try {
                    closeSync(openSync(path, "wx", 0o600));
                }
                catch (error) {
                    if (error.code !== "EEXIST")
                        throw error;
                }
            }
            const stat = lstatSync(path);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
                throw new AppError("RESOURCE_SHARED", "资源配置锁被链接或其他文件替换，请检查共享目录后重试。");
            const db = new DatabaseSync(path);
            databases.push(db);
            db.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE");
        }
        return release;
    }
    catch (error) {
        release();
        if ([5, 6].includes(error.errcode ?? 0))
            throw new AppError("RESOURCE_BUSY", "共享资源配置正在由其他任务提交，请等待其完成后刷新重试；尚未覆盖配置。");
        throw error;
    }
}
export const lockResourceFiles = (paths) => lockResources(paths, false);
/** Hold exact source/destination identities across asynchronous validation;
 * unrelated files and short configuration commits remain independent. */
export const lockResourcePaths = (paths) => lockResources(paths, true);
export function withResourceFiles(paths, work) {
    const release = lockResourceFiles(paths);
    try {
        return work();
    }
    finally {
        release();
    }
}
//# sourceMappingURL=resource-file-lock.js.map