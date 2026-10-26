import { Type } from "typebox";
import { Check } from "typebox/value";
import { canonicalJson } from "./json.js";
import { IndexError } from "./errors.js";
export const closed = (properties) => Type.Object(properties, { additionalProperties: false });
export const idSchema = Type.String({ minLength: 1, maxLength: 160, pattern: "^[A-Za-z0-9_.:-]+$" });
export const hashSchema = Type.String({ pattern: "^[a-f0-9]{64}$" });
export const shortText = Type.String({ maxLength: 2000 });
export const bodyText = Type.String({ maxLength: 6000 });
export const idsSchema = Type.Array(idSchema, { maxItems: 128, uniqueItems: true });
export const revisionSchema = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
export const nonnegativeSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
export const cursorSchema = Type.String({ minLength: 1, maxLength: 256 });
export const roleSchema = Type.Union(["primary", "entry", "guard", "contract", "test"].map(value => Type.Literal(value)));
export const relationSchema = Type.Union(["contains", "uses", "code", "test", "relates", "applies_to", "contradicts"].map(value => Type.Literal(value)));
export const scopeDefinitionSchema = closed({ include: Type.Array(Type.String({ maxLength: 1024 }), { minItems: 1, maxItems: 32, uniqueItems: true }), exclude: Type.Array(Type.String({ maxLength: 1024 }), { maxItems: 32, uniqueItems: true }) });
export const coverageSchema = closed({ mode: Type.Union([Type.Literal("partial"), Type.Literal("reviewed_scope")]), scopeIds: idsSchema,
    gaps: Type.Array(closed({ code: Type.String({ maxLength: 80 }), description: shortText, scopeId: Type.Optional(idSchema) }), { maxItems: 128 }) });
export const positionSchema = closed({ line: nonnegativeSchema, character: nonnegativeSchema });
export const rangeSchema = closed({ start: positionSchema, end: positionSchema, encoding: Type.Literal("utf-16") });
export const sourceRefSchema = closed({ id: idSchema, workspaceId: idSchema, path: Type.String({ minLength: 1, maxLength: 4096 }), contentHash: hashSchema, range: rangeSchema });
export const claimSchema = closed({ kind: Type.Union(["responsibility", "trigger", "condition", "action", "result", "contract", "constraint", "decision"].map(value => Type.Literal(value))),
    assertion: Type.Union([Type.Literal("observed"), Type.Literal("specified")]), text: Type.String({ minLength: 1, maxLength: 2000 }), evidenceIds: Type.Array(idSchema, { minItems: 1, maxItems: 64, uniqueItems: true }) });
export const flowSchema = closed({ beforeEdgeId: idSchema, afterEdgeId: idSchema, condition: shortText, evidenceIds: Type.Array(idSchema, { minItems: 1, maxItems: 64, uniqueItems: true }) });
const cas = { expectedContentRev: Type.Union([revisionSchema, Type.Null()]), expectedRecordRev: Type.Union([revisionSchema, Type.Null()]) };
const nodeBase = { id: idSchema, ...cas, name: Type.String({ minLength: 1, maxLength: 256 }), summary: bodyText,
    aliases: Type.Array(Type.String({ maxLength: 256 }), { maxItems: 32, uniqueItems: true }), facts: Type.Array(claimSchema, { minItems: 1, maxItems: 64 }),
    boundary: closed({ includes: shortText, excludes: Type.Array(shortText, { maxItems: 32 }) }), unknowns: Type.Array(shortText, { maxItems: 32 }), coverage: coverageSchema };
export const nodeProposalSchema = Type.Union([
    closed({ ...nodeBase, kind: Type.Literal("module"), scopeIds: idsSchema }),
    closed({ ...nodeBase, kind: Type.Literal("implementation") }),
    closed({ ...nodeBase, kind: Type.Literal("feature"), flows: Type.Array(flowSchema, { maxItems: 120 }) }),
    closed({ ...nodeBase, kind: Type.Literal("knowledge"), knowledgeType: Type.Union([Type.Literal("contract"), Type.Literal("constraint"), Type.Literal("decision")]),
        assertion: Type.Union([Type.Literal("observed"), Type.Literal("specified")]), rationale: Type.Union([shortText, Type.Null()]), authoritySourceIds: idsSchema }),
]);
export const edgeTargetSchema = Type.Union([closed({ objectId: idSchema }), closed({ sourceRefId: idSchema })]);
export const edgeProposalSchema = closed({ id: idSchema, ...cas, fromId: idSchema, target: edgeTargetSchema,
    relation: relationSchema, slot: Type.String({ maxLength: 160 }), role: Type.Optional(roleSchema), reason: shortText,
    evidenceIds: Type.Array(idSchema, { minItems: 1, maxItems: 64, uniqueItems: true }) });
const lifecycle = closed({ id: idSchema, expectedContentRev: revisionSchema, expectedRecordRev: revisionSchema, reason: shortText,
    evidenceIds: Type.Array(idSchema, { minItems: 1, maxItems: 64, uniqueItems: true }) });
export const selectionSchema = closed({ objectIds: idsSchema,
    locations: Type.Array(closed({ sourceRefId: idSchema, symbolId: Type.Optional(idSchema), role: roleSchema, reason: shortText }), { maxItems: 64 }),
    featurePaths: Type.Array(Type.Array(idSchema, { minItems: 1, maxItems: 32 }), { maxItems: 32 }), knowledgeIds: idsSchema });
export const proposalSchema = closed({ version: Type.Literal("index-proposal/1"), requestId: idSchema,
    nodes: Type.Array(nodeProposalSchema, { maxItems: 32 }), edges: Type.Array(edgeProposalSchema, { maxItems: 128 }),
    reviews: Type.Array(closed({ id: idSchema, expectedContentRev: revisionSchema, expectedRecordRev: revisionSchema, evidenceIds: idsSchema, scopeIds: idsSchema }), { maxItems: 128 }),
    retire: Type.Array(lifecycle, { maxItems: 128 }), reactivate: Type.Array(lifecycle, { maxItems: 128 }),
    result: closed({ status: Type.Union([Type.Literal("ok"), Type.Literal("partial"), Type.Literal("not_found")]), selection: selectionSchema, searchedScopeIds: idsSchema, coverage: coverageSchema }) });
export const querySchema = closed({ query: Type.Optional(Type.String({ minLength: 1, maxLength: 4000 })), ids: Type.Optional(idsSchema), scopeIds: Type.Optional(idsSchema),
    direction: Type.Optional(Type.Union([Type.Literal("outgoing"), Type.Literal("incoming")])), cursor: Type.Optional(cursorSchema) });
const continuation = { cursor: Type.Optional(cursorSchema) };
export const evidenceOperationSchema = Type.Union([
    closed({ kind: Type.Literal("search"), text: Type.String({ minLength: 1, maxLength: 2000 }), scopeId: idSchema, caseSensitive: Type.Boolean(), ...continuation }),
    closed({ kind: Type.Literal("read"), path: Type.String({ minLength: 1, maxLength: 4096 }), startLine: nonnegativeSchema, endLine: nonnegativeSchema, ...continuation }),
    closed({ kind: Type.Literal("fetch_ref"), sourceRefId: idSchema, ...continuation }),
    closed({ kind: Type.Literal("definition"), symbolId: idSchema, ...continuation }),
    closed({ kind: Type.Literal("references"), symbolId: idSchema, ...continuation }),
    closed({ kind: Type.Literal("changes"), scopeId: idSchema, ...continuation }),
]);
export const evidenceSchema = closed({ operations: Type.Array(evidenceOperationSchema, { minItems: 1, maxItems: 8 }) });
export const locateSchema = closed({ query: Type.String({ minLength: 1, maxLength: 4000 }),
    hints: Type.Optional(closed({ paths: Type.Optional(Type.Array(Type.String({ maxLength: 4096 }), { maxItems: 32 })), symbols: Type.Optional(Type.Array(Type.String({ maxLength: 256 }), { maxItems: 32 })) })), cursor: Type.Optional(cursorSchema) });
export const overviewSchema = closed({ scopeIds: Type.Optional(idsSchema), cursor: Type.Optional(cursorSchema) });
export function validate(schema, value, maxBytes = 196_608) {
    let serialized;
    try {
        serialized = canonicalJson(value);
    }
    catch {
        throw new IndexError("INVALID_INPUT", "索引输入必须是有效JSON。");
    }
    if (Buffer.byteLength(serialized) > maxBytes || !Check(schema, value))
        throw new IndexError("INVALID_INPUT", "索引输入字段、类型或大小无效。");
    // Detach from caller mutation before any asynchronous operation.
    return JSON.parse(serialized);
}
export const parseProposal = (value) => validate(proposalSchema, value);
export const parseQuery = (value) => validate(querySchema, value);
export const parseEvidence = (value) => validate(evidenceSchema, value);
//# sourceMappingURL=schema.js.map