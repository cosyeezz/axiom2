import type { CanonicalWindow } from "./canonical-window.js";
import { sameLease, type LeaseRef } from "./execution-protocol.js";
import { windowFieldErrorReceipt } from "../shared/window-frame-budget.js";

/** Synchronous worker ingress. The caller sends with this SAME captured owner,
 * never with a lease looked up after an asynchronous operation. */
export function canonicalWindowResponse(value: unknown, owner: {
  runId: string | undefined; lease: LeaseRef | undefined; available: boolean; window: CanonicalWindow | undefined;
}) {
  if (!value || typeof value !== "object") return;
  const event = value as Record<string, unknown>;
  if (event.type !== "window-read" || !owner.runId || event.runId !== owner.runId ||
    owner.lease && !sameLease(event.lease as LeaseRef | undefined, owner.lease) ||
    typeof event.queryId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(event.queryId)) return;
  const frame = owner.available && owner.window ? owner.window.read(event.requestId, event.query)
    : windowFieldErrorReceipt(event.requestId, "UNAVAILABLE").frame;
  return { type: "window-result", queryId: event.queryId, frame };
}
