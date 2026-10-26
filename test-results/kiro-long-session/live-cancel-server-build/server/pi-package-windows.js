import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { dirname, basename, join, resolve } from "node:path";
// A named mutex identifies a live command admission, without persisting PID or
// boot-time guesses. It is not evidence that a command's process tree is gone.
const commandLeases = new Set();
function commandMutexApi() {
    const koffi = createRequire(import.meta.url)("koffi");
    const kernel = koffi.load("kernel32.dll");
    return {
        create: kernel.func("void * __stdcall CreateMutexW(void *attributes, int owner, const void *name)"),
        open: kernel.func("void * __stdcall OpenMutexW(uint32_t access, int inherit, const void *name)"),
        wait: kernel.func("uint32_t __stdcall WaitForSingleObject(void *handle, uint32_t milliseconds)"),
        release: kernel.func("int __stdcall ReleaseMutex(void *handle)"),
        close: kernel.func("int __stdcall CloseHandle(void *handle)"),
        error: kernel.func("uint32_t __stdcall GetLastError()"),
    };
}
function commandMutexKey(id, hostPid, path) {
    const identity = path ? join(realpathSync(dirname(resolve(path))), basename(path)).toLowerCase() : "";
    return `Local\\Axiom2.Command.${hostPid}.${createHash("sha256").update(identity).digest("hex")}.${id}`;
}
const commandMutexName = (key) => Buffer.from(`${key}\0`, "utf16le");
export function createWindowsCommandLease(path) {
    if (process.platform !== "win32")
        return undefined;
    const api = commandMutexApi(), id = randomUUID(), key = commandMutexKey(id, process.pid, path), handle = api.create(null, 1, commandMutexName(key));
    if (!handle)
        throw Error("无法登记命令宿主占用，尚未执行程序。");
    if (api.error() === 183) {
        api.close(handle);
        throw Error("命令宿主占用身份已存在，尚未执行程序。");
    }
    commandLeases.add(key);
    let closed = false;
    return { id, close() {
            if (closed)
                return;
            closed = true;
            commandLeases.delete(key);
            try {
                api.release(handle);
            }
            finally {
                api.close(handle);
            }
        } };
}
export function windowsCommandLeaseLive(id, hostPid = process.pid, path) {
    if (process.platform !== "win32" || !/^[a-f0-9-]{36}$/.test(id) || !Number.isSafeInteger(hostPid) || hostPid < 1)
        return false;
    const key = commandMutexKey(id, hostPid, path);
    if (commandLeases.has(key))
        return true;
    const api = commandMutexApi(), handle = api.open(0x00100000 | 0x0001, 0, commandMutexName(key));
    if (!handle)
        return false;
    try {
        const status = api.wait(handle, 0);
        // WAIT_ABANDONED and an unowned mutex both mean admission is no longer live.
        if (status === 0 || status === 0x80)
            api.release(handle);
        return status === 0x102;
    }
    finally {
        api.close(handle);
    }
}
/** Own a whole Windows installer tree before it receives any work over IPC. */
export function ownWindowsPackageTree(pid) {
    if (process.platform !== "win32")
        return undefined;
    if (!["x64", "arm64"].includes(process.arch))
        throw Error("不支持此平台的安装进程隔离。");
    const koffi = createRequire(import.meta.url)("koffi");
    const kernel = koffi.load("kernel32.dll");
    const create = kernel.func("void * __stdcall CreateJobObjectW(void *attributes, const void *name)");
    const configure = kernel.func("int __stdcall SetInformationJobObject(void *job, int kind, void *info, uint32_t size)");
    const open = kernel.func("void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)");
    const assign = kernel.func("int __stdcall AssignProcessToJobObject(void *job, void *process)");
    const terminate = kernel.func("int __stdcall TerminateJobObject(void *job, uint32_t code)");
    const query = kernel.func("int __stdcall QueryInformationJobObject(void *job, int kind, void *info, uint32_t size, void *length)");
    const close = kernel.func("int __stdcall CloseHandle(void *handle)");
    const job = create(null, null);
    if (!job)
        throw Error("无法创建安装进程组。");
    try {
        const limits = Buffer.alloc(144);
        limits.writeUInt32LE(0x2000, 16);
        if (!configure(job, 9, limits, limits.length))
            throw Error("无法设置安装进程组退出规则。");
        const processHandle = open(0x0100 | 0x0001 | 0x0400, 0, pid);
        if (!processHandle)
            throw Error("无法打开安装进程。");
        try {
            if (!assign(job, processHandle))
                throw Error("无法隔离安装进程，尚未执行安装。");
        }
        finally {
            close(processHandle);
        }
    }
    catch (error) {
        close(job);
        throw error;
    }
    let released = false;
    return {
        terminate() { if (!released && !terminate(job, 1))
            throw Error("无法终止安装进程组，请核实后台进程。"); },
        async close() {
            if (released)
                return;
            try {
                if (!terminate(job, 1))
                    throw Error("无法清理安装进程组。");
                const deadline = Date.now() + 5000;
                while (true) {
                    const accounting = Buffer.alloc(48);
                    if (!query(job, 1, accounting, accounting.length, null))
                        throw Error("无法核实安装进程组退出状态。");
                    if (accounting.readUInt32LE(40) === 0)
                        break;
                    if (Date.now() >= deadline)
                        throw Error("安装进程组尚未确认退出，请核实后台进程后重试。");
                    await new Promise(resolve => setTimeout(resolve, 25));
                }
            }
            finally {
                released = true;
                close(job);
            }
        },
    };
}
//# sourceMappingURL=pi-package-windows.js.map