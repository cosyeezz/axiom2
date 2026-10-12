import { memo, type ReactNode } from "react";
import { marked, type Token } from "marked";
import { CodeBlock } from "./CodeBlock.js";
// Render token AST as React nodes, never untrusted HTML. Raw HTML stays literal.
function tokens(items: Token[]): ReactNode {
  return items.map((t: any, i) => {
    const inner = () => (t.tokens ? tokens(t.tokens) : t.text);
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
                {tokens(item.tokens)}
              </li>
            ))}
          </Tag>
        );
      }
      case "link": {
        let safe = false;
        try {
          safe = ["http:", "https:", "mailto:"].includes(
            new URL(t.href, location.href).protocol,
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
        return <span key={i}>[图片：{t.text}]</span>;
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
                    <th key={j}>{tokens(cell.tokens)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((row: any[], j: number) => (
                  <tr key={j}>
                    {row.map((cell: any, k: number) => (
                      <td key={k}>{tokens(cell.tokens)}</td>
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
  });
}
export const Markdown = memo(({ text }: { text: string }) => (
  <>{tokens(marked.lexer(text))}</>
));
