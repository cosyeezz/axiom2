import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, realpathSync, lstatSync, readdirSync, statSync, openSync, closeSync, fstatSync, readSync, writeSync, ftruncateSync, constants } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute, extname, sep } from "node:path";
import { markdownLocalLinks } from "../shared/markdown.js";
import { AppError } from "../shared/protocol.js";
import { memoryRoot, ensureMemoryDirectory } from "./memory-storage.js";
import { memoryTemplate } from "../shared/memory.js";
export const digest = (value) => createHash("sha256").update(value).digest("hex");
export const within = (root, path) => { const rel = relative(root, path); return rel === "" || !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`); };
/**
 * Request-scoped decoded-text cache. A revision probe is intentionally still
 * required for every page so an unchanged cache never masks an external edit.
 */
export class MemoryTextCache {
    maxBytes;
    entries = new Map();
    bytes = 0;
    constructor(maxBytes = 1024 * 1024) {
        this.maxBytes = maxBytes;
    }
    clear() { this.entries.clear(); this.bytes = 0; }
    read(key, offset, limit, revision, load) {
        const current = revision(), cached = this.entries.get(key);
        let snapshot = cached?.revision === current ? cached : undefined;
        if (!snapshot) {
            if (cached) {
                this.entries.delete(key);
                this.bytes -= Buffer.byteLength(cached.content);
            }
            snapshot = load();
            if (snapshot.revision !== current)
                throw new AppError("REVISION_CONFLICT", "读取期间资料改变，请重新读取");
            const size = Buffer.byteLength(snapshot.content);
            if (size <= this.maxBytes && this.bytes + size <= this.maxBytes) {
                this.entries.set(key, snapshot);
                this.bytes += size;
            }
        }
        const nextOffset = snapshot.content.length > offset + limit ? offset + limit : null;
        return { ...snapshot, content: snapshot.content.slice(offset, offset + limit), offset, nextOffset };
    }
}
/**
 * Explicit external links are derived from one memory source revision. The
 * caller must still validate the selected target on every access; this cache
 * only avoids reparsing unchanged Markdown link declarations.
 */
export class MemoryLinkCache {
    entries = new Map();
    links(key, revision, load) {
        const cached = this.entries.get(key);
        if (cached?.revision === revision)
            return [...cached.links];
        const links = load();
        this.entries.set(key, { revision, links: [...links] });
        return links;
    }
    clear() { this.entries.clear(); }
}
/** The first level contains every generated title, with no summaries or source bodies. */
export function memoryTitleIndex(candidates) {
    return JSON.stringify(candidates.map(({ sessionId, title }) => ({ sessionId, title })));
}
/**
 * Organizer input has no automatic compaction. Keep immutable identities
 * whole, then include only a complete prefix of files that fits the prompt
 * budget so omitted paths cannot be mistaken for inspected evidence.
 */
export function compactOrganizerProjection(files, maxChars) {
    const selected = [];
    const envelope = () => JSON.stringify({
        files: selected,
        omittedFiles: files.length - selected.length,
        coverage: "文件清单仅供导航，不是已读取的证据。",
    });
    if (envelope().length > maxChars)
        throw new AppError("MEMORY_LIMIT", "整理导航身份元数据超过提示投影预算");
    for (const file of files) {
        selected.push(file);
        if (envelope().length > maxChars) {
            selected.pop();
            break;
        }
    }
    return envelope();
}
/** Tracks only gap-free pages from offset zero; revision changes discard evidence. */
export class MemoryReadEvidence {
    entries = new Map();
    record(key, page) {
        const previous = this.entries.get(key);
        if (previous?.revision !== undefined && previous.revision !== page.revision)
            this.entries.delete(key);
        const current = this.entries.get(key);
        if (current?.complete || page.offset !== (current?.nextOffset ?? 0) || page.nextOffset !== null && page.nextOffset !== page.offset + page.content.length)
            return false;
        const next = { revision: page.revision, nextOffset: page.nextOffset, content: (current?.content ?? "") + page.content, complete: page.nextOffset === null };
        this.entries.set(key, next);
        return next.complete;
    }
    get(key, revision) {
        const entry = this.entries.get(key);
        return entry && (!revision || entry.revision === revision) ? { ...entry } : undefined;
    }
    clear() { this.entries.clear(); }
}
export function memoryDirectory(root, sessionId) {
    if (!/^[a-zA-Z0-9-]+$/.test(sessionId))
        throw new AppError("INVALID_INPUT", "记忆会话标识无效");
    return join(memoryRoot(root), sessionId);
}
export function initializeMemory(root, sessionId) {
    // Resolve the trusted data root, then validate the selected memory location.
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const actualRoot = realpathSync(root);
    const directory = memoryDirectory(actualRoot, sessionId);
    ensureMemoryDirectory(directory);
    const path = join(directory, "MEMORY.md");
    try {
        writeFileSync(path, memoryTemplate, { flag: "wx", mode: 0o600 });
    }
    catch (error) {
        if (error.code !== "EEXIST")
            throw error;
    }
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink() || lstatSync(path).nlink !== 1)
        throw new AppError("MEMORY_PATH", "记忆入口不是普通文件");
    return path;
}
export function memoryPath(directory, input) {
    const path = resolve(directory, input);
    if (!within(directory, path) || path === directory || extname(path).toLowerCase() === ".jsonl")
        throw new AppError("MEMORY_PATH", "只能读取所属记忆资料，不能读取原始对话");
    const actual = realpathSync(path);
    if (!within(realpathSync(directory), actual) || actual !== path || !statSync(actual).isFile() || statSync(actual).nlink !== 1)
        throw new AppError("MEMORY_PATH", "记忆资料不能通过链接越过读取边界");
    return actual;
}
export function memoryFiles(directory, options = {}) {
    const files = [];
    let visited = 0;
    const visit = (dir) => {
        if (++visited > 4000 || realpathSync(dir) !== resolve(dir))
            throw new AppError("MEMORY_LIMIT", "记忆目录扫描超出预算或路径发生变化");
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.isSymbolicLink())
                throw new AppError("MEMORY_PATH", "记忆目录包含符号链接，未生成索引");
            const path = join(dir, entry.name);
            try {
                if (entry.isDirectory())
                    visit(path);
                else if (entry.isFile() && extname(path).toLowerCase() !== ".jsonl") {
                    if (files.length >= 2000)
                        throw new AppError("MEMORY_LIMIT", "记忆资料超过单次扫描 2000 个文件预算");
                    const stat = statSync(memoryPath(directory, relative(directory, path)));
                    // Large artifacts use filesystem metadata, text sources use actual bytes.
                    const revision = stat.size <= 4 * 1024 * 1024 ? digest(readMemoryBytes(path)) : digest(`${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`);
                    files.push({ path: relative(directory, path).split(sep).join("/"), revision, size: stat.size, updatedAt: stat.mtimeMs });
                }
            }
            catch (error) {
                // Only declaration discovery opts in. Normal source scans stay strict;
                // unsafe links, revision conflicts and program errors always propagate.
                if (!options.skipUnavailable || !["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(error.code ?? ""))
                    throw error;
            }
        }
    };
    visit(directory);
    return files.sort((a, b) => a.path.localeCompare(b.path));
}
export function readMemoryBytes(path, maxBytes = 4 * 1024 * 1024) {
    const before = lstatSync(path);
    if (realpathSync(path) !== resolve(path) || !before.isFile() || before.nlink !== 1)
        throw new AppError("MEMORY_PATH", "只能读取无链接的普通资料文件");
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
        const held = fstatSync(fd);
        if (held.dev !== before.dev || held.ino !== before.ino || !held.isFile() || held.nlink !== 1)
            throw new AppError("MEMORY_PATH", "资料身份已变化");
        if (held.size > maxBytes)
            throw new AppError("MEMORY_LIMIT", `文件超过单次读取预算 ${maxBytes} 字节`);
        const bytes = Buffer.alloc(held.size + 1);
        let length = 0;
        while (length < bytes.length) {
            const count = readSync(fd, bytes, length, bytes.length - length, length);
            if (!count)
                break;
            length += count;
        }
        const after = fstatSync(fd), named = lstatSync(path);
        if (realpathSync(path) !== resolve(path) || named.dev !== held.dev || named.ino !== held.ino || named.nlink !== 1 || after.mtimeMs !== held.mtimeMs || after.ctimeMs !== held.ctimeMs || after.size !== held.size || length !== held.size)
            throw new AppError("REVISION_CONFLICT", "读取期间资料改变，请重新读取");
        return bytes.subarray(0, length);
    }
    finally {
        closeSync(fd);
    }
}
/**
 * A correction must derive both its replacement text and CAS token from the
 * same checked byte snapshot.  TextDecoder intentionally keeps the editor
 * facing BOM behavior, while the revision remains the exact on-disk bytes.
 */
export function readMemoryTextSnapshot(path, maxBytes = 4 * 1024 * 1024) {
    const bytes = readMemoryBytes(path, maxBytes);
    if (bytes.includes(0))
        throw new AppError("MEMORY_BINARY", "此产物不是文本，请使用支持的预览方式");
    try {
        return { revision: digest(bytes), content: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
    }
    catch (error) {
        if (error.code === "ERR_ENCODING_INVALID_ENCODED_DATA")
            throw new AppError("MEMORY_BINARY", "此产物不是有效的 UTF-8 文本");
        throw error;
    }
}
export function replaceMemoryFile(path, revision, content) {
    const before = lstatSync(path);
    if (realpathSync(path) !== resolve(path) || !before.isFile() || before.nlink !== 1)
        throw new AppError("MEMORY_PATH", "只能保存无链接的普通资料文件");
    const fd = openSync(path, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
        const identity = () => {
            const held = fstatSync(fd), named = lstatSync(path);
            if (realpathSync(path) !== resolve(path) || !held.isFile() || held.nlink !== 1 || held.dev !== before.dev || held.ino !== before.ino || !named.isFile() || named.nlink !== 1 || named.ino !== held.ino || named.dev !== held.dev)
                throw new AppError("REVISION_CONFLICT", "保存期间文件身份或链接改变，未写入");
            return held;
        };
        const currentBytes = () => {
            const held = identity(), maxBytes = 4 * 1024 * 1024;
            if (held.size > maxBytes)
                throw new AppError("MEMORY_LIMIT", `文件超过单次读取预算 ${maxBytes} 字节`);
            const bytes = Buffer.alloc(held.size + 1);
            let length = 0;
            while (length < bytes.length) {
                const count = readSync(fd, bytes, length, bytes.length - length, length);
                if (!count)
                    break;
                length += count;
            }
            if (identity().size !== held.size || length !== held.size)
                throw new AppError("REVISION_CONFLICT", "保存期间正文已改变，请重新读取后合并");
            return bytes.subarray(0, length);
        };
        // Verify bytes on the actual write descriptor, not timestamps or a separately
        // opened path. Metadata-only changes do not invalidate an unchanged document.
        const original = currentBytes();
        if (digest(original) !== revision)
            throw new AppError("REVISION_CONFLICT", "资料正文已改变，请重新读取后合并");
        if (!currentBytes().equals(original))
            throw new AppError("REVISION_CONFLICT", "保存期间正文已改变，请重新读取后合并");
        // Cooperating detail writers hold their lock across this check and the write.
        // This is not an OS-level atomic CAS against arbitrary external writers.
        // TextDecoder hides a leading UTF-8 BOM from editors. Preserve it on a
        // no-op or local edit so byte-based revisions and on-disk encoding agree.
        const bytes = original.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) && !content.startsWith("\ufeff")
            ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content)]) : Buffer.from(content);
        let offset = 0;
        while (offset < bytes.length)
            offset += writeSync(fd, bytes, offset, bytes.length - offset, offset);
        ftruncateSync(fd, bytes.length);
    }
    finally {
        closeSync(fd);
    }
}
export function textFile(path, maxBytes = 4 * 1024 * 1024) {
    return readMemoryTextSnapshot(path, maxBytes).content;
}
export function referencedPaths(directory, document) {
    return markdownLocalLinks(document).flatMap(({ href }) => {
        try {
            return [resolve(dirname(directory), decodeURIComponent(href.replace(/#.*$/, "")))];
        }
        catch {
            return [];
        }
    });
}
//# sourceMappingURL=memory-files.js.map