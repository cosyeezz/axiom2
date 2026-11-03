export class WebReadError extends Error {
  constructor(readonly code: string, message: string, readonly retryable = false) { super(message); }
}
export function webError(error: unknown) {
  if (error instanceof WebReadError) return { code: error.code, message: error.message, retryable: error.retryable };
  // Network/parser errors can contain full URLs, headers and remote HTML. Never echo them.
  return { code: "NETWORK_ERROR", message: "Public webpage reading failed; no alternate route or browser was used.", retryable: true };
}
export function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw new WebReadError(signal.reason?.name === "TimeoutError" ? "TIMEOUT" : "CANCELLED", "Web reading was cancelled or reached its deadline.", true);
}
