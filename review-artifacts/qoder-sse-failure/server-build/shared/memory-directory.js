/** A semantic navigation key, never a disk path. Segments remain readable. */
export function memoryNodePath(parts) {
    if (!parts.length || parts.some(title => !title || title !== title.trim() || /[/\\\r\n\u0000-\u001f\u007f]/u.test(title)))
        throw Error("记忆目录标题包含路径分隔符、控制字符或首尾空格，必须先处理迁移预检报告");
    return parts.join(" / ");
}
/** A file is identified by both its owning session and relative path. */
export function uniqueMemoryDocuments(refs) {
    const result = new Map();
    for (const ref of refs) {
        const key = JSON.stringify([ref.sessionId, ref.path]), prior = result.get(key);
        result.set(key, prior ? { ...prior, purposeIds: [...new Set([...prior.purposeIds, ...ref.purposeIds])] }
            : { ...ref, purposeIds: [...ref.purposeIds] });
    }
    return [...result.values()];
}
//# sourceMappingURL=memory-directory.js.map