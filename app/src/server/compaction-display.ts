import { memoryCompressionPrompt } from "../shared/memory-prompts.js";
import { Lexer } from "marked";
import { buildSessionProjection, estimateTokens, type SessionEntry, type CompactionEntry } from "@earendil-works/pi-coding-agent";
export const compactionInstructions = "保留原生完整交接摘要结构和所有必要上下文。在摘要最前面额外输出一行 <axiom-summary>不超过100个字的中文压缩短摘要</axiom-summary>，只概括本次被压缩内容；不得用这个短摘要替代完整摘要。" + "\n\n" + memoryCompressionPrompt;
/** Short summary for the compression card; independent of the session title. */
export function compactionShortSummary(summary: string) {
  // Metadata must be a standalone line, never a quoted/code example.
  // Pi can prepend an older history summary; the last valid topic belongs to the current segment.
  const titles = Lexer.lex(summary).filter((token) => token.type === "html" || token.type === "paragraph")
    .flatMap((token) => [...token.raw.matchAll(/^ {0,3}<axiom-summary>([^\r\n]*?)<\/axiom-summary>[ \t]*\r?$/gm)])
    .map((match) => match[1].trim()).filter((title) => /[\p{L}\p{N}]/u.test(title));
  const title = titles.at(-1);
  return title ? Array.from(title).slice(0, 100).join("") : "上下文已压缩";
}
export function compactionDisplay(entry: CompactionEntry, branch: SessionEntry[]) {
  const at = branch.findIndex((item) => item.id === entry.id);
  return {
    number: branch.slice(0, at + 1).filter((item) => item.type === "compaction").length,
    title: compactionShortSummary(entry.summary), before: entry.tokensBefore,
    after: at < 0 ? null : buildSessionProjection(branch.slice(0, at + 1)).messages.reduce((n, m) => n + estimateTokens(m), 0),
  };
}
