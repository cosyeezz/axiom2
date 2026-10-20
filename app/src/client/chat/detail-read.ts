import { command } from "../transport.js";
import type { Scope } from "../../shared/protocol.js";

type Entry = { promise: Promise<unknown>; controller: AbortController; users: number; ready: boolean; chars: number; expires: number };
const entries = new Map<string, Entry>();
function prune() {
  for (const [key, entry] of entries) if (entry.ready && entry.expires < Date.now()) entries.delete(key);
  let chars = [...entries.values()].reduce((sum, entry) => sum + entry.chars, 0);
  for (const [key, entry] of entries) {
    if (entries.size <= 24 && chars <= 2_000_000) break;
    if (!entry.users && entry.ready) { entries.delete(key); chars -= entry.chars; }
  }
}
/** Share read-only work. Closing one consumer never cancels another consumer's request. */
export function detailRead<T>(key: string, op: string, params: Record<string, unknown>, scope: Scope) {
  prune();
  let entry = entries.get(key);
  if (!entry) {
    const controller = new AbortController();
    entry = { controller, users: 0, ready: false, chars: 0, expires: 0, promise: Promise.resolve() };
    const saved = entry;
    entry.promise = command<T>(op, params, scope, crypto.randomUUID(), controller.signal).then((value) => {
      saved.ready = true; saved.expires = Date.now() + 30_000;
      saved.chars = JSON.stringify(value)?.length ?? 0;
      if ((saved.chars > 500_000 || controller.signal.aborted) && entries.get(key) === saved) entries.delete(key);
      prune();
      return value;
    }, (error) => { if (entries.get(key) === saved) entries.delete(key); throw error; });
    entries.set(key, entry);
  } else { entries.delete(key); entries.set(key, entry); }
  entry.users++;
  const saved = entry;
  let released = false;
  return { promise: saved.promise as Promise<T>, release() {
    if (released) return;
    released = true; saved.users--;
    if (!saved.users && !saved.ready) {
      if (entries.get(key) === saved) entries.delete(key);
      saved.controller.abort();
    }
    prune();
  } };
}
