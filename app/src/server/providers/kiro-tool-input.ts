import { KiroChatError } from "./kiro-chat-protocol.js";

const LIMIT = 1024 * 1024;
const high = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const low = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

/** Bounded UTF-8 accounting without rescanning the accumulated JSON on every delta. */
export class KiroToolInput {
  private chunks: string[] = [];
  private bytes = 0;
  private units = 0;
  private tailHigh = false;
  private nextPreview = 4096;
  private lastPreview = -Infinity;
  private completed = false;

  get byteLength() { return this.bytes; }

  append(fragment: string) {
    if (this.completed) throw new KiroChatError("Kiro 工具参数已结束，不能继续追加。");
    if (!fragment.length) return;
    // Node encodes each isolated surrogate as 3 bytes, but a pair as 4. A pair
    // spanning two provider deltas therefore needs a two-byte boundary correction.
    const bytes = Buffer.byteLength(fragment, "utf8") - (this.tailHigh && low(fragment.charCodeAt(0)) ? 2 : 0);
    if (this.bytes + bytes > LIMIT) throw new KiroChatError("Kiro 工具参数超过本地 1 MiB 限制。");
    this.bytes += bytes;
    this.units += fragment.length;
    this.tailHigh = high(fragment.charCodeAt(fragment.length - 1));
    this.chunks.push(fragment);
  }

  /** Previews can lag. Geometric growth bounds total preview input to less than 2N. */
  preview(now = performance.now()): string | undefined {
    if (this.completed || this.units < this.nextPreview || now - this.lastPreview < 50) return;
    this.nextPreview = 2 * this.units;
    this.lastPreview = now;
    return this.chunks.join("");
  }

  complete(): string {
    if (this.completed) throw new KiroChatError("Kiro 工具参数重复结束。");
    this.completed = true;
    const input = this.chunks.join("");
    this.chunks = [];
    return input;
  }
}
