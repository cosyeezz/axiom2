import type { Logger } from '@celljs/core';
import { type AgentInputItem } from '../../../cbc-shared/node/index.js';
/**
 * Backfill a stable `id` for history items that were persisted without one.
 *
 * Why this exists (issue #81634):
 *   ACP history replay (`AcpUtils.convertHistoryItemToAcp`) derives the client-facing
 *   `message_id` from `item.id`, falling back to `` `user-${item.timestamp || Date.now()}` ``
 *   / `` `assistant-${item.timestamp || Date.now()}` `` when the persisted item has no id.
 *   Most items get an id at write time (`DefaultInputItemProcessor.process`). A few custom
 *   item types (`topic` / `summary` / `ai-title`) used to be created without one — their
 *   write sites now backfill an id too, but any such item written *before* that fix still
 *   sits on disk without one today. Every time such a legacy item is replayed after a
 *   sandbox restart, the `Date.now()` branch mints a *different* id — breaking any client
 *   persistence keyed on message_id.
 *
 * Fix:
 *   At JSONL load time, deterministically derive a stable id from the item's own content
 *   (hash of its JSON-serialized bytes) instead of the wall-clock. Same bytes on disk ⇒
 *   same derived id on every load, regardless of process restarts. This is a **read-time,
 *   in-memory-only** fix: it does not rewrite the JSONL file, so it carries zero risk to
 *   the on-disk write path or concurrent writers.
 *
 * Properties:
 *   - Pure function; no I/O, no mutation of inputs (items without an id are shallow-cloned).
 *   - Idempotent: items that already have an id are returned unchanged.
 *   - Deterministic: the same item content always derives the same id.
 */
export declare function backfillHistoryItemIds(history: AgentInputItem[], logger?: Logger): AgentInputItem[];
/**
 * Deliberately does NOT fold in the item's array index: bounded (tail-window) reads can
 * load the same physical item at different array offsets depending on `maxItems` /
 * truncation, which would make an index-based id unstable across different read modes.
 * Hashing only the item's own bytes trades away disambiguation of byte-identical
 * duplicate items (e.g. renaming to the same topic twice back-to-back) for a hash that
 * is stable regardless of *how* the surrounding history was read — a strictly better
 * outcome than today's per-restart `Date.now()` id.
 *
 * Exported so `AcpUtils.convertHistoryItemToAcp` can use the same deterministic
 * derivation as its *last-resort* fallback (replacing the old `Date.now()` fallback),
 * for items that somehow still reach ACP conversion without an id.
 */
export declare function deriveStableIdFromContent(item: unknown): string;
//# sourceMappingURL=history-item-id-backfill.d.ts.map