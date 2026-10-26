/** Basename works for paths returned by a Windows or POSIX service. */
export function skillImportName(source, kind) {
    if (source.trim().startsWith("npm:"))
        return "";
    const base = source.trim().replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
    return (kind === "file" || kind !== "folder" && /\.md$/i.test(base) ? base.replace(/\.[^.]+$/, "") : base).trim();
}
//# sourceMappingURL=skill-import.js.map