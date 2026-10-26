import { canonicalJson } from "./json.js";
import { requireIndex } from "./errors.js";
/** Validate the complete final graph, including changes made by earlier transactions. */
export function validateGraph(objects, sourceIds) {
    const identities = new Map();
    const containment = new Map();
    for (const object of objects.values()) {
        if (object.kind !== "edge")
            continue;
        const edge = object.body;
        const from = objects.get(edge.fromId), target = "objectId" in edge.target ? objects.get(edge.target.objectId) : null;
        requireIndex(from && from.kind !== "edge", "INVALID_PROPOSAL", "关系起点不存在或类型无效。");
        requireIndex("objectId" in edge.target ? target && target.kind !== "edge" : sourceIds.has(edge.target.sourceRefId), "INVALID_PROPOSAL", "关系终点不存在。");
        const unique = canonicalJson({ from: edge.fromId, relation: edge.relation, target: edge.target, slot: edge.slot });
        requireIndex(!identities.has(unique) || identities.get(unique) === object.id, "AMBIGUOUS_REUSE", "相同关系已经存在；退休关系必须恢复原标识。");
        identities.set(unique, object.id);
        if (object.lifecycle === "retired")
            continue;
        requireIndex(from.lifecycle === "active" && (!target || target.lifecycle === "active"), "INVALID_PROPOSAL", "活跃关系不能指向退休对象。");
        requireIndex(!target || from.id !== target.id, "INVALID_PROPOSAL", "对象不能建立指向自身的关系。");
        let valid = false;
        switch (edge.relation) {
            case "contains":
                valid = !!target && from.kind === target.kind && (from.kind === "feature" || from.kind === "module");
                break;
            case "uses":
                valid = from.kind === "feature" && target?.kind === "implementation";
                break;
            case "code":
                valid = from.kind === "implementation" && (!target || target.kind === "symbol");
                break;
            case "test":
                valid = ["feature", "implementation", "knowledge"].includes(from.kind) && (!target || target.kind === "symbol");
                break;
            case "relates":
                valid = from.kind === "module" && !!target && ["module", "feature", "implementation"].includes(target.kind);
                break;
            case "applies_to":
                valid = from.kind === "knowledge" && !!target && ["module", "feature", "implementation", "symbol"].includes(target.kind);
                break;
            case "contradicts":
                valid = from.kind === "knowledge" && target?.kind === "knowledge";
                break;
        }
        requireIndex(valid, "INVALID_PROPOSAL", "关系类型不允许这些端点。");
        if (edge.relation === "contains")
            containment.set(from.id, [...(containment.get(from.id) ?? []), target.id]);
    }
    // Iterative DFS avoids overflowing the JS stack on a large or malicious graph.
    const colors = new Map();
    for (const start of containment.keys()) {
        if (colors.get(start) === 2)
            continue;
        const stack = [{ id: start, exit: false }];
        while (stack.length) {
            const frame = stack.pop();
            if (frame.exit) {
                colors.set(frame.id, 2);
                continue;
            }
            if (colors.get(frame.id) === 2)
                continue;
            requireIndex(colors.get(frame.id) !== 1, "INVALID_PROPOSAL", "contains关系不能成环。");
            colors.set(frame.id, 1);
            stack.push({ id: frame.id, exit: true });
            for (const next of containment.get(frame.id) ?? [])
                stack.push({ id: next, exit: false });
        }
    }
    for (const object of objects.values()) {
        if (object.kind !== "feature" || object.lifecycle !== "active")
            continue;
        const feature = object.body;
        const flows = new Set();
        for (const flow of feature.flows) {
            const key = canonicalJson({ before: flow.beforeEdgeId, after: flow.afterEdgeId, condition: flow.condition });
            requireIndex(!flows.has(key), "INVALID_PROPOSAL", "同一流程关系不能重复。");
            flows.add(key);
            for (const id of [flow.beforeEdgeId, flow.afterEdgeId]) {
                const edge = objects.get(id), body = edge?.body;
                requireIndex(edge?.kind === "edge" && edge.lifecycle === "active" && body?.relation === "uses" && body.fromId === object.id, "INVALID_PROPOSAL", "流程必须引用本功能的活跃uses关系。");
            }
        }
    }
}
//# sourceMappingURL=graph.js.map