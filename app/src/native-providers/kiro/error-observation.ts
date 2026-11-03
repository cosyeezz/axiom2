import { kiroObservedValidationReasons, kiroServiceFailureCodes } from "./failure-contract.js";
import type { KiroErrorBody } from "./failure.js";

// Observations only. Errors may quote user-controlled input: token matches must
// never change classification, recovery policy, or authorize a request replay.
const codes = ["invalid_request_error", "invalid_request", "invalid_value", "unsupported_value", "invalid_json_schema",
  "invalid_tool_schema", "model_not_found", "bad_request", ...kiroServiceFailureCodes, ...kiroObservedValidationReasons] as const;
const mentions = ["anyOf", "oneOf", "allOf", "input_schema", "additionalProperties", "properties", "required", "parameters",
  "tools", "tool", "schema", "object", "reasoning", "effort", "xhigh", "instructions", "model", "profile",
  "max_output_tokens", "max_tokens", "thinking", "unsupported", "invalid", "missing", "must", "top level", "root",
  "read", "bash", "edit", "write", "delegate", "append", "cancel_task", "read_result", "memory_query", "web_read", "web_search", "axiom_search"] as const;
const fields = ["code", "type", "__type", "reason", "param", "field", "parameter", "message", "errorMessage", "detail"] as const;
const signatures = new Map([
  ["Unsupported reasoning effort.", "unsupported-effort-v1"],
  ["Invalid tool schema.", "invalid-tool-schema-v1"],
  ["input_schema does not support oneOf, allOf, or anyOf at the top level", "top-level-combinator-v1"],
]);
const own = (object: object, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function parameter(value: string) {
  if (value.length > 256 || /\s/.test(value)) return;
  const normalized = value.replace(/\[(\d{1,4})\]/g, ".$1");
  const parts = normalized.split(".");
  if (parts.length > 12 || parts.some(part => /^\d+$/.test(part) && (!/^(0|[1-9]\d{0,3})$/.test(part) || Number(part) > 1023))) return;
  if (/^(?:model|instructions|input|tools)$/.test(normalized) ||
    /^(?:additionalModelRequestFields\.)?(?:reasoning\.effort|output_config\.effort|thinking\.type)$/.test(normalized)) return normalized;
  // Fixed Responses input fields only; never expose arbitrary context/property names.
  if (/^input\.\d{1,4}\.call_id$/.test(normalized)) return normalized;
  // Remaining array indices occur only at tools or beneath schema combinators. Unknown
  // property names are deliberately not copied, even inside a valid schema path.
  if (!/^tools\.\d{1,4}(?:\.(?:function|custom))?(?:\.(?:parameters|input_schema)(?:\.(?:anyOf|oneOf|allOf)\.\d{1,4}){0,3}(?:\.(?:type|required|additionalProperties|properties|anyOf|oneOf|allOf))?)?$/.test(normalized)) return;
  return parts.join("."); // Entire path reconstructed only from the closed vocabulary/bounded indices.
}

/** Only root/error objects; no traversal of arbitrary metadata, contexts or headers. */
export function observeKiroError(body: KiroErrorBody) {
  if (body.state !== "json" || !record(body.data)) return undefined;
  const sources: { source: "root" | "error"; object: Record<string, unknown> }[] = [{ source: "root", object: body.data }];
  const error = own(body.data, "error");
  if (record(error)) sources.push({ source: "error", object: error });
  const observations = sources.map(({ source, object }) => {
    const foundFields = new Set<string>(), foundCodes = new Set<string>(), foundMentions = new Set<string>();
    const parameters = new Set<string>(), foundSignatures = new Set<string>();
    let unknownCode = false, unknownParameter = false, truncated = false;
    for (const key of fields) {
      const value = own(object, key);
      if (value === undefined) continue;
      foundFields.add(key);
      if (["code", "type", "__type", "reason"].includes(key)) {
        const matched = codes.find(code => code === value);
        if (matched) foundCodes.add(matched); else unknownCode = true;
      } else if (["param", "field", "parameter"].includes(key)) {
        const path = typeof value === "string" ? parameter(value) : undefined;
        if (path) parameters.add(path); else unknownParameter = true;
      } else if (typeof value === "string") {
        if (value.length > 2048) { truncated = true; continue; }
        const lower = value.toLowerCase();
        for (const token of mentions)
          if (new RegExp(`(^|[^a-z0-9_])${token.toLowerCase()}($|[^a-z0-9_])`).test(lower)) foundMentions.add(token);
        const signature = signatures.get(value);
        if (signature) foundSignatures.add(signature);
      }
    }
    return { source, fields: [...foundFields].sort(), codes: [...foundCodes].sort(), mentions: [...foundMentions].sort(),
      parameters: [...parameters].sort(), signatures: [...foundSignatures].sort(), unknownCode, unknownParameter, truncated };
  });
  const result = { version: 1, evidence: "local-allowlist-observation", observations };
  return JSON.stringify(result).length <= 4096 ? result : { version: 1, evidence: "projection-limit", observations: [] };
}
