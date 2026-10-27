/** Small, display-only diagnostics. Never service bodies, headers, or an execution receipt. */
export const kiroFailureStages = Object.freeze(["request", "transport", "response", "http", "stream"] as const);
export const kiroFailureCategories = Object.freeze(["auth", "validation", "quota", "throttle", "transient", "overflow", "unknown", "timeout-or-cancel", "local-or-transport"] as const);
export const kiroServiceFailureCodes = Object.freeze([
  "AccessDeniedException", "UnauthorizedException", "UnrecognizedClientException", "ValidationException",
  "ServiceQuotaExceededException", "ThrottlingException", "TooManyRequestsException",
  "InternalServerException", "InternalServerError", "ServiceUnavailableException",
  "ContextLengthExceededException", "InputTooLongException",
] as const);
/** Local closed vocabulary from same-version static strings, NOT a proven official chat enum. */
export const kiroObservedValidationReasons = Object.freeze([
  "CONTENT_LENGTH_EXCEEDS_THRESHOLD", "INVALID_CONVERSATION_ID", "INVALID_MODEL_ID",
  "PROMPT_TOO_LONG", "REQUEST_BODY_INVALID", "REQUEST_BODY_INVALID_JSON",
  "THINKING_SIGNATURE_INVALID", "TOOL_CONFIG_MISSING", "TOOL_DUPLICATE",
  "TOOL_SCHEMA_INVALID", "TOOL_USE_RESULT_MISMATCH",
] as const);
export type KiroObservedValidationReason = {
  token: typeof kiroObservedValidationReasons[number];
  contract: "unverified";
  source: "local-static-allowlist";
};
export interface KiroFailureDisplay {
  stage: typeof kiroFailureStages[number];
  category: typeof kiroFailureCategories[number];
  partial: boolean;
  status?: number;
  code?: typeof kiroServiceFailureCodes[number];
  requestId?: string;
  observedValidationReason?: KiroObservedValidationReason;
}
