/// <reference types="highlight.js" />
import { memo, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "../Icon.js";
import { DerivedContext } from "./derived-cache.js";
import hljs from "highlight.js/lib/core.js";
import javascript from "highlight.js/lib/languages/javascript.js";
import typescript from "highlight.js/lib/languages/typescript.js";
import css from "highlight.js/lib/languages/css.js";
import xml from "highlight.js/lib/languages/xml.js";
import json from "highlight.js/lib/languages/json.js";
import python from "highlight.js/lib/languages/python.js";
import bash from "highlight.js/lib/languages/bash.js";
for (const [name, grammar] of Object.entries({
  javascript,
  typescript,
  css,
  xml,
  json,
  python,
  bash,
}))
  hljs.registerLanguage(name, grammar);
hljs.configure({ classPrefix: "tok-" });
type HighlightToken = string | { classes: string; children: HighlightToken[] };
function parseTokens(parent: Node): HighlightToken[] {
  return Array.from(parent.childNodes, (node) => node instanceof HTMLElement && node.tagName === "SPAN"
    ? { classes: node.className.split(/\s+/).filter((c) => /^tok-[a-z-]+$/.test(c)).join(" "), children: parseTokens(node) }
    : node.textContent ?? "");
}
function nodes(tokens: HighlightToken[]): ReactNode {
  return tokens.map((token, index) => typeof token === "string" ? token : <span key={index} className={token.classes}>{nodes(token.children)}</span>);
}
export const CodeBlock = memo(
  ({ text, language }: { text: string; language: string }) => {
    const [copied, setCopied] = useState("");
    const cache = useContext(DerivedContext);
    useEffect(() => {
      if (copied !== "已复制") return;
      const timer = setTimeout(() => setCopied(""), 1500);
      return () => clearTimeout(timer);
    }, [copied]);
    const highlighted = useMemo(() => {
      // ponytail: bounded named-language highlighting; huge/unknown blocks remain plain text.
      const lang = language.split(/\s+/)[0]?.toLowerCase();
      if (text.length > 20000 || !hljs.getLanguage(lang)) return text;
      try {
        const parse = () => parseTokens(new DOMParser().parseFromString(
          hljs.highlight(text, { language: lang, ignoreIllegals: true }).value, "text/html").body);
        return nodes(cache ? cache.get(`highlight:10:tok:${lang}:${text}`, parse) : parse());
      } catch {
        return text;
      }
    }, [text, language, cache]);
    return (
      <div className="code-card">
        <div className="code-head">
          <span>{language || "代码"}</span>
          <button
            type="button"
            className="icon-btn btn-ghost"
            aria-label={copied === "复制失败" ? "复制失败，点击重试" : "复制代码"}
            data-tooltip={copied || "复制代码"}
            onClick={async () => {
              setCopied("");
              try {
                await navigator.clipboard.writeText(text);
                setCopied("已复制");
              } catch {
                setCopied("复制失败");
              }
            }}
          >
            <Icon name={copied === "已复制" ? "check" : copied === "复制失败" ? "close" : "copy"} />
          </button>
          <span className="screen-reader" role="status" aria-live="polite">{copied}</span>
        </div>
        <pre>
          <code>{highlighted}</code>
        </pre>
      </div>
    );
  },
);
