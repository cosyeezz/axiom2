import type { Token } from "marked";
import { decodeHTML } from "entities";
import { markdownTokens } from "./markdown.js";

export interface MarkdownBlockRange { start: number; end: number }
export interface MarkdownSection {
  title: string;
  text: string;
  startLine: number;
  endLine: number;
  blocks: MarkdownBlockRange;
}
function headingText(tokens: Token[]): string {
  return tokens.map(token => {
    if ("tokens" in token && token.tokens) return headingText(token.tokens);
    if (token.type === "html") return "";
    if (!("text" in token)) return "";
    // Entities in prose/alt text are visible characters; code spans stay literal.
    return token.type === "text" || token.type === "image" ? decodeHTML(String(token.text)) : String(token.text);
  }).join("");
}
/** GitHub-style heading IDs: preserve Unicode letters, remove punctuation, deduplicate in document order. */
function headingSlug(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- \t]/gu, "").replace(/[ \t]/g, "-");
}
/** Top-level headings only: fenced code and headings inside lists/quotes are not document sections. */
export function markdownSection(source: string, fragment: string): MarkdownSection | null {
  const text = source.replace(/\r\n?/g, "\n"), ast = markdownTokens(text), used = new Set<string>();
  const headings: { title: string; slug: string; depth: number; block: number; offset: number }[] = [];
  let cursor = 0;
  ast.forEach((token, block) => {
    const at = text.indexOf(token.raw, cursor);
    if (at < 0) return;
    cursor = at + token.raw.length;
    if (token.type !== "heading") return;
    const title = headingText(token.tokens ?? []), base = headingSlug(title);
    let slug = base, n = 0;
    while (used.has(slug)) slug = `${base}-${++n}`;
    used.add(slug);
    headings.push({ title, slug, depth: token.depth, block, offset: at });
  });
  const heading = headings.find(item => item.slug === fragment);
  if (!heading) return null;
  const next = headings.find(item => item.block > heading.block && item.depth <= heading.depth);
  const section = text.slice(heading.offset, next?.offset ?? text.length).replace(/\n+$/, "");
  const startLine = text.slice(0, heading.offset).split("\n").length;
  return { title: heading.title, text: section, startLine, endLine: startLine + section.split("\n").length - 1,
    blocks: { start: heading.block, end: next?.block ?? ast.length } };
}
