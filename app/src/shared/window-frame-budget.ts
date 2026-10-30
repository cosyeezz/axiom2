import type { Reply } from "./protocol.js";
import { WINDOW_TEXT_MAX_JSON_BYTES, windowTextChunk } from "./window-text-budget.js";

export const WINDOW_FIELD_MAX_FRAME_JSON_BYTES = 64 * 1024;
export const WINDOW_FIELD_MAX_ERROR_JSON_BYTES = 2 * 1024;
export const WINDOW_FIELD_MAX_TOKEN_CU = 128;
export const WINDOW_FIELD_MAX_REQUEST_ID_CU = 200;

export type WindowField = "text" | "thinking" | "input" | "error" | "selection" | "metadata";
/** Syntactic bounded refs only; the future producer must bind owner/epoch/version.
 * A call uses input for arguments and text for its name; a result uses text for
 * output. Selection is a JSON-encoded from/to record (or null), error is display
 * text. Metadata is a JSON-encoded allowlisted message or collection-item record,
 * never an embedded collection. The producer resolves refs. Never truncate IDs. */
export interface WindowFieldTarget {
  readonly entityRef: string;
  readonly field: WindowField;
  readonly revision: string;
}
export interface WindowFieldChunk {
  readonly text: string;
  readonly offsetCU: number;
  readonly nextOffsetCU: number | null;
  readonly totalLengthCU: number;
}
export interface WindowFieldData extends WindowFieldTarget {
  readonly chunk: WindowFieldChunk;
}
export type WindowFieldSuccessReply = Readonly<Extract<Reply, { ok: true }>> & {
  readonly data: WindowFieldData;
};
const errorMessages = {
  INVALID_REQUEST_ID: "Window request ID must be a normalized string of 1 to 200 code units",
  INVALID_REFERENCE: "Window reference and revision must be bounded opaque tokens",
  INVALID_FIELD: "Window field must be text, thinking, input, error, selection or metadata",
  INVALID_FRAME_BUDGET: "Window field frame budget must be an integer from 2 to 65536 bytes",
  FRAME_BUDGET_TOO_SMALL: "Window field frame budget cannot fit its metadata and text slot",
  INVALID_TEXT: "Window field text must be a string",
  INVALID_OFFSET: "Window field offset must be a UTF-16 boundary within the field",
  BUDGET_TOO_SMALL: "Window field budget cannot fit the next complete code point",
  INTERNAL_FRAME_BUDGET: "Window field frame exceeded its construction budget",
  STALE: "Requested window field version is no longer available",
  UNAVAILABLE: "Requested window field is unavailable",
} as const;
export type WindowFrameErrorCode = keyof typeof errorMessages;
const safeCode = (code: unknown): WindowFrameErrorCode =>
  typeof code === "string" && code.length <= 32 && Object.hasOwn(errorMessages, code)
    ? code as WindowFrameErrorCode : "UNAVAILABLE";
export class WindowFrameBudgetError extends Error {
  readonly code: WindowFrameErrorCode;
  constructor(code: WindowFrameErrorCode) {
    const safe = safeCode(code);
    super(errorMessages[safe]);
    this.name = "WindowFrameBudgetError";
    this.code = safe;
  }
}
export type WindowFieldFailureReply = Readonly<Extract<Reply, { ok: false }>> & {
  readonly error: Readonly<{ code: WindowFrameErrorCode; message: string }>;
};
export interface EncodedWindowFieldReceipt {
  readonly frame: WindowFieldSuccessReply;
  /** Complete receipt UTF-8 bytes, not just the text value. Not added to the wire. */
  readonly encodedBytes: number;
}
export interface EncodedWindowFieldErrorReceipt {
  readonly frame: WindowFieldFailureReply;
  readonly encodedBytes: number;
}
const encoder = new TextEncoder();
const jsonBytes = (frame: WindowFieldSuccessReply | WindowFieldFailureReply) =>
  encoder.encode(JSON.stringify(frame)).byteLength;
export const validRequestId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= WINDOW_FIELD_MAX_REQUEST_ID_CU &&
  !value.includes("\0") && value.trim() === value;
function token(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > WINDOW_FIELD_MAX_TOKEN_CU ||
    !/^[A-Za-z0-9_-]+$/.test(value)) throw new WindowFrameBudgetError("INVALID_REFERENCE");
  return value;
}
function fieldFrame(requestId: string, entityRef: string, field: WindowField, revision: string,
  chunk: WindowFieldChunk): WindowFieldSuccessReply {
  return Object.freeze({ type: "receipt", requestId, ok: true, data: Object.freeze({
    entityRef, field, revision, chunk: Object.freeze({
      text: chunk.text, offsetCU: chunk.offsetCU, nextOffsetCU: chunk.nextOffsetCU, totalLengthCU: chunk.totalLengthCU,
    }),
  }) });
}
/** Builds an actual Reply, not a second envelope. Only known primitive target fields
 * are captured; unknown extras/toJSON are never enumerated or serialized. This is
 * not a sandbox for arbitrary JS getters, nor a handle/version authorization check.
 * The conservative next-pointer reservation need not fill every last frame byte.
 * No source lookup, whole-field encoding/hash, RPC registration or transport change. */
export function windowFieldReceipt(
  requestId: string,
  target: WindowFieldTarget,
  value: string,
  maxFrameJsonBytes = WINDOW_FIELD_MAX_FRAME_JSON_BYTES,
  offsetCU = 0,
): EncodedWindowFieldReceipt {
  if (!validRequestId(requestId)) throw new WindowFrameBudgetError("INVALID_REQUEST_ID");
  if (!target || typeof target !== "object" || Array.isArray(target)) throw new WindowFrameBudgetError("INVALID_REFERENCE");
  const entityRef = token(target.entityRef), field = target.field, revision = token(target.revision);
  if (field !== "text" && field !== "thinking" && field !== "input" && field !== "error" && field !== "selection" && field !== "metadata")
    throw new WindowFrameBudgetError("INVALID_FIELD");
  if (!Number.isSafeInteger(maxFrameJsonBytes) || maxFrameJsonBytes < 2 || maxFrameJsonBytes > WINDOW_FIELD_MAX_FRAME_JSON_BYTES)
    throw new WindowFrameBudgetError("INVALID_FRAME_BUDGET");
  if (typeof value !== "string") throw new WindowFrameBudgetError("INVALID_TEXT");
  if (!Number.isSafeInteger(offsetCU) || offsetCU < 0 || offsetCU > value.length)
    throw new WindowFrameBudgetError("INVALID_OFFSET");

  // null costs four bytes; any non-final next offset is <= the full field length.
  // At EOF next is already known to be null, including a huge field's empty suffix.
  const reservedNext = offsetCU === value.length || value.length < 10000 ? null : value.length;
  const metadata = fieldFrame(requestId, entityRef, field, revision, {
    text: "", offsetCU, nextOffsetCU: reservedNext, totalLengthCU: value.length,
  });
  const textBudget = Math.min(WINDOW_TEXT_MAX_JSON_BYTES, maxFrameJsonBytes - jsonBytes(metadata) + 2);
  if (textBudget < 2) throw new WindowFrameBudgetError("FRAME_BUDGET_TOO_SMALL");
  const chunk = windowTextChunk(value, textBudget, offsetCU);
  const frame = fieldFrame(requestId, entityRef, field, revision, chunk);
  // Safety net only: all objects/strings are already bounded by construction.
  const encodedBytes = jsonBytes(frame);
  if (encodedBytes > maxFrameJsonBytes) throw new WindowFrameBudgetError("INTERNAL_FRAME_BUDGET");
  return Object.freeze({ frame, encodedBytes });
}
/** Fixed safe failure. Invalid correlation produces an uncorrelated empty ID,
 * never echoes/trims the original. A future wire adapter must explicitly use this
 * policy (or close); this pure factory does not change existing server catch paths. */
export function windowFieldErrorReceipt(requestId: unknown, code: WindowFrameErrorCode = "UNAVAILABLE"): EncodedWindowFieldErrorReceipt {
  const valid = validRequestId(requestId), fixedCode = valid ? safeCode(code) : "INVALID_REQUEST_ID";
  const frame: WindowFieldFailureReply = Object.freeze({
    type: "receipt", requestId: valid ? requestId : "", ok: false,
    error: Object.freeze({ code: fixedCode, message: errorMessages[fixedCode] }),
  });
  const encodedBytes = jsonBytes(frame);
  if (encodedBytes > WINDOW_FIELD_MAX_ERROR_JSON_BYTES) throw new WindowFrameBudgetError("INTERNAL_FRAME_BUDGET");
  return Object.freeze({ frame, encodedBytes });
}
