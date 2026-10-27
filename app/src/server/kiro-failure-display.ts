import { kiroFailureCategories, kiroFailureStages, kiroServiceFailureCodes, kiroObservedValidationReasons, type KiroFailureDisplay } from "../shared/kiro-failure.js";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const member = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  typeof value === "string" && allowed.some(item => item === value);
// Native JSON has data properties. Never invoke extension-authored getters or stringify unknown objects.
function own(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

/** A strict allowlist, not a generic diagnostics transport or a model-authorization decision. */
export function projectKiroFailure(message: unknown): KiroFailureDisplay | undefined {
  try {
    if (!record(message)) return;
    const stopReason = own(message, "stopReason");
    if (own(message, "role") !== "assistant" || own(message, "provider") !== "kiro" ||
      own(message, "api") !== "kiro-chat" || (stopReason !== "error" && stopReason !== "aborted")) return;
    const diagnostics = own(message, "diagnostics");
    if (!Array.isArray(diagnostics)) return;
    const length = own(diagnostics, "length");
    if (typeof length !== "number" || length > 128) return;
    let details: unknown, count = 0;
    for (let index = 0; index < length; index++) {
      const item = own(diagnostics, String(index));
      if (record(item) && own(item, "type") === "kiro-failure") {
        if (++count > 1) return; // Ambiguous diagnostics must not be silently selected.
        details = own(item, "details");
      }
    }
    if (count !== 1 || !record(details)) return;
    const stage = own(details, "stage"), category = own(details, "category"), partial = own(details, "partial");
    if (!member(stage, kiroFailureStages) || !member(category, kiroFailureCategories) || typeof partial !== "boolean") return;
    const result: KiroFailureDisplay = { stage, category, partial };
    const status = own(details, "status"), code = own(details, "code"), requestId = own(details, "requestId");
    if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) result.status = status;
    if (member(code, kiroServiceFailureCodes)) result.code = code;
    if (typeof requestId === "string" && requestId.length === 36 && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(requestId)) result.requestId = requestId;
    if (result.code === "ValidationException" && (category === "validation" || category === "overflow") &&
      own(details, "conflict") === false && own(details, "bodyState") === "json" && typeof result.status === "number" &&
      (stage === "http" && [400, 413, 422].includes(result.status) || stage === "stream" && result.status >= 200 && result.status < 300)) {
      const observed = own(details, "observedValidationReason");
      if (record(observed) && own(observed, "contract") === "unverified" && own(observed, "source") === "local-static-allowlist") {
        const token = own(observed, "token");
        if (member(token, kiroObservedValidationReasons))
          result.observedValidationReason = { token, contract: "unverified", source: "local-static-allowlist" };
      }
    }
    return result;
  } catch { return undefined; }
}
