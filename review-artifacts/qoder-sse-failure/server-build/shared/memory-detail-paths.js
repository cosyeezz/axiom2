import { memoryOutline } from "./memory-outline.js";
/** Safe, expected validation failures may be shown without exposing filesystem errors. */
export class MemoryValidationError extends Error {
}
/** One filesystem contract for writers, queries and UI. Never silently merge titles. */
export function memoryTitleSegment(title) {
    const segment = title.normalize("NFC");
    if (!segment || Array.from(segment).some(char => char.length === 1 && /[\ud800-\udfff]/.test(char)) || segment !== segment.trim() || /[\u0000-\u001f\u007f/\\:*?"<>|]/.test(segment) || /[. ]$/.test(segment) || /\.md$/i.test(segment) ||
        /^(?:\.{1,2}|con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i.test(segment) || new TextEncoder().encode(segment).length > 200)
        throw new MemoryValidationError("记忆标题不能用作文件名，请使用简短标题，避免路径分隔符、保留字符、保留名称及末尾空格或句点");
    return segment;
}
export function memoryDetailPaths(nodes) {
    const segments = [], seen = new Set(), directories = new Set();
    const paths = nodes.map((node, index) => {
        if (node.parent !== null && (node.parent < 0 || node.parent >= index))
            throw new MemoryValidationError("记忆标题层级无效");
        const parts = [...(node.parent === null ? [] : segments[node.parent]), memoryTitleSegment(node.title)];
        segments.push(parts);
        const path = `details/${parts.join("/")}.md`, key = path.normalize("NFKC").toUpperCase().toLowerCase();
        if (seen.has(key))
            throw new MemoryValidationError("同一父节点下的记忆标题不能重名或具有大小写等价的文件名");
        if (new TextEncoder().encode(path).length > 2000)
            throw new MemoryValidationError("记忆详情路径过长");
        const ancestors = path.split("/").slice(0, -1);
        for (let length = 1; length <= ancestors.length; length++)
            directories.add(ancestors.slice(0, length).join("/").normalize("NFKC").toUpperCase().toLowerCase());
        seen.add(key);
        return path;
    });
    if ([...seen].some(path => directories.has(path)))
        throw new MemoryValidationError("记忆详情文件与标题目录路径冲突，请避免以.md结尾的标题");
    return paths;
}
export function memoryDetails(entry) {
    const outline = memoryOutline(entry.replace(/^\uFEFF/, "")), paths = memoryDetailPaths(outline.nodes);
    return outline.nodes.map((node, index) => ({ node, path: paths[index] }));
}
/** File metadata only: discovering details must not prefetch their contents. */
export function existingMemoryDetails(entry, files) {
    const existing = new Set(files.map(file => file.path.normalize("NFC")));
    return memoryDetails(entry).filter(detail => existing.has(detail.path));
}
/** Task identity is the complete title ancestry, independent of state or line number. */
export function assertMemoryTreeEdit(previous, next) {
    if (next.includes("\u0000"))
        throw new MemoryValidationError("记忆不能包含NUL字符");
    const lines = next.replace(/^\uFEFF/, "").split(/\r?\n/), outline = memoryOutline(lines.join("\n"));
    if (outline.titleLine !== null || lines.some(line => line.trim() && !/^#{1,6}\s+/.test(line)) ||
        outline.nodes.some(node => !node.state || !node.title || !new RegExp(`^#{${node.depth + 1}}\\s+`).test(lines[node.line]) ||
            /!?(?:\[[^\]\n]*\]\s*(?:\(|\[)|<[^>]+>|\[\^|<!--)/.test(node.title)) ||
        lines.some((line, index) => line.trim() && !outline.nodes.some(node => node.line === index)))
        throw new MemoryValidationError("主记忆只能包含带状态的嵌套标题，不能有正文或链接");
    const after = new Set(memoryDetails(next).map(detail => detail.path));
    for (const detail of memoryDetails(previous))
        if (!after.has(detail.path))
            throw new MemoryValidationError("已有记忆标题不能改名、删除或改变父级；取消任务请保留分支并标为Abandoned");
}
//# sourceMappingURL=memory-detail-paths.js.map