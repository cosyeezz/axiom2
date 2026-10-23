/// <reference types="highlight.js" />
import { memo, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import sql from "highlight.js/lib/languages/sql.js";
import { canTransformCode, codeLanguage, sqlDialect, transformCode, type CodeTransform } from "./code-transform.js";
import { MermaidDiagram } from "./MermaidDiagram.js";
import "../styles/code-block.css";
for (const [name, grammar] of Object.entries({
  javascript,
  typescript,
  css,
  xml,
  json,
  python,
  bash,
  sql,
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
    const [converted, setConverted] = useState<{ source: string; language: string; text: string }>();
    const [busy, setBusy] = useState(false), [error, setError] = useState("");
    const [showSource, setShowSource] = useState(false);
    const revision = useRef(0);
    const displayed = converted?.source === text && converted.language === language ? converted.text : text;
    const isMermaid = codeLanguage(language) === "mermaid";
    const transformable = canTransformCode(language);
    const cache = useContext(DerivedContext);
    useEffect(() => {
      revision.current++;
      setConverted(undefined); setBusy(false); setError(""); setCopied("");
      return () => { revision.current++; };
    }, [text, language]);
    async function convert(mode: CodeTransform) {
      const request = ++revision.current;
      setBusy(true); setError(""); setCopied("");
      try {
        const value = await transformCode(displayed, language, mode);
        if (request === revision.current) setConverted({ source: text, language, text: value });
      } catch {
        if (request === revision.current) setError(`${mode === "format" ? "格式化" : "压缩"}失败，请检查语法${sqlDialect(language) ? "或代码块标注的 SQL 方言" : ""}；已保留当前内容。`);
      } finally { if (request === revision.current) setBusy(false); }
    }
    useEffect(() => {
      if (copied !== "已复制") return;
      const timer = setTimeout(() => setCopied(""), 1500);
      return () => clearTimeout(timer);
    }, [copied]);
    const highlighted = useMemo(() => {
      // ponytail: bounded named-language highlighting; huge/unknown blocks remain plain text.
      const lang = sqlDialect(language) ? "sql" : codeLanguage(language);
      if (displayed.length > 20000 || !hljs.getLanguage(lang)) return displayed;
      try {
        const parse = () => parseTokens(new DOMParser().parseFromString(
          hljs.highlight(displayed, { language: lang, ignoreIllegals: true }).value, "text/html").body);
        return nodes(cache ? cache.get(`highlight:10:tok:${lang}:${displayed}`, parse) : parse());
      } catch {
        return displayed;
      }
    }, [displayed, language, cache]);
    return (
      <div className="code-card">
        <div className="code-head">
          <span className="code-language">{language || "代码"}</span>
          <div className="code-actions">
          {isMermaid && <button type="button" className="code-action" aria-pressed={showSource} onClick={() => setShowSource(value => !value)}>{showSource ? "图表" : "源码"}</button>}
          {transformable && <>
            <button type="button" className="code-action" disabled={busy || displayed.length > 200_000} onClick={() => void convert("format")}>格式化</button>
            <button type="button" className="code-action" disabled={busy || displayed.length > 200_000} onClick={() => void convert("compact")}>压缩</button>
            {displayed !== text && <button type="button" className="code-action" onClick={() => {
              revision.current++; setConverted(undefined); setBusy(false); setError(""); setCopied("");
            }}>还原</button>}
          </>}
          <button
            type="button"
            className="icon-btn btn-ghost"
            aria-label={copied === "复制失败" ? "复制失败，点击重试" : "复制代码"}
            data-tooltip={copied || "复制代码"}
            onClick={async () => {
              setCopied("");
              try {
                await navigator.clipboard.writeText(displayed);
                setCopied("已复制");
              } catch {
                setCopied("复制失败");
              }
            }}
          >
            <Icon name={copied === "已复制" ? "check" : copied === "复制失败" ? "close" : "copy"} />
          </button>
          </div>
          <span className="screen-reader" role="status" aria-live="polite">{copied}</span>
        </div>
        {error && <div className="code-notice" role="status">{error}</div>}
        {isMermaid && !showSource ? <MermaidDiagram text={text} /> : <pre aria-busy={busy}>
          <code>{highlighted}</code>
        </pre>}
      </div>
    );
  },
);
