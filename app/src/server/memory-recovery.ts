import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { readMemoryBytes, digest } from "./memory-files.js";
/** Successful reads and unavailable attempts are distinct, keyed to the applied compaction. */
export function pendingMemoryRead(manager: SessionManager): string | null {
  const branch = manager.getBranch();
  const compact = [...branch].reverse().find((e) => e.type === "compaction");
  if (!compact) return null;
  return branch.some((e) => e.type === "custom" && (e.customType === "axiom-memory-read" || e.customType === "axiom-memory-unavailable") && (e.data as { compactionId?: string })?.compactionId === compact.id) ? null : compact.id;
}
export function recordMemoryRead(manager: SessionManager, path: string, cwd: string, event: { toolName: string; input: Record<string, unknown>; isError: boolean; details?: unknown; content?: { type: string; text?: string }[]; parentToolCallId?: string }) {
  const id = pendingMemoryRead(manager);
  if (!id || event.toolName !== "read" || typeof event.input.path !== "string" || resolve(cwd, event.input.path) !== resolve(path) || Number(event.input.offset ?? 1) !== 1 || event.parentToolCallId) return false;
  const unavailable = () => {
    manager.appendCustomEntry("axiom-memory-unavailable", { compactionId: id, path });
    return false;
  };
  if (event.isError) return unavailable();
  const details = event.details as { truncation?: { truncated?: boolean } } | undefined;
  if (details?.truncation?.truncated) return false;
  // Explicit read limits may omit truncation metadata. Verify the delivered text
  // actually contains the entire current entry, not merely a successful tool label.
  let bytes: Buffer;
  try { bytes = readMemoryBytes(path); } catch { return unavailable(); }
  const body = bytes.toString("utf8");
  if (!event.content?.some((part) => part.type === "text" && part.text?.includes(body))) return false;
  manager.appendCustomEntry("axiom-memory-read", { compactionId: id, path, revision: digest(bytes) });
  return true;
}
