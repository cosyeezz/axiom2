import koffi from "koffi";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import path from "node:path";
import { requireIndex } from "../domain/errors.js";
let windows;
function windowsApi() {
    const dll = koffi.load("kernel32.dll");
    const time = koffi.struct({ low: "uint32", high: "uint32" });
    const info = koffi.struct({ attributes: "uint32", created: time, accessed: time, written: time, volume: "uint32", sizeHigh: "uint32", sizeLow: "uint32", links: "uint32", indexHigh: "uint32", indexLow: "uint32" });
    return {
        open: dll.func("__stdcall", "CreateFileW", "intptr_t", ["str16", "uint32", "uint32", "void *", "uint32", "uint32", "intptr_t"]),
        info: dll.func("__stdcall", "GetFileInformationByHandle", "int", ["intptr_t", koffi.out(koffi.pointer(info))]),
        read: dll.func("int __stdcall ReadFile(intptr_t h, void *buffer, uint32_t size, _Out_ uint32_t *count, void *overlapped)"),
        close: dll.func("int __stdcall CloseHandle(intptr_t h)"),
    };
}
function windowsFile(absolute) {
    const api = windows ??= windowsApi(), handles = [];
    const describe = (handle) => {
        const result = {};
        requireIndex(api.info(handle, result) !== 0, "ACCESS_DENIED", "无法验证索引文件身份。");
        requireIndex(!(result.attributes & 0x400), "ACCESS_DENIED", "索引不跟随重解析目录或文件。");
        return result;
    };
    const snapshot = (handle) => {
        const info = describe(handle);
        return { size: info.sizeHigh * 0x1_0000_0000 + info.sizeLow, stamp: [info.volume, info.indexHigh, info.indexLow, info.sizeHigh, info.sizeLow, info.written.high, info.written.low].join(":") };
    };
    const close = () => { for (const handle of handles.reverse())
        api.close(handle); handles.length = 0; };
    try {
        const root = path.parse(absolute).root, parts = absolute.slice(root.length).split(path.sep).filter(Boolean);
        let current = root;
        for (let i = -1; i < parts.length; i++) {
            if (i >= 0)
                current = path.join(current, parts[i]);
            const directory = i < parts.length - 1;
            // Excluding FILE_SHARE_DELETE holds every ancestor against rename/replacement.
            const handle = api.open(current, directory ? 0x80 : 0x8000_0000, 0x1 | 0x2, null, 3, 0x0020_0000 | (directory ? 0x0200_0000 : 0), 0);
            requireIndex(handle !== -1 && handle !== -1n, "ACCESS_DENIED", "无法稳定打开索引文件。");
            handles.push(handle);
            requireIndex(!!(describe(handle).attributes & 0x10) === directory, "ACCESS_DENIED", "索引路径类型已变化。");
        }
        const handle = handles.at(-1), initial = snapshot(handle);
        return { ...initial, current: () => snapshot(handle), close, read: maxBytes => {
                const bytes = Buffer.alloc(maxBytes), count = [0];
                requireIndex(api.read(handle, bytes, maxBytes, count, null) !== 0, "FILE_CHANGED", "索引文件读取失败。");
                return bytes.subarray(0, count[0]);
            } };
    }
    catch (error) {
        close();
        throw error;
    }
}
let openAt;
function posixFile(absolute) {
    openAt ??= koffi.load(null).func("int openat(int directory, const char *name, int flags)");
    const descriptors = [], root = path.parse(absolute).root;
    const close = () => { for (const fd of descriptors.reverse())
        closeSync(fd); descriptors.length = 0; };
    try {
        descriptors.push(openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW));
        const parts = absolute.slice(root.length).split(path.sep).filter(Boolean);
        for (let i = 0; i < parts.length; i++) {
            // Each name is relative to the already held parent, never to a mutable pathname.
            const fd = openAt(descriptors.at(-1), parts[i], constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | (i < parts.length - 1 ? constants.O_DIRECTORY : 0));
            requireIndex(fd >= 0, "ACCESS_DENIED", "无法稳定打开索引文件。");
            descriptors.push(fd);
        }
        const fd = descriptors.at(-1);
        const current = () => { const stat = fstatSync(fd, { bigint: true }); requireIndex(stat.isFile(), "ACCESS_DENIED", "索引仅读取普通文件。"); return { size: Number(stat.size), stamp: [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":") }; };
        return { ...current(), current, close, read: maxBytes => {
                const buffer = Buffer.alloc(maxBytes);
                let at = 0;
                while (at < maxBytes) {
                    const count = readSync(fd, buffer, at, maxBytes - at, at);
                    if (!count)
                        break;
                    at += count;
                }
                return buffer.subarray(0, at);
            } };
    }
    catch (error) {
        close();
        throw error;
    }
}
/** Only fixed OS APIs are loaded. This never loads a library or script from the workspace. */
export function openHeldFile(absolute) {
    requireIndex(path.isAbsolute(absolute), "ACCESS_DENIED", "索引路径必须绑定授权根。");
    return process.platform === "win32" ? windowsFile(absolute) : posixFile(absolute);
}
export function readHeldFile(absolute, maxBytes) {
    const file = openHeldFile(absolute);
    try {
        requireIndex(file.size <= maxBytes, "BUDGET_EXCEEDED", "文件超过索引读取上限。");
        const bytes = file.read(maxBytes + 1), after = file.current();
        requireIndex(bytes.length <= maxBytes, "BUDGET_EXCEEDED", "文件超过索引读取上限。");
        requireIndex(after.stamp === file.stamp && bytes.length === after.size, "FILE_CHANGED", "读取期间文件发生变化。");
        return bytes;
    }
    finally {
        file.close();
    }
}
//# sourceMappingURL=held-file.js.map