import { constants, existsSync, lstatSync, realpathSync, writeFileSync } from "node:fs";
import { access, mkdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { assertMemoryTreeEdit, memoryDetails, MemoryValidationError } from "../shared/memory-detail-paths.js";
import { memoryEditBudgetBytes } from "../shared/memory.js";
import { digest, memoryPath, readMemoryTextSnapshot, readMemoryBytes, replaceMemoryFile, within } from "./memory-files.js";
/** Axiom validation of the actual final native-tool candidate, never edit simulation. */
export function guardMemoryWrite(entry, path, content) {
    const root = dirname(resolve(entry)), target = resolve(path);
    if (!within(root, target))
        return;
    const local = relative(root, target).replaceAll("\\", "/");
    if (local !== "MEMORY.md" && !local.startsWith("details/"))
        return;
    if (content.includes("\u0000") || Buffer.byteLength(content) > memoryEditBudgetBytes)
        throw new MemoryValidationError("记忆正文包含NUL或超过180 KB写入预算");
    if (lstatSync(target, { throwIfNoEntry: false }))
        memoryPath(root, local);
    else if (realpathSync(dirname(target)) !== dirname(target))
        throw new MemoryValidationError("记忆详情目录不能通过符号链接访问");
    const previous = existsSync(entry) ? readMemoryTextSnapshot(entry).content : "";
    if (local === "MEMORY.md")
        assertMemoryTreeEdit(previous, content);
    else if (!memoryDetails(previous).some(detail => detail.path === local))
        throw new MemoryValidationError("详情路径必须对应主记忆中的现有标题，请先保存任务树");
}
/** Original Pi schemas, matching and mutation queue are untouched. The write callback
 * runs inside that queue and validates the final candidate immediately before I/O. */
export function memoryFileOperations(entry, protectedRoots = []) {
    const authorize = (path) => {
        const memory = entry();
        const roots = [...protectedRoots, ...(memory ? [dirname(dirname(memory))] : [])];
        const actual = existsSync(path) ? realpathSync(path) : existsSync(dirname(path)) ? resolve(realpathSync(dirname(path)), relative(dirname(path), path)) : path;
        for (const candidate of [path, actual])
            if (roots.some(root => within(root, candidate)) && (!memory || !within(dirname(memory), candidate)))
                throw Error("只能维护所属主会话的记忆；其他来源记忆只读。");
        return memory;
    };
    return {
        readFile,
        access: (path) => access(path, constants.R_OK | constants.W_OK),
        mkdir: async (path) => { authorize(path); await mkdir(path, { recursive: true }); },
        writeFile: async (path, content) => {
            const memory = authorize(path);
            if (memory)
                guardMemoryWrite(memory, path, content);
            // Existing memory files retain checked-FD CAS; new files cannot follow a leaf link.
            if (memory && within(dirname(memory), path)) {
                if (lstatSync(path, { throwIfNoEntry: false }))
                    replaceMemoryFile(path, digest(readMemoryBytes(path)), content);
                else
                    writeFileSync(path, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
            }
            else
                writeFileSync(path, content, "utf8");
        },
    };
}
//# sourceMappingURL=memory-write-guard.js.map