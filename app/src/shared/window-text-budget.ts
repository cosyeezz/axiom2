/** A JSON string value's ceiling, not a complete window frame's byte budget. */
export const WINDOW_TEXT_MAX_JSON_BYTES = 48 * 1024;

export interface WindowTextChunk {
  readonly text: string;
  readonly offsetCU: number;
  readonly nextOffsetCU: number | null;
  readonly totalLengthCU: number;
  /** Includes JSON quotes and escaping; excludes the surrounding object/envelope. */
  readonly encodedBytes: number;
}

type BudgetErrorCode = "INVALID_TEXT" | "INVALID_BUDGET" | "INVALID_OFFSET" | "BUDGET_TOO_SMALL";
const errorMessages: Record<BudgetErrorCode, string> = {
  INVALID_TEXT: "Text must be a string",
  INVALID_BUDGET: "JSON text budget must be an integer from 2 to 49152 bytes",
  INVALID_OFFSET: "Text offset must be a UTF-16 boundary within the field",
  BUDGET_TOO_SMALL: "JSON text budget cannot fit the next complete code point",
};

export class WindowTextBudgetError extends Error {
  constructor(readonly code: BudgetErrorCode) {
    super(errorMessages[code]);
    this.name = "WindowTextBudgetError";
  }
}

const highSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const lowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * Takes the maximal prefix whose JSON string encoding fits maxJsonBytes.
 * Only scans that prefix plus one candidate code point; never encodes the full
 * field. Preserves lone surrogates and never splits a valid surrogate pair.
 * A non-final chunk always advances; callers must still budget the full frame.
 */
export function windowTextChunk(
  value: string,
  maxJsonBytes = WINDOW_TEXT_MAX_JSON_BYTES,
  offsetCU = 0,
): WindowTextChunk {
  if (typeof value !== "string") throw new WindowTextBudgetError("INVALID_TEXT");
  if (!Number.isSafeInteger(maxJsonBytes) || maxJsonBytes < 2 || maxJsonBytes > WINDOW_TEXT_MAX_JSON_BYTES)
    throw new WindowTextBudgetError("INVALID_BUDGET");
  if (!Number.isSafeInteger(offsetCU) || offsetCU < 0 || offsetCU > value.length ||
    (offsetCU > 0 && offsetCU < value.length && lowSurrogate(value.charCodeAt(offsetCU)) && highSurrogate(value.charCodeAt(offsetCU - 1))))
    throw new WindowTextBudgetError("INVALID_OFFSET");

  let end = offsetCU;
  let encodedBytes = 2; // Opening and closing JSON quotes.
  while (end < value.length) {
    const code = value.charCodeAt(end);
    const paired = highSurrogate(code) && end + 1 < value.length && lowSurrogate(value.charCodeAt(end + 1));
    const bytes = paired ? 4
      : code === 0x22 || code === 0x5c || code === 8 || code === 9 || code === 10 || code === 12 || code === 13 ? 2
      : code < 0x20 ? 6
      : code < 0x80 ? 1
      : code < 0x800 ? 2
      : highSurrogate(code) || lowSurrogate(code) ? 6
      : 3;
    if (encodedBytes + bytes > maxJsonBytes) break;
    encodedBytes += bytes;
    end += paired ? 2 : 1;
  }
  if (end === offsetCU && end < value.length) throw new WindowTextBudgetError("BUDGET_TOO_SMALL");
  return Object.freeze({
    text: value.slice(offsetCU, end), offsetCU,
    nextOffsetCU: end < value.length ? end : null,
    totalLengthCU: value.length, encodedBytes,
  });
}
