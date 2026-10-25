import { KiroThinkingError } from "./kiro-thinking.js";

type Part = { type: "text" | "thinking"; text: string };
const open = "<thinking>", close = "</thinking>", separators = ["\n\n", "\r\n\r\n"];
/** A conservative, bounded parser for the leading control block used by kiro.rs.
 * Only a response-start block (optionally preceded by whitespace) is interpreted;
 * quotations, fenced examples and tags in ordinary answer text remain literal.
 * Native reasoningContentEvent bypasses this parser entirely.
 */
export class KiroThinkingStream {
  private mode: "prefix" | "thinking" | "text" = "prefix";
  private pending = "";
  private skipFirstNewline = false;
  private priorThinkingChar = "";
  unclosed = false;
  push(text: string): Part[] { this.pending += text; return this.drain(false); }
  finish(): Part[] { return this.drain(true); }
  private drain(final: boolean): Part[] {
    const parts: Part[] = [];
    const emit = (type: Part["type"], text: string) => {
      if (text) {
        if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)) throw new KiroThinkingError("Kiro 思考兼容文本包含不完整的 Unicode 代理项。");
        parts.push({ type, text }); if (type === "thinking") this.priorThinkingChar = text.at(-1)!;
      }
    };
    if (this.mode === "prefix") {
      const trimmed = this.pending.trimStart();
      const whitespace = this.pending.length - trimmed.length;
      if (whitespace > 1024) this.mode = "text";
      else if (trimmed.startsWith(open)) {
        this.pending = trimmed.slice(open.length); this.mode = "thinking"; this.skipFirstNewline = true;
      } else if (!final && open.startsWith(trimmed)) return parts;
      else this.mode = "text";
    }
    if (this.mode === "thinking") {
      if (this.skipFirstNewline) {
        if (!final && (!this.pending || this.pending === "\r")) return parts;
        if (this.pending.startsWith("\r\n")) this.pending = this.pending.slice(2);
        else if (this.pending.startsWith("\n")) this.pending = this.pending.slice(1);
        this.skipFirstNewline = false;
      }
      let start = this.pending.indexOf(close);
      while (start !== -1) {
        if (/[`\'"]/.test(start ? this.pending[start - 1] : this.priorThinkingChar)) {
          start = this.pending.indexOf(close, start + close.length); continue;
        }
        const after = this.pending.slice(start + close.length);
        const separator = separators.find(value => after.startsWith(value));
        // A candidate plus arbitrary trailing whitespace cannot be retained
        // indefinitely while also promising lossless fallback. Bound that state
        // explicitly, identically for whole frames and all chunkings.
        if (!separator && after.length - after.trimStart().length > 1024)
          throw new KiroThinkingError("Kiro 思考闭标签后的待确认空白超过本地 1024 字符限制。");
        if (separator !== undefined || final && !after.trim()) {
          emit("thinking", this.pending.slice(0, start));
          this.pending = separator === undefined ? "" : after.slice(separator.length);
          this.mode = "text"; break;
        }
        // Wait for a split separator, without emitting a closing tag as thought.
        if (!final && (!after.trim() || separators.some(value => value.startsWith(after)))) {
          emit("thinking", this.pending.slice(0, start)); this.pending = this.pending.slice(start); return parts;
        }
        start = this.pending.indexOf(close, start + close.length);
      }
      if (this.mode === "thinking") {
        if (final) {
          emit("thinking", this.pending); this.pending = ""; this.mode = "text"; this.unclosed = true;
        } else {
          // Retain enough UTF-16 units for a fragmented tag/separator and never
          // split a surrogate pair in emitted deltas. Memory is constant per frame.
          let end = Math.max(0, this.pending.length - close.length - 4);
          if (end && /[\uD800-\uDBFF]/.test(this.pending[end - 1])) end--;
          emit("thinking", this.pending.slice(0, end)); this.pending = this.pending.slice(end);
        }
      }
    }
    if (this.mode === "text") {
      let end = this.pending.length;
      if (!final && end && /[\uD800-\uDBFF]/.test(this.pending[end - 1])) end--;
      emit("text", this.pending.slice(0, end)); this.pending = this.pending.slice(end);
    }
    return parts;
  }
}
