import { canonicalJson, digest } from "./json.js";
import { requireIndex } from "./errors.js";
const set = (values) => [...new Map(values.map(value => [canonicalJson(value), value])).entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value);
/** Semantic identity deliberately excludes review, provenance IDs and expected revisions. */
export function semanticHash(body, scope) {
    if (!("kind" in body))
        return digest({ fromId: body.fromId, target: body.target, relation: body.relation, slot: body.slot, role: body.role ?? null, reason: body.reason });
    if (body.kind === "symbol")
        return digest(body);
    const common = { kind: body.kind, name: body.name, summary: body.summary, aliases: set(body.aliases),
        facts: set(body.facts.map(fact => ({ kind: fact.kind, assertion: fact.assertion, text: fact.text }))),
        boundary: { includes: body.boundary.includes, excludes: set(body.boundary.excludes) }, unknowns: set(body.unknowns) };
    if (body.kind === "module")
        return digest({ ...common, scopes: set(body.scopeIds.map(id => { const definition = scope(id); requireIndex(definition, "INVALID_PROPOSAL", "模块范围不存在。"); return definition; })) });
    if (body.kind === "feature")
        return digest({ ...common, flows: set(body.flows.map(flow => ({ beforeEdgeId: flow.beforeEdgeId, afterEdgeId: flow.afterEdgeId, condition: flow.condition }))) });
    if (body.kind === "knowledge")
        return digest({ ...common, knowledgeType: body.knowledgeType, assertion: body.assertion, rationale: body.rationale });
    return digest(common);
}
export function evidenceIds(object) {
    const body = "body" in object ? object.body : object;
    if (!("kind" in body))
        return body.evidenceIds;
    if (body.kind === "symbol")
        return [];
    return [...new Set([...body.facts.flatMap(fact => fact.evidenceIds), ...(body.kind === "feature" ? body.flows.flatMap(flow => flow.evidenceIds) : [])])];
}
export function searchTerms(text) {
    const split = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
    const result = new Set(split.match(/[a-z0-9_.$/-]+/g) ?? []);
    for (const match of split.matchAll(/[\p{Script=Han}]+/gu)) {
        const chars = [...match[0]];
        if (chars.length === 1)
            result.add(chars[0]);
        for (let i = 0; i < chars.length - 1; i++)
            result.add(chars[i] + chars[i + 1]);
    }
    return [...result].filter(term => term.length <= 160).slice(0, 256).sort();
}
export function objectTerms(object) {
    const body = object.body;
    const secondary = "summary" in body ? `${body.summary} ${body.aliases.join(" ")} ${body.facts.map(fact => fact.text).join(" ")}` : "reason" in body ? body.reason : body.qualifiedName;
    const weights = new Map(searchTerms(secondary).map(term => [term, 1]));
    for (const term of searchTerms(`${object.name} ${object.filePath ?? ""}`))
        weights.set(term, 4);
    return [...weights].map(([term, weight]) => ({ term, weight }));
}
//# sourceMappingURL=semantic.js.map