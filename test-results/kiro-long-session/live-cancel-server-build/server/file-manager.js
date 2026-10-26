import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { WindowsOpenHost } from "./windows-open-host.js";
export class FileManagerError extends Error {
    status;
    constructor(message = "无法打开系统文件管理器", status = 503) {
        super(message);
        this.status = status;
    }
}
export function nativeFileManager() {
    const host = process.platform === "win32" ? new WindowsOpenHost("explorer") : undefined;
    let keepWarm = false;
    const reveal = async (directory, signal, selection) => {
        signal.throwIfAborted();
        let prepared;
        if (host) {
            try {
                prepared = await host.take(keepWarm, signal);
            }
            catch {
                signal.throwIfAborted();
                throw new FileManagerError();
            }
        }
        return new Promise((resolve, reject) => {
            let child;
            try {
                const executable = process.platform === "darwin" ? "/usr/bin/open" : selection ? "dbus-send" : "xdg-open";
                const args = process.platform === "darwin" ? (selection ? ["-R", selection] : [directory])
                    : selection ? ["--session", "--print-reply", "--dest=org.freedesktop.FileManager1", "/org/freedesktop/FileManager1",
                        "org.freedesktop.FileManager1.ShowItems", `array:string:${pathToFileURL(selection).href.replace(/,/g, "%2C")}`, "string:"] : [directory];
                child = prepared ?? spawn(executable, args, { shell: false, stdio: "ignore" });
            }
            catch {
                reject(new FileManagerError());
                return;
            }
            // Wait for the opener to accept the request, so a missing file/desktop reports failure.
            if (!prepared) {
                const abort = () => { child.kill("SIGKILL"); };
                signal.addEventListener("abort", abort, { once: true });
                child.once("error", () => {
                    signal.removeEventListener("abort", abort);
                    reject(signal.aborted ? signal.reason : new FileManagerError());
                });
                child.once("close", code => {
                    signal.removeEventListener("abort", abort);
                    if (signal.aborted)
                        reject(signal.reason);
                    else if (code !== 0)
                        reject(new FileManagerError());
                    else
                        resolve();
                });
                if (signal.aborted)
                    abort();
                return;
            }
            let output = "", bytes = 0, failure;
            const terminate = () => { if (child.exitCode === null && child.signalCode === null)
                child.kill("SIGKILL"); };
            const abort = () => { failure = signal.reason; terminate(); };
            const collect = (chunk, stdout) => {
                bytes += chunk.length;
                if (bytes > 4096) {
                    failure ??= new FileManagerError();
                    terminate();
                }
                else if (stdout)
                    output += chunk.toString("utf8");
            };
            child.stdout.on("data", (chunk) => collect(chunk, true));
            child.stderr.on("data", (chunk) => collect(chunk, false));
            child.once("error", () => { failure ??= new FileManagerError(); });
            signal.addEventListener("abort", abort, { once: true });
            child.once("close", (code) => {
                signal.removeEventListener("abort", abort);
                if (failure)
                    reject(failure);
                else if (code === 2 && output.trim() === "foreground-unavailable")
                    reject(new FileManagerError("无法将系统文件管理器切换到前台，请确认 Windows 桌面已连接并解锁后重试"));
                else if (code !== 0 || output.trim() !== "opened")
                    reject(new FileManagerError());
                else
                    resolve();
            });
            if (signal.aborted)
                abort();
            else
                child.stdin.end(JSON.stringify({ directory, selection }) + "\n", "utf8", (error) => {
                    if (error) {
                        failure ??= new FileManagerError();
                        terminate();
                    }
                });
        });
    };
    reveal.prepare = async () => { keepWarm = true; await host?.prepare(); };
    reveal.close = async () => { await host?.close(); };
    return reveal;
}
/** Windows succeeds only after the requested Explorer is foreground and positioned, and its helper has exited. */
export class FileManager {
    reveal;
    timeoutMs;
    active;
    closed = false;
    constructor(reveal = nativeFileManager(), timeoutMs = 10_000) {
        this.reveal = reveal;
        this.timeoutMs = timeoutMs;
    }
    async prepare() { await this.reveal.prepare?.(); }
    async open(directory, signal, selection) {
        if (this.closed)
            throw new FileManagerError("服务正在退出");
        if (this.active)
            throw new FileManagerError("正在打开系统文件管理器，请稍候", 409);
        signal.throwIfAborted();
        if (!isAbsolute(directory) || directory.length > 4096 || /[\x00-\x1f\x7f]/.test(directory))
            throw new FileManagerError("工作空间目录无效", 400);
        if (selection !== undefined && (!isAbsolute(selection) || selection.length > 4096 || /[\x00-\x1f\x7f]/.test(selection) || resolve(dirname(selection)) !== resolve(directory)))
            throw new FileManagerError("所选文件路径无效", 400);
        const controller = new AbortController();
        const abort = () => controller.abort(new FileManagerError("打开请求已断开", 499));
        signal.addEventListener("abort", abort, { once: true });
        const timer = setTimeout(() => controller.abort(new FileManagerError("打开系统文件管理器超时，请重试", 504)), this.timeoutMs);
        timer.unref();
        const done = Promise.resolve().then(async () => {
            controller.signal.throwIfAborted();
            let directoryExists = false;
            try {
                directoryExists = (await stat(directory)).isDirectory();
            }
            catch { /* Report a missing/unavailable directory consistently. */ }
            controller.signal.throwIfAborted();
            if (!directoryExists)
                throw new FileManagerError("工作空间目录不存在或无法访问", 400);
            if (selection !== undefined) {
                let fileExists = false;
                try {
                    fileExists = (await stat(selection)).isFile();
                }
                catch { /* Do not silently lose the requested selection. */ }
                controller.signal.throwIfAborted();
                if (!fileExists)
                    throw new FileManagerError("所选文件不存在或无法访问", 400);
            }
            await this.reveal(directory, controller.signal, selection);
            controller.signal.throwIfAborted();
        });
        this.active = { controller, done };
        try {
            await done;
        }
        finally {
            clearTimeout(timer);
            signal.removeEventListener("abort", abort);
            this.active = undefined;
        }
    }
    async close() {
        this.closed = true;
        const active = this.active;
        active?.controller.abort(new FileManagerError("服务正在退出"));
        await this.reveal.close?.();
        await active?.done.catch(() => { });
    }
}
//# sourceMappingURL=file-manager.js.map