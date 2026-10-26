import { memoryNodePath } from "./memory-directory.js";
/** Exactly one model-facing catalog: the complete, untruncated, indented tree.
 * Bindings are copied at capture time and never sent to the matching model. */
export function projectMemoryTree(roots) {
    const bindings = new Map(), lines = [];
    const visit = (input, ancestors) => {
        const parts = [...ancestors, input.name], titlePath = memoryNodePath(parts);
        if (input.titlePath !== undefined && input.titlePath !== titlePath || bindings.has(titlePath))
            throw Error("目录路径不一致或存在歧义");
        const node = structuredClone(input);
        bindings.set(titlePath, node);
        lines.push(`${"  ".repeat(ancestors.length)}${input.name}`);
        input.children.forEach(child => visit(child, parts));
    };
    roots.forEach(node => visit(node, []));
    return {
        catalog: `目录：\n${lines.join("\n")}`,
        bindings: [...bindings].map(([titlePath, node]) => ({ titlePath, nodeId: node.id, purposeIds: node.purposeIds ?? [] })),
        resolve(answer) {
            const paths = JSON.parse(answer);
            if (!Array.isArray(paths) || paths.some(path => typeof path !== "string" || !bindings.has(path)) || new Set(paths).size !== paths.length)
                throw Error("目录匹配必须返回真实、精确且不重复的完整标题路径数组");
            return paths.map(path => structuredClone(bindings.get(path)));
        },
    };
}
//# sourceMappingURL=memory-query-projection.js.map