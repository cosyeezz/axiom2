import assert from "node:assert/strict";
import { test } from "node:test";
import { canTransformCode, codeLanguage, compactSql, sqlDialect, transformCode } from "../src/client/chat/code-transform.js";

test("language labels and SQL dialect aliases", () => {
  assert.equal(codeLanguage(" SQL title=example"), "sql");
  assert.equal(sqlDialect("Postgres"), "postgresql");
  assert.equal(sqlDialect("hive"), "hive");
  assert.ok(canTransformCode("JSON"));
  assert.equal(canTransformCode("javascript"), false);
  assert.equal(canTransformCode("constructor"), false);
});
test("JSON formatting preserves numeric lexemes, duplicate keys and escaped strings", async () => {
  const source = '{"id":9007199254740993123,"n":1e+99,"n":-0,"text":"a  b\\n\\\"c","nested":[{},[],true,null]}';
  const formatted = await transformCode(source, "json", "format");
  assert.match(formatted, /\n  "id": 9007199254740993123,/);
  assert.match(formatted, /"n": 1e\+99/);
  assert.match(formatted, /"n": -0/);
  assert.equal(await transformCode(formatted, "json", "compact"), source);
  assert.deepEqual(JSON.parse(formatted), JSON.parse(source));
});
test("JSON handles root primitives and empty containers", async () => {
  for (const source of ['{}', '[]', 'null', 'true', '42', '"hello  world"']) {
    assert.equal(await transformCode(` \n${source}\t`, "json", "format"), source);
    assert.equal(await transformCode(` \n${source}\t`, "json", "compact"), source);
  }
});
test("invalid JSON and oversized input reject without returning altered content", async () => {
  for (const source of ['{"a":', '{"a":1,}', '[NaN]', '']) {
    await assert.rejects(transformCode(source, "json", "format"));
    await assert.rejects(transformCode(source, "json", "compact"));
  }
  await assert.rejects(transformCode(" ".repeat(200_001), "sql", "format"));
});
test("SQL formatting uses the specified dialect and preserves quoted content", async () => {
  const sql = "select id, 'hello  world' as label from users where active = 1 order by id;";
  const formatted = await transformCode(sql, "sql", "format");
  assert.match(formatted, /select\n/i);
  assert.match(formatted, /'hello  world'/);
  assert.match(await transformCode("select `id` from `users` limit 10", "mysql", "format"), /`users`/);
  assert.match(await transformCode("select data::jsonb from users", "postgres", "format"), /data::jsonb/);
});
test("SQL compression keeps line comments separated from following code", () => {
  assert.equal(compactSql("select  1 -- keep this\n  from   users;\nselect 2"), "select 1 -- keep this\nfrom users; select 2");
  assert.equal(compactSql("select 1 # comment\r\n from t"), "select 1 # comment\r\nfrom t");
});
test("SQL compression preserves quoted whitespace, escapes, hints and dollar strings", () => {
  const protectedValues = ["'a  b'", "'it''s  fine'", '"a  b"', '`a  b`', '[a  b]', '$$a \n b$$', '$tag$a  b$tag$', '/*+  hint  */', '/* a /* b */ c */'];
  for (const value of protectedValues) assert.equal(compactSql(`select   ${value}  from   t`), `select ${value} from t`);
  assert.equal(compactSql(" select  - -1, a / * b, x < > y ; "), "select - -1, a / * b, x < > y ;");
});
test("SQL transforms preserve semantic newlines between adjacent string literals", async () => {
  const source = "SELECT 'a'\n'b', 'c'\n'd';";
  for (const mode of ["format", "compact"] as const) {
    const result = await transformCode(source, "postgresql", mode);
    assert.match(result, /'a'\n'b'/);
    assert.match(result, /'c'\n'd'/);
  }
});
test("SQL compression respects dialect escape rules and Oracle alternative quotes", async () => {
  for (const language of ["sql", "sqlite", "postgresql"]) {
    assert.equal(await transformCode("SELECT   'a\\';", language, "compact"), "SELECT 'a\\';");
  }
  assert.equal(await transformCode("SELECT   'it\\'s  fine';", "mysql", "compact"), "SELECT 'it\\'s  fine';");
  assert.equal(await transformCode("SELECT   E'it\\'s  fine';", "postgresql", "compact"), "SELECT E'it\\'s  fine';");
  for (const quoted of ["q'[a'  b  'c]'", "q'{a'  b  'c}'", "q'!a'  b  'c!'"]) {
    const source = `SELECT   ${quoted} FROM  dual;`;
    assert.equal(await transformCode(source, "plsql", "compact"), `SELECT ${quoted} FROM dual;`);
    assert.ok((await transformCode(source, "plsql", "format")).includes(quoted));
  }
  const triple = `SELECT   '''a'  b  'c'''`;
  assert.equal(await transformCode(triple, "bigquery", "compact"), `SELECT '''a'  b  'c'''`);
});
test("deep JSON fails formatting without allocating an unbounded indented result", async () => {
  const source = "[".repeat(101) + "0" + "]".repeat(101);
  await assert.rejects(transformCode(source, "json", "format"), /嵌套过深/);
  assert.equal(await transformCode(source, "json", "compact"), source);
});
test("unterminated SQL literals and comments reject safely", () => {
  for (const source of ["select 'abc", "select /* x", "select $tag$x", "select [name"]) assert.throws(() => compactSql(source));
});
