import { resolve } from "node:path";
import { readMemoryBytes, digest } from "./memory-files.js";
const readCoverage = new WeakMap();
/** Successful reads and unavailable attempts are distinct, keyed to the applied compaction. */
export function pendingMemoryRead(manager) {
    const branch = manager.getBranch();
    const compact = [...branch].reverse().find((e) => e.type === "compaction");
    if (!compact)
        return null;
    return branch.some((e) => e.type === "custom" && (e.customType === "axiom-memory-read" || e.customType === "axiom-memory-unavailable") && e.data?.compactionId === compact.id) ? null : compact.id;
}
export function recordMemoryRead(manager, path, cwd, event) {
    const id = pendingMemoryRead(manager);
    if (!id || event.toolName !== "read" || typeof event.input.path !== "string" || resolve(cwd, event.input.path) !== resolve(path) || event.parentToolCallId)
        return false;
    const unavailable = () => {
        manager.appendCustomEntry("axiom-memory-unavailable", { compactionId: id, path });
        return false;
    };
    if (event.isError)
        return unavailable();
    // Accumulate only exact lines actually delivered, scoped to this compaction and revision.
    // A new revision discards previous coverage; a successful label is never proof of a read.
    let bytes;
    try {
        bytes = readMemoryBytes(path);
    }
    catch {
        return unavailable();
    }
    const body = bytes.toString("utf8").replace(/^\uFEFF/, ""), revision = digest(bytes);
    const offset = Number(event.input.offset ?? 1), limit = Number(event.input.limit ?? Infinity);
    if (!Number.isSafeInteger(offset) || offset < 1 || !(limit > 0))
        return false;
    let coverage = readCoverage.get(manager);
    if (!coverage || coverage.id !== id || coverage.revision !== revision) {
        coverage = { id, revision, lines: new Set() };
        readCoverage.set(manager, coverage);
    }
    const lines = body.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    for (const part of event.content ?? []) {
        if (part.type !== "text" || part.text === undefined)
            continue;
        let segment = "";
        for (let line = offset - 1; line < Math.min(lines.length, offset - 1 + limit); line++) {
            segment += lines[line];
            if (!part.text.includes(segment))
                break;
            coverage.lines.add(line);
        }
    }
    if (lines.length ? coverage.lines.size < lines.length : !event.content?.some(part => part.type === "text"))
        return false;
    readCoverage.delete(manager);
    manager.appendCustomEntry("axiom-memory-read", { compactionId: id, path, revision });
    return true;
}
//# sourceMappingURL=memory-recovery.js.map