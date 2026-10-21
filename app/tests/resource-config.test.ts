import test from "node:test";
import assert from "node:assert/strict";
import { configProjection, restoreConfig } from "../src/server/resource-config.js";

test("opaque CLI arguments, DSNs and credentials are masked and restored at the original path", () => {
  const original = { command: "db-mcp", args: ["--dsn", "postgresql://alice:p4ssw0rd@db.invalid/prod", "--access-key", "AKIA_EXAMPLE", "-pShortSecret", "positionalPassword"], env: { DSN: "env-secret" }, headers: { Authorization: "header-secret" }, url: "https://docs.example.com/mcp?key=url-secret", access_key: "field-secret" };
  const projection = configProjection(original);
  for (const value of ["p4ssw0rd", "AKIA_EXAMPLE", "ShortSecret", "positionalPassword", "env-secret", "header-secret", "url-secret", "field-secret"]) assert.ok(!JSON.stringify(projection.value).includes(value), value);
  assert.equal(projection.masked, true); assert.equal(projection.value.command, original.command);
  assert.deepEqual(restoreConfig(projection.value, original), original);
  assert.throws(() => restoreConfig({ command: projection.value.args[0] }, original));
  assert.deepEqual(restoreConfig({ ...projection.value, env: { DSN: "replacement" }, headers: {} }, original), { ...original, env: { DSN: "replacement" }, headers: {} });
});
