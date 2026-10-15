import type { IndexErrorCode } from "../../../shared/code-index.js";

/** Only bounded public errors cross IPC. Never serialize a caught filesystem/SQL error. */
export class IndexError extends Error {
  constructor(readonly code: IndexErrorCode, message: string, readonly retryable = false) { super(message); this.name = "IndexError"; }
}
export function publicIndexError(error: unknown): { code: IndexErrorCode; message: string; retryable: boolean } {
  if (error instanceof IndexError) return { code: error.code, message: error.message.slice(0, 1000), retryable: error.retryable };
  if (error instanceof Error && error.name === "AbortError") return { code: "CANCELLED", message: "索引操作已取消。", retryable: false };
  return { code: "STORE_FAILED", message: "索引操作未完成；请检查索引状态后重试。", retryable: false };
}
export function requireIndex(condition: unknown, code: IndexErrorCode, message: string): asserts condition {
  if (!condition) throw new IndexError(code, message);
}
