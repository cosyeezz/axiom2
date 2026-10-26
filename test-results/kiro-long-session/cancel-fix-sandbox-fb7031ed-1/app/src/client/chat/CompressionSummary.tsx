import { memo } from "react";
import { Lexer } from "marked";
import { Markdown } from "./Markdown.js";
import "../styles/compression-summary.css";

/** Remove standalone metadata, including pi split-turn sections, but preserve code examples. */
export const CompressionSummary = memo(function CompressionSummary({ text }: { text: string }) {
  const body = Lexer.lex(text).map((token) => token.type !== "code"
    ? token.raw.replace(/^ {0,3}<axiom-summary>[^\r\n]*?<\/axiom-summary>[ \t]*(?:\r?\n|$)/gm, "")
    : token.raw).join("");
  return <div className="markdown compression-summary"><Markdown text={body} /></div>;
});
