/// <reference types="highlight.js" />
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
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
function nodes(parent: Node): ReactNode {
  return Array.from(parent.childNodes, (node, i) =>
    node.nodeType === Node.TEXT_NODE ? (
      node.textContent
    ) : node instanceof HTMLElement && node.tagName === "SPAN" ? (
      <span
        key={i}
        className={node.className
          .split(/\s+/)
          .filter((c) => /^tok-[a-z-]+$/.test(c))
          .join(" ")}
      >
        {nodes(node)}
      </span>
    ) : (
      node.textContent
    ),
  );
}
export const CodeBlock = memo(
  ({ text, language }: { text: string; language: string }) => {
    const [copied, setCopied] = useState("");
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
        return nodes(
          new DOMParser().parseFromString(
            hljs.highlight(text, { language: lang, ignoreIllegals: true })
              .value,
            "text/html",
          ).body,
        );
      } catch {
        return text;
      }
    }, [text, language]);
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
            {copied === "已复制" ? (
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
            ) : <svg aria-hidden="true"><use href={`#i-${copied === "复制失败" ? "close" : "copy"}`} /></svg>}
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
