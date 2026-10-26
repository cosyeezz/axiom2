import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
// Pi 1.1.0 computes a first write before taking its file lock. Install the same
// fix in every application process before any file-backed SettingsManager runs.
// Unpatched external SDK processes remain outside this compatibility boundary.
const entry = import.meta.resolve("@earendil-works/pi-coding-agent");
const metadata = JSON.parse(readFileSync(new URL("../package.json", entry), "utf8"));
if (metadata.version !== "1.1.0")
    throw Error("Pi 设置存储版本不兼容，无法保证配置并发写入安全。");
const lockfile = createRequire(entry)("proper-lockfile");
const { FileSettingsStorage } = await import(new URL("./core/settings-manager.js", entry).href);
const prototype = FileSettingsStorage?.prototype;
const sample = prototype && new FileSettingsStorage(process.cwd(), process.cwd());
if (!sample || typeof prototype.withLock !== "function" || typeof prototype.acquireLockSyncWithRetry !== "function" || !isAbsolute(sample.globalSettingsPath) || !isAbsolute(sample.projectSettingsPath))
    throw Error("Pi 设置存储接口不兼容，未执行配置写入。");
function settingsLocation(path) {
    let at = resolve(path);
    const tail = [];
    for (;;) {
        try {
            lstatSync(at);
            break;
        }
        catch (error) {
            if (error.code !== "ENOENT" || dirname(at) === at)
                throw error;
        }
        tail.unshift(basename(at));
        at = dirname(at);
    }
    const actual = join(realpathSync(at), ...tail), lexical = resolve(path);
    const normalize = (value) => process.platform === "win32" ? value.toLowerCase() : value;
    const linked = normalize(actual) !== normalize(lexical) || existsSync(path) && lstatSync(path).nlink > 1;
    return { actual, linked };
}
function aliasError() { return Object.assign(Error("设置路径使用目录、文件或硬链接，无法核实同一写入锁；请使用独立的实际设置路径。"), { code: "SETTINGS_PATH_ALIAS" }); }
function assertSettingsPath(path) { if (settingsLocation(path).linked)
    throw aliasError(); }
/** Short synchronous critical section: re-read and merge inside the SDK lock.
 * A missing file still takes the lock, including for a read-only callback. */
export function withPiSettingsLock(path, update, acquire = () => lockfile.lockSync(path, { realpath: false, retries: 0 })) {
    assertSettingsPath(path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const release = acquire();
    try {
        assertSettingsPath(path);
        return update();
    }
    finally {
        release();
    }
}
export function writePiSettingsBytes(path, value) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        writeFileSync(temporary, value, { flag: "wx", mode: 0o600 });
        renameSync(temporary, path);
    }
    finally {
        rmSync(temporary, { force: true });
    }
}
const installed = Symbol.for("axiom.pi.settings-lock.1");
if (!Reflect.get(prototype, installed)) {
    prototype.withLock = function (scope, fn) {
        const path = scope === "global" ? this.globalSettingsPath : this.projectSettingsPath;
        // Discovery may read an existing linked configuration. Lock its resolved
        // location, but reject any callback that attempts to write through an alias.
        const { actual } = settingsLocation(path);
        mkdirSync(dirname(actual), { recursive: true, mode: 0o700 });
        const release = this.acquireLockSyncWithRetry(actual);
        try {
            if (settingsLocation(path).actual !== actual)
                throw aliasError();
            let current;
            try {
                current = readFileSync(actual, "utf8");
            }
            catch (error) {
                if (error.code !== "ENOENT")
                    throw error;
            }
            const next = fn(current);
            if (next !== undefined) {
                if (typeof next !== "string")
                    throw Error("Pi 设置存储返回了无效内容，未改写配置。");
                assertSettingsPath(path);
                writePiSettingsBytes(actual, next);
            }
        }
        finally {
            release();
        }
    };
    Object.defineProperty(prototype, installed, { value: true });
}
//# sourceMappingURL=pi-settings-storage.js.map