const identity = (path) => JSON.stringify(path.map(node => node.title.normalize("NFC")));
/** Pure tree semantics shared by the entry indicator and host continuation admission.
 * A grouping heading never resets an ancestor's execution boundary. No source states are rewritten.
 */
export function analyzeMemoryTasks(nodes) {
    const result = { displayState: "", actionable: [], diagnostics: [], waiting: [], failed: [], abandoned: [], complete: false };
    const children = nodes.map(() => []), roots = [];
    nodes.forEach((node, index) => {
        // Parsed parents precede children. Fail closed on malformed/foreign outlines.
        if (node.parent === null)
            roots.push(index);
        else if (node.parent >= 0 && node.parent < index)
            children[node.parent].push(index);
    });
    const unfinished = nodes.map(node => !node.abandoned && !!node.state && node.state !== "已完成" && node.state !== "已放弃");
    const descendantOpen = nodes.map(() => false), descendantTasks = nodes.map(() => false);
    for (let i = nodes.length - 1; i >= 0; i--)
        for (const child of children[i]) {
            descendantOpen[i] ||= unfinished[child] || descendantOpen[child];
            descendantTasks[i] ||= !!nodes[child].state || descendantTasks[child];
        }
    let effectiveTasks = 0, allComplete = true;
    const visit = (index, ancestors) => {
        const node = nodes[index], path = [...ancestors, { title: node.title }], key = identity(path);
        if (node.abandoned || node.state === "已放弃") {
            result.abandoned.push(node);
            return;
        }
        if (node.state) {
            effectiveTasks++;
            allComplete &&= node.state === "已完成";
        }
        if (node.state === "等待" || node.state === "阻塞" || node.waiting) {
            result.waiting.push(node);
            allComplete = false;
            return;
        }
        if (node.state === "失败") {
            result.failed.push(node);
            allComplete = false;
            return;
        }
        if (node.state === "已完成" && descendantOpen[index]) {
            result.diagnostics.push({ code: "completed_parent_unfinished", key, title: node.title, path });
            allComplete = false;
            // A completed ancestor is a consistency boundary, never authority to restart its old children.
            return;
        }
        if ((node.state === "未开始" || node.state === "进行中") && !descendantOpen[index]) {
            result.actionable.push({ ...node, state: node.state, path, key, purpose: descendantTasks[index] ? "verify" : "execute" });
        }
        for (const child of children[index])
            visit(child, path);
    };
    for (const root of roots)
        visit(root, []);
    result.complete = effectiveTasks > 0 && allComplete && !result.diagnostics.length;
    result.displayState = result.complete ? "已完成" : result.actionable.some(node => node.state === "进行中") ? "进行中"
        : result.actionable.length ? "未开始" : result.failed.length ? "失败" : result.waiting.length || result.diagnostics.length ? "等待"
            : result.abandoned.length ? "已放弃" : "";
    return result;
}
//# sourceMappingURL=memory-task-analysis.js.map