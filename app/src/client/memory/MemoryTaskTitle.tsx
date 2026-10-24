import type { Token } from "marked";
import type { MouseEvent } from "react";
import { markdownTokens } from "../../shared/markdown.js";
import { Markdown } from "../chat/Markdown.js";

export function memoryTitleLabel(text: string): string {
  const label = (tokens: Token[]): string => tokens.map(token => {
    if ("tokens" in token && token.tokens) return label(token.tokens);
    if (token.type === "space" || token.type === "br") return " ";
    return "text" in token ? token.text : token.raw;
  }).join("");
  return label(markdownTokens(text)).trim();
}
/** Only a verified file path makes the title interactive. */
export function MemoryTaskTitle({ text, path, onOpen }: { text: string; path?: string; onOpen?: (path: string, event: MouseEvent<HTMLButtonElement>) => void }) {
  return path && onOpen ? <button type="button" className="memory-task-title memory-title-open" onClick={event => onOpen(path, event)}><Markdown text={text} compact /></button> : <Markdown text={text} compact />;
}
