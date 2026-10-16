import { memo, type ReactNode } from "react";
import type { Token } from "marked";
import { FileLink } from "./FileLink.js";
import { localFileLink } from "../../shared/file-preview.js";
import { CodeBlock } from "./CodeBlock.js";
import { markdown, markdownImagePath } from "../../shared/markdown.js";
import { MarkdownImage, type MarkdownImageOwner } from "./MarkdownImage.js";
// Render token AST as React nodes, never untrusted HTML. Raw HTML stays literal.
type BlockRenderer = (children: ReactNode, index: number, source: string) => ReactNode;
function tokens(items: Token[], images?: MarkdownImageOwner, renderBlock?: BlockRenderer, compact = false): ReactNode {
  return items.map((t: any, i) => {
    const render = () => {
    const inner = () => (t.tokens ? tokens(t.tokens, images, undefined, compact) : t.text);
    // The activity summary is a single-line disclosure control: no nested links,
    // copy buttons, checkboxes, or block layout inside its Markdown preview.
    if (compact) {
      if (["heading", "paragraph", "blockquote"].includes(t.type)) return <span key={i}>{inner()}{" "}</span>;
      if (t.type === "code") return <code key={i}>{t.text}{" "}</code>;
      if (t.type === "link") return <span key={i}>{inner()}</span>;
      if (t.type === "br" || t.type === "hr") return <span key={i}> </span>;
      if (t.type === "list") return <span key={i}>{t.items.map((item: any, n: number) => <span key={n}>{item.task ? (item.checked ? "☑ " : "☐ ") : t.ordered ? `${(t.start || 1) + n}. ` : "• "}{tokens(item.tokens, images, undefined, true)}{" "}</span>)}</span>;
      if (t.type === "table") return <span key={i}>{[t.header, ...t.rows].map((row: any[], n: number) => <span key={n}>{row.map((cell: any, j: number) => <span key={j}>{tokens(cell.tokens, images, undefined, true)}{" "}</span>)}</span>)}</span>;
    }
    switch (t.type) {
      case "space":
        return null;
      case "heading": {
        const Tag = `h${Math.min(6, t.depth)}` as "h1";
        return <Tag key={i}>{inner()}</Tag>;
      }
      case "paragraph":
        return <p key={i}>{inner()}</p>;
      case "strong":
        return <strong key={i}>{inner()}</strong>;
      case "em":
        return <em key={i}>{inner()}</em>;
      case "del":
        return <del key={i}>{inner()}</del>;
      case "codespan":
        return <code key={i}>{t.text}</code>;
      case "code":
        return <CodeBlock key={i} text={t.text} language={t.lang || ""} />;
      case "blockquote":
        return <blockquote key={i}>{inner()}</blockquote>;
      case "list": {
        const Tag = t.ordered ? "ol" : "ul";
        return (
          <Tag key={i}>
            {t.items.map((item: any, n: number) => (
              <li key={n}>
                {item.task && (
                  <input
                    type="checkbox"
                    checked={item.checked}
                    readOnly
                    aria-label="任务状态"
                  />
                )}
                {tokens(item.tokens, images)}
              </li>
            ))}
          </Tag>
        );
      }
      case "link": {
        // A linked picture opens our preview; do not nest a button inside a link.
        let linkedImage = false;
        if (images && t.tokens) markdown.walkTokens(t.tokens, (token) => {
          if (token.type === "image") linkedImage = true;
        });
        if (linkedImage) return <span key={i}>{inner()}</span>;
        if (localFileLink(t.href)) return images ? <FileLink key={i} href={t.href} owner={images}>{inner()}</FileLink> : <span key={i}>{inner()}</span>;
        let safe = false;
        try {
          safe = /^(?:https?:\/\/|mailto:)/i.test(t.href) && ["http:", "https:", "mailto:"].includes(
            new URL(t.href).protocol,
          );
        } catch {}
        return safe ? (
          <a key={i} href={t.href} target="_blank" rel="noopener noreferrer">
            {inner()}
          </a>
        ) : (
          <span key={i}>{inner()}</span>
        );
      }
      case "image":
        return images && markdownImagePath(t.href) ?
          <MarkdownImage key={`${i}:${images.scope.workspaceId}:${images.scope.sessionId}:${images.messageId}:${t.href}`} href={t.href} alt={t.text} owner={images} /> :
          <span key={i}>[图片：{t.text}{images ? " · 仅支持本地绝对路径" : ""}]</span>;
      case "br":
        return <br key={i} />;
      case "hr":
        return <hr key={i} />;
      case "table":
        return (
          <div className="table-scroll" key={i}>
            <table>
              <thead>
                <tr>
                  {t.header.map((cell: any, j: number) => (
                    <th key={j}>{tokens(cell.tokens, images)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((row: any[], j: number) => (
                  <tr key={j}>
                    {row.map((cell: any, k: number) => (
                      <td key={k}>{tokens(cell.tokens, images)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      default:
        return <span key={i}>{t.tokens ? inner() : (t.text ?? t.raw)}</span>;
    }
    };
    const node = render();
    return renderBlock && node && t.type !== "hr" ? renderBlock(node, i, t.raw) : node;
  });
}
export const Markdown = memo(({ text, images, renderBlock, compact = false }: { text: string; images?: MarkdownImageOwner; renderBlock?: BlockRenderer; compact?: boolean }) => (
  <>{tokens(markdown.lexer(text), images, renderBlock, compact)}</>
));
