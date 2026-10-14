import assert from "node:assert/strict";
import { test } from "node:test";
import { folderResponse } from "../src/client/workspaces/folder-response.js";

test("folder responses distinguish cancel, selection, old service and malformed responses", async () => {
  assert.equal(await folderResponse(Response.json({ path: null })), null);
  assert.equal(await folderResponse(Response.json({ path: "F:\\中文项目" })), "F:\\中文项目");
  for (const status of [404, 405])
    await assert.rejects(folderResponse(new Response("", { status })), /请重启 Axiom2 本地服务/);
  for (const body of ["", "<html>old service</html>"])
    await assert.rejects(folderResponse(new Response(body)), /空白或无效响应/);
  await assert.rejects(folderResponse(Response.json(null)), /未返回有效目录/);
  await assert.rejects(folderResponse(Response.json({ path: 123 })), /未返回有效目录/);
  await assert.rejects(folderResponse(Response.json({ error: "请选择可访问目录" }, { status: 400 })), /请选择可访问目录/);
  await assert.rejects(folderResponse(new Response("", { status: 503 })), /HTTP 503/);
});
