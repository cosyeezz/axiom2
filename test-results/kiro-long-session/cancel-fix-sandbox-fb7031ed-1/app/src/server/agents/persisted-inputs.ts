import { openSync, closeSync, fstatSync, readSync } from "node:fs";

/** Acknowledges only complete records read from disk, never SessionManager's mutable index. */
export class PersistedInputCursor {
  private file = "";
  private identity = "";
  private offset = 0;
  private anchor = Buffer.alloc(0);

  read(file: string, onMessages?: (ids: string[]) => void): { ids: string[]; notifications: string[] } {
    let fd: number;
    try { fd = openSync(file, "r"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.file = ""; this.identity = ""; this.offset = 0; this.anchor = Buffer.alloc(0);
      return { ids: [], notifications: [] };
    }
    try {
      const stat = fstatSync(fd), identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
      const bytes = (position: number, length: number) => {
        const result = Buffer.alloc(length);
        let used = 0;
        while (used < length) {
          const count = readSync(fd, result, used, length - used, position + used);
          if (!count) throw Error("会话文件在读取期间发生变化；未确认输入。");
          used += count;
        }
        return result;
      };
      let start = file === this.file && identity === this.identity && stat.size >= this.offset ? this.offset : 0;
      // Native history rewrites may preserve the inode. Check a bounded prefix
      // before continuing instead of trusting an old byte offset into new JSON.
      if (start && !bytes(start - this.anchor.length, this.anchor.length).equals(this.anchor)) start = 0;
      let position = start, committed = start, tail = Buffer.alloc(0);
      const ids = new Set<string>(), notifications = new Set<string>(), messages = new Set<string>();
      while (position < stat.size) {
        const chunk = bytes(position, Math.min(65536, stat.size - position));
        position += chunk.length;
        const data = tail.length ? Buffer.concat([tail, chunk]) : chunk;
        let lineStart = 0;
        for (let end = data.indexOf(10); end !== -1; end = data.indexOf(10, lineStart)) {
          const line = data.subarray(lineStart, end).toString("utf8");
          if (line.trim()) {
            const entry = JSON.parse(line);
            if (entry.type === "message" && typeof entry.message?.axiomId === "string") messages.add(entry.message.axiomId);
            if (entry.type === "custom_message" && typeof entry.details?.axiomInput === "string") messages.add(`input-${entry.details.axiomInput}`);
            if (entry.type === "custom_message" && typeof entry.details?.axiomInput === "string") {
              ids.add(entry.details.axiomInput);
              if (entry.customType === "axiom-result") notifications.add(entry.details.axiomInput);
            }
            if (entry.type === "message" && Array.isArray(entry.message?.axiomInputIds))
              for (const id of entry.message.axiomInputIds) if (typeof id === "string") ids.add(id);
          }
          lineStart = end + 1;
        }
        tail = data.subarray(lineStart);
        committed = position - tail.length;
      }
      const anchor = bytes(Math.max(0, committed - 64), Math.min(64, committed));
      // Commit the cursor only after every read/parse succeeds. Failed reads can retry.
      // A failed acknowledgement must leave the whole batch available for retry.
      onMessages?.([...messages]);
      this.file = file; this.identity = identity; this.offset = committed; this.anchor = anchor;
      return { ids: [...ids], notifications: [...notifications] };
    } finally { closeSync(fd); }
  }
}
