import { readFileSync } from "node:fs";
import {
  estimateTokens,
  buildSessionProjection,
  type CompactionEntry,
  type CompactionEntryDraft,
  type SessionEntry,
  type SessionHeader,
  type SessionManager,
} from "@earendil-works/pi-coding-agent";

type Reader = Pick<SessionManager, "getHeader" | "getBranch">;
export interface CompressionSnapshot {
  header: SessionHeader;
  entries: SessionEntry[];
}
const bytes = (value: unknown) => JSON.stringify(value);
const copy = <T>(value: T): T => JSON.parse(bytes(value));
const conflict = () => new Error("压缩快照与当前会话冲突；未替换上下文。");

// Safety comes from the caller's pi/idle boundary, not from requiring every
// historical tool call to have succeeded. Failed streams and stopped processes
// can leave calls without results; those entries remain valid summary input.
function assertRetainedTools(entries: SessionEntry[], firstKeptEntryId: string) {
  const retained = new Set(entries.slice(entries.findIndex((entry) => entry.id === firstKeptEntryId)).map((entry) => entry.id));
  const calls = new Map<string, string>();
  for (const { sourceEntry, messages } of buildSessionProjection(entries).entries) {
    for (const message of messages) {
      if (message.role === "assistant") {
        for (const block of message.content)
          if (block.type === "toolCall") calls.set(block.id, sourceEntry.id);
      } else if (message.role === "toolResult") {
        const call = calls.get(message.toolCallId);
        // Reject a newly split pair, not an already-incomplete historical turn.
        if (retained.has(sourceEntry.id) && call && !retained.has(call)) throw conflict();
      }
    }
  }
}

export function captureCompression(manager: Reader): CompressionSnapshot {
  const header = manager.getHeader();
  if (!header || header.type !== "session" || !header.id) throw conflict();
  const entries = manager.getBranch();
  return copy({ header, entries });
}

export function hasCompression(manager: Reader, id: string): boolean {
  return manager.getBranch().some((entry) => entry.type === "compaction" &&
    (entry.details as { axiomCompressionId?: string } | undefined)?.axiomCompressionId === id);
}

// SessionManager appends synchronously, but mutates memory before writing. Never
// acknowledge memory alone after a failed disk write (or an unflushed session).
export function compressionPersisted(manager: SessionManager, id: string): boolean {
  const entry = manager.getBranch().find((entry) => entry.type === "compaction" &&
    (entry.details as { axiomCompressionId?: string } | undefined)?.axiomCompressionId === id);
  if (!entry) return false;
  if (!manager.isPersisted()) return true;
  const file = manager.getSessionFile();
  if (!file) return false;
  try {
    return readFileSync(file, "utf8").split("\n").some((line) => line === bytes(entry));
  } catch { return false; }
}

export function compressionDraft(
  manager: Reader, snapshot: CompressionSnapshot, entry: CompactionEntry, id: string,
): CompactionEntryDraft {
  const header = manager.getHeader(), branch = manager.getBranch();
  if (!id || !header || !snapshot?.header || header.id !== snapshot.header.id ||
      bytes(header) !== bytes(snapshot.header) || !Array.isArray(snapshot.entries) ||
      snapshot.entries.length === 0 || branch.length < snapshot.entries.length ||
      bytes(branch.slice(0, snapshot.entries.length)) !== bytes(snapshot.entries) ||
      !entry || entry.type !== "compaction" || !entry.id ||
      typeof entry.summary !== "string" || !entry.summary.trim() ||
      typeof entry.firstKeptEntryId !== "string") throw conflict();
  const tail = branch.slice(snapshot.entries.length);
  // New projection edits, summaries, or unknown entry kinds cannot safely be
  // reconciled with an already-generated summary. Ordinary appended input stays.
  const allowed = new Set(["message", "custom_message", "custom", "usage", "model_change",
    "thinking_level_change", "label", "session_info"]);
  if (tail.some((item) => !allowed.has(item.type))) throw conflict();
  const retainNone = entry.firstKeptEntryId === entry.id;
  const kept = snapshot.entries.find((item) => item.id === entry.firstKeptEntryId);
  if (!retainNone && (!kept || (kept.type === "message" && kept.message.role === "toolResult")))
    throw conflict();
  const firstKeptEntryId = retainNone ? tail[0]?.id ?? null : entry.firstKeptEntryId;
  // Validate the retained range too: no standalone tool result may be retained
  // after its corresponding assistant call has disappeared into the summary.
  if (firstKeptEntryId) assertRetainedTools(branch, firstKeptEntryId);
  return {
    type: "compaction",
    summary: entry.summary,
    firstKeptEntryId,
    details: {
      ...(entry.details && typeof entry.details === "object" && !Array.isArray(entry.details)
        ? copy(entry.details) : { nativeDetails: entry.details }),
      axiomCompressionId: id,
    },
    ...(entry.usage ? { usage: copy(entry.usage) } : {}),
  };
}

// Caller must own the session's idle writer gate. No active worker may hold a
// separate SessionManager for this file. Returns false for an already-applied id.
export function applyCompression(
  manager: SessionManager, snapshot: CompressionSnapshot, entry: CompactionEntry, id: string,
): boolean {
  if (!snapshot?.header || manager.getHeader()?.id !== snapshot.header.id) throw conflict();
  if (hasCompression(manager, id)) {
    if (!compressionPersisted(manager, id)) throw conflict();
    return false;
  }
  const draft = compressionDraft(manager, snapshot, entry, id);
  const before = manager.buildSessionProjection().messages.reduce((n, message) => n + estimateTokens(message), 0);
  manager.appendCompaction(draft.summary, draft.firstKeptEntryId, before, draft.details, true, draft.usage);
  if (!compressionPersisted(manager, id)) throw conflict();
  return true;
}
