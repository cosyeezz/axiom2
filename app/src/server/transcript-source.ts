import fs, { type BigIntStats } from "node:fs";
import { createHash } from "node:crypto";
import { constants } from "node:buffer";
import { resolve } from "node:path";
import { SessionManager, parseSessionEntries } from "@earendil-works/pi-coding-agent";
import { AppError } from "../shared/protocol.js";

const stamp = (value: BigIntStats) => [value.dev, value.ino, value.birthtimeNs, value.size, value.mtimeNs, value.ctimeNs].join(":");
class SourceChanged extends Error {}
export interface TranscriptSource {
  readonly manager: SessionManager;
  /** Identity of the bytes initially hydrated into manager, not future mutations. */
  readonly source: Readonly<{ file: string; stamp: string; digest: string }>;
}

/** Read-only byte snapshot, including its ownership header, from one descriptor.
 * Detects ordinary concurrent append/rewrite/replacement and retries at most twice.
 * Stat checks are change detectors, NOT a claim of atomic reads against arbitrary
 * uncooperative writers. The digest names the observed bytes, not wall-clock now.
 * No SDK.open/setSessionFile: even in-memory use of those APIs repairs JSONL tails.
 */
export function readTranscriptSource(file: string, cwd: string): TranscriptSource {
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const fd = fs.openSync(file, "r");
      try {
        const before = fs.fstatSync(fd, { bigint: true });
        if (!before.isFile() || before.size > BigInt(constants.MAX_LENGTH)) throw Error("Invalid transcript source");
        const bytes = Buffer.allocUnsafe(Number(before.size));
        let offset = 0;
        while (offset < bytes.length) {
          const read = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
          if (!read) throw new SourceChanged();
          offset += read;
        }
        const after = fs.fstatSync(fd, { bigint: true });
        if (stamp(before) !== stamp(after) || stamp(after) !== stamp(fs.statSync(file, { bigint: true })))
          throw new SourceChanged();
        const newline = bytes.indexOf(10);
        if (newline < 0 || newline >= 64 * 1024) throw Error("Invalid transcript header");
        const header = JSON.parse(bytes.subarray(0, newline).toString("utf8"));
        if (header?.type !== "session" || typeof header.id !== "string" || typeof header.cwd !== "string") throw Error("Invalid transcript owner");
        if (resolve(header.cwd) !== resolve(cwd) && fs.realpathSync.native(header.cwd) !== fs.realpathSync.native(cwd))
          throw Error("Transcript workspace mismatch");
        const manager = SessionManager.inMemory(cwd, undefined, parseSessionEntries(bytes.toString("utf8")));
        if (manager.getSessionId() !== header.id) throw Error("Transcript header was not hydrated");
        return Object.freeze({ manager, source: Object.freeze({ file: resolve(file), stamp: stamp(after),
          digest: createHash("sha256").update(bytes).digest("hex") }) });
      } catch (error) {
        if (!(error instanceof SourceChanged) || attempt === 2) throw error;
      } finally { fs.closeSync(fd); }
    }
    throw new SourceChanged();
  } catch {
    throw new AppError("SESSION_FILE_ERROR", "会话文件缺失、变化、损坏或工作目录不符；原记录保留，未创建空会话替代。");
  }
}
