import { AppError } from "../shared/protocol.js";

/** Socket-local correlation ownership. A duplicate must not replace the controller
 * for the first request, nor may a rejected duplicate release that first owner. */
export function assertReadRequestAvailable(reads: ReadonlyMap<string, AbortController>, requestId: string) {
  if (reads.has(requestId)) throw new AppError("DUPLICATE_REQUEST", "相同请求标识仍在读取中");
}
export function claimReadRequest(reads: Map<string, AbortController>, requestId: string) {
  assertReadRequestAvailable(reads, requestId);
  const controller = new AbortController(); reads.set(requestId, controller);
  return controller;
}
export function releaseReadRequest(reads: Map<string, AbortController>, requestId: string, owner: AbortController | undefined) {
  if (owner && reads.get(requestId) === owner) reads.delete(requestId);
}
