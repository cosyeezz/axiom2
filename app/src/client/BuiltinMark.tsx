import { Icon } from "./Icon.js";
import "./styles/builtin-mark.css";

const integration = { rea: "REA", opencli: "OpenCLI" } as const;

/** Built-in integrations (REA, OpenCLI) ship skills and MCP servers inside their
 * package. The mark replaces a trailing "内置" tag; the source and fallback state
 * stay available to pointer and assistive users. */
export function BuiltinMark({ kind, fallback = false, className = "" }: {
  kind: keyof typeof integration; fallback?: boolean; className?: string;
}) {
  const name = integration[kind];
  const label = fallback ? `内置 ${name} 未加载，当前使用通用同名来源` : `随 ${name} 安装包内置提供`;
  return <span className={`builtin-mark${fallback ? " is-fallback" : ""}${className ? ` ${className}` : ""}`.trim()}
    role="img" aria-label={label} data-tooltip={label}><Icon name="builtin" /></span>;
}
