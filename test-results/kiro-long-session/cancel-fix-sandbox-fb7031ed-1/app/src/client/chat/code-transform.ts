import type { SqlLanguage } from "sql-formatter";

const dialects: Record<string, SqlLanguage> = {
  sql: "sql", mysql: "mysql", mariadb: "mariadb", postgresql: "postgresql", postgres: "postgresql",
  pgsql: "postgresql", sqlite: "sqlite", tsql: "transactsql", transactsql: "transactsql", plsql: "plsql",
  hive: "hive", sparksql: "spark", spark: "spark", bigquery: "bigquery", snowflake: "snowflake",
  redshift: "redshift", trino: "trino", duckdb: "duckdb", clickhouse: "clickhouse",
};
export function codeLanguage(language: string) { return language.trim().split(/\s+/)[0]?.toLowerCase() || ""; }
export function sqlDialect(language: string): SqlLanguage | undefined {
  const name = codeLanguage(language);
  return Object.hasOwn(dialects, name) ? dialects[name] : undefined;
}
export function canTransformCode(language: string) { return codeLanguage(language) === "json" || !!sqlDialect(language); }
export type CodeTransform = "format" | "compact";

// Validate without reserializing: preserve large numbers, duplicate keys and string escapes.
function transformJson(source: string, mode: CodeTransform): string {
  JSON.parse(source);
  const tokens = source.match(/"(?:[^"\\]|\\.)*"|[^\s{}[\],:]+|[{}[\],:]/g)!;
  if (mode === "compact") return tokens.join("");
  let depth = 0, result = "";
  const newline = () => { result += `\n${"  ".repeat(depth)}`; };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "{" || token === "[") {
      result += token; depth++;
      if (depth > 100) throw Error("JSON 嵌套过深，请在编辑器中处理");
      if (tokens[i + 1] !== "}" && tokens[i + 1] !== "]") newline();
    } else if (token === "}" || token === "]") {
      depth--;
      if (tokens[i - 1] !== "{" && tokens[i - 1] !== "[") newline();
      result += token;
    } else if (token === ",") { result += token; newline(); }
    else result += token === ":" ? ": " : token;
    if (result.length > 2_000_000) throw Error("格式化结果过长，请在编辑器中处理");
  }
  return result;
}

type SqlPart = { text: string; kind: "space" | "literal" | "other" };
function sqlParts(source: string, dialect: SqlLanguage): SqlPart[] {
  const parts: SqlPart[] = [];
  const backslash = ["mysql", "mariadb", "hive", "spark", "bigquery", "redshift", "snowflake", "clickhouse"].includes(dialect);
  const hashComments = ["sql", "mysql", "mariadb", "hive", "bigquery"].includes(dialect);
  let i = 0;
  while (i < source.length) {
    const start = i, char = source[i];
    let kind: SqlPart["kind"] = "other";
    if (/\s/.test(char)) {
      while (i < source.length && /\s/.test(source[i])) i++;
      kind = "space";
    } else if (source.startsWith("--", i) || (hashComments && char === "#")) {
      while (i < source.length && source[i] !== "\n" && source[i] !== "\r") i++;
      // Keep the terminator attached to the comment so it cannot eat subsequent SQL.
      if (i < source.length && source[i++] === "\r" && source[i] === "\n") i++;
    } else if (source.startsWith("/*", i)) {
      i += 2;
      let depth = 1;
      while (i < source.length && depth) {
        if (source.startsWith("/*", i)) { depth++; i += 2; }
        else if (source.startsWith("*/", i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) throw Error("SQL 注释未结束");
    } else if ((char === "q" || char === "Q") && source[i + 1] === "'" && !/[\w$]/.test(source[i - 1] ?? "")) {
      const delimiter = source[i + 2];
      const close = ({ "[": "]", "{": "}", "(": ")", "<": ">" } as Record<string, string>)[delimiter] ?? delimiter;
      const end = close && source.indexOf(`${close}'`, i + 3);
      if (typeof end !== "number" || end < 0) throw Error("SQL 字符串未结束");
      i = end + 2; kind = "literal";
    } else if (dialect === "bigquery" && (source.startsWith("'''", i) || source.startsWith('\"\"\"', i))) {
      const delimiter = source.slice(i, i + 3);
      i += 3;
      while (i < source.length && !source.startsWith(delimiter, i)) i += source[i] === "\\" ? 2 : 1;
      if (i >= source.length) throw Error("SQL 字符串未结束");
      i += 3; kind = "literal";
    } else if (char === "'" || char === '"' || char === "`" || char === "[") {
      const end = char === "[" ? "]" : char;
      const escaped = backslash || (dialect === "postgresql" && /[eE]/.test(source[i - 1] ?? "") && !/[\w$]/.test(source[i - 2] ?? ""));
      let closed = false;
      i++;
      while (i < source.length) {
        if (escaped && source[i] === "\\" && char !== "[") { i += 2; continue; }
        if (source[i++] === end) {
          if (source[i] === end) { i++; continue; }
          closed = true; break;
        }
      }
      if (!closed) throw Error("SQL 字符串或标识符未结束");
      kind = "literal";
    } else {
      const dollar = char === "$" && source.slice(i).match(/^\$(?:[A-Za-z_][\w]*)?\$/)?.[0];
      if (dollar) {
        const end = source.indexOf(dollar, i + dollar.length);
        if (end < 0) throw Error("SQL 字符串未结束");
        i = end + dollar.length; kind = "literal";
      } else i++;
    }
    parts.push({ text: source.slice(start, i), kind });
  }
  return parts;
}
function joinsLiterals(parts: SqlPart[], index: number) {
  return parts[index].kind === "space" && /[\r\n]/.test(parts[index].text) && parts[index - 1]?.kind === "literal" && parts[index + 1]?.kind === "literal";
}
// Only collapse whitespace outside literals and comments. Newlines between
// adjacent literals carry meaning in PostgreSQL and standard SQL.
export function compactSql(source: string, dialect: SqlLanguage = "sql"): string {
  const parts = sqlParts(source, dialect);
  return parts.map((part, index) => part.kind !== "space" ? part.text : joinsLiterals(parts, index) ? "\n" : /[\r\n]$/.test(parts[index - 1]?.text ?? "") ? "" : " ").join("").trim();
}
function preserveSqlLiterals(source: string, formatted: string, dialect: SqlLanguage) {
  const before = sqlParts(source, dialect), after = sqlParts(formatted, dialect);
  const literals = (parts: SqlPart[]) => parts.filter(part => part.kind === "literal").map(part => part.text);
  if (JSON.stringify(literals(before)) !== JSON.stringify(literals(after))) throw Error("格式化可能改变字符串内容");
  const joins = new Set<number>();
  let ordinal = 0;
  before.forEach((part, index) => {
    if (part.kind === "literal") ordinal++;
    if (joinsLiterals(before, index)) joins.add(ordinal);
  });
  ordinal = 0;
  after.forEach((part, index) => {
    if (part.kind === "literal") ordinal++;
    if (part.kind === "space" && joins.has(ordinal) && after[index - 1]?.kind === "literal" && after[index + 1]?.kind === "literal") part.text = "\n";
  });
  return after.map(part => part.text).join("");
}

export async function transformCode(source: string, language: string, mode: CodeTransform): Promise<string> {
  if (source.length > 200_000) throw Error("代码过长，请在编辑器中处理");
  if (codeLanguage(language) === "json") return transformJson(source, mode);
  const dialect = sqlDialect(language);
  if (!dialect) throw Error("此语言暂不支持转换");
  if (mode === "compact") return compactSql(source, dialect);
  const { format } = await import("sql-formatter");
  return preserveSqlLiterals(source, format(source, { language: dialect, tabWidth: 2 }), dialect);
}
