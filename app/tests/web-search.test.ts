import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { parseHTML } from "linkedom";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { googleSerpExpression, type SerpPage } from "../src/server/web-access/google-serp.js";
import { SearchError } from "../src/server/web-access/search-errors.js";
import { WebSearchService } from "../src/server/web-access/search-service.js";
import { WebSearchHost, WebSearchClient } from "../src/server/web-access/search-rpc.js";
import { webSearchTool } from "../src/server/web-search-tool.js";
import type { SearchBackend } from "../src/server/web-access/search-query.js";
import type { LeaseRef } from "../src/server/execution-protocol.js";

const owner = { workspaceId: "workspace", sessionId: "session", runId: "run" };
const signal = () => new AbortController().signal;
const candidate = (url = "https://example.com/docs", snippet = "short snippet") => ({ title: "Example", url, snippet });
function extract(html: string, url = "https://www.google.com/search?q=hello&start=0"): SerpPage {
  const { document } = parseHTML(html);
  return JSON.parse(JSON.stringify(runInNewContext(googleSerpExpression, { document, location: { href: url }, URL, fetch: () => assert.fail("no network") })));
}
const result = (title: string, url: string, snippet = "简短中文摘要") => `<div data-hveid="x"><a href="${url}"><h3>${title}</h3></a><div class="VwiC3b">${snippet}</div></div>`;

test("SERP returns multiple title URL snippets without opening links, mixing result blocks or trusting base", () => {
  const page = extract(`<base href="https://evil.example/"><div id="rso">${result("one", "https://one.example/a")}${result("two", "https://two.example/b", "second")}${result("duplicate", "https://one.example/a#x")}${result("wrapped", "/url?q=https%3A%2F%2Fthree.example%2Fc")}</div><a id="pnnext" href="/search?q=hello&start=10">next</a>`);
  assert.equal(page.kind, "results"); assert.equal(page.items.length, 3);
  assert.deepEqual(page.items.map(i => i.snippet), ["简短中文摘要", "second", "简短中文摘要"]);
  assert.equal(page.items[2].url, "https://three.example/c"); assert.equal(page.nextStart, 10);
});
test("SERP supports observed Google HK redirect and prefers real snippets over site labels", () => {
  const html = '<div id="rso"><div data-hveid="x"><a href="https://example.com/"><span>Example site</span><h3>Title</h3></a><span>Metadata</span><div class="VwiC3b">Actual result summary.</div></div></div><a id="pnnext" href="/search?q=hello&start=10">next</a>';
  const page = extract(html, "https://www.google.com.hk/search?q=hello&start=0");
  assert.equal(page.kind, "results"); assert.equal(page.items[0].snippet, "Actual result summary."); assert.equal(page.nextStart, 10);
  assert.equal(extract(html, "https://www.google.com.hk.evil.example/search?q=hello").kind, "unknown");
  const nested = '<div id="rso"><div class="tF2Cxc"><div data-hveid="title"><a href="https://example.com/"><h3>Title</h3></a><span>Examplehttps://example.com/long-breadcrumb-url</span></div><div class="VwiC3b">Correct outer result snippet.</div></div></div>';
  assert.equal(extract(nested).items[0].snippet, "Correct outer result snippet.");
});
test("SERP excludes ads, Google internals, bad protocols and credentials", () => {
  const page = extract(`<div id="rso"><div data-text-ad>${result("ad", "https://ad.example/")}</div>${result("internal", "/search?q=other")}${result("js", "javascript:alert(1)")}${result("credential", "https://user:pass@site.example/")}${result("valid", "https://site.example/?q=google.com/search")}</div>`);
  assert.equal(page.items.length, 1); assert.equal(page.items[0].title, "valid");
});
test("SERP distinguishes captcha, consent, explicit empty and unknown layout", () => {
  assert.equal(extract('<form id="captcha-form"></form>').kind, "captcha");
  assert.equal(extract("", "https://www.google.com/sorry/index").kind, "captcha");
  assert.equal(extract("", "https://consent.google.com/m").kind, "consent");
  assert.equal(extract('<div id="topstuff">Your search did not match any documents</div>').kind, "empty");
  assert.equal(extract('<div id="rso"></div>').kind, "unknown");
  assert.equal(extract(result("external", "https://e.example/"), "https://google.com.evil.example/search?q=hello").kind, "unknown");
});
test("SERP next page must retain query and Google origin and advance", () => {
  for (const href of ["https://evil.example/search?q=hello&start=10", "/search?q=other&start=10", "/search?q=hello&start=0", "/url?q=hello&start=10"])
    assert.equal(extract(`<div id="rso">${result("one", "https://one.example/")}</div><a id="pnnext" href="${href}">next</a>`).nextStart, undefined);
});
test("search service returns candidates only, independent failures and protected URLs", async () => {
  const calls: string[] = [];
  const backend: SearchBackend = { close() {}, async search(query) { calls.push(query); if (query === "fail") throw new SearchError("OPENCLI_FAILED", "Failed", true);
    return { items: [candidate(), candidate(), candidate("http://127.0.0.1/"), candidate("https://site.example/?token=secret")], nextStart: 10 }; } };
  const service = new WebSearchService("unused", backend);
  try {
    const res = await service.search(owner, { queries: ["one", "fail"] }, signal());
    assert.equal(res.status, "partial"); assert.deepEqual(calls, ["one", "fail"]);
    assert.equal(res.items[0].results.length, 2); assert.equal(res.items[0].results[1].url, undefined);
    assert.doesNotMatch(JSON.stringify(res), /token=secret|webpage-body/); assert.equal(res.items[0].evidenceType, "search-snippet");
    assert.equal(res.items[0].route, "chrome-current"); assert.equal(res.items[0].nextStart, 10);
    assert.equal((await service.search(owner, { queries: ["x"], provider: "other" }, signal())).items[0].error?.code, "INVALID_INPUT");
    assert.equal((await service.search(owner, { queries: [" "] }, signal())).items[0].error?.code, "INVALID_INPUT");
  } finally { service.close(); }
});
test("search service checks authorization, cancellation, close and run budget", async () => {
  let count = 0, finish: (() => void) | undefined;
  const backend: SearchBackend = { close() {}, async search() { count++; if (finish) await new Promise<void>(resolve => { finish = resolve; }); return { items: [candidate()] }; } };
  const service = new WebSearchService("unused", backend);
  assert.equal((await service.search(owner, { queries: ["x"] }, signal(), () => false)).items[0].error?.code, "AUTHORIZATION_EXPIRED"); assert.equal(count, 0);
  for (let i = 0; i < 20; i++) assert.equal((await service.search(owner, { queries: ["x"] }, signal())).status, "success");
  assert.equal((await service.search(owner, { queries: ["x"] }, signal())).items[0].error?.code, "BUDGET_EXCEEDED");
  service.releaseRun(owner); finish = () => {};
  const call = service.search(owner, { queries: ["x"] }, signal()); await delay(0); service.close(); finish!();
  assert.equal((await call).items[0].error?.code, "CANCELLED");
});
test("service preserves uncertain browser outcomes even when the call was cancelled", async () => {
  for (const code of ["OPENCLI_OUTCOME_UNKNOWN", "CLEANUP_PENDING"]) {
    const abort = new AbortController();
    const service = new WebSearchService("unused", { close() {}, async search() { abort.abort(); throw new SearchError(code, "Inspect the retained browser state."); } });
    const result = await service.search(owner, {queries:["x"]}, abort.signal);
    assert.equal(result.items[0].error?.code, code); service.close();
  }
});
test("main-owned search RPC and tool round trip with progress", async () => {
  const lease: LeaseRef = { instanceId: "worker", generation: 1, leaseId: "lease" };
  let admitted: LeaseRef | undefined = lease, calls = 0;
  const service = new WebSearchService("unused", { close() {}, async search(_q, _s, _l, _signal, progress) { calls++; progress("verification"); return { items: [candidate()] }; } });
  const client = new WebSearchClient();
  const host = new WebSearchHost(() => admitted, (_owner, reply) => client.reply(reply as any), service);
  const tool = webSearchTool((id, params, signal, progress) => client.call(value => host.handle(owner, { ...(value as any), lease }), id, params, signal, progress));
  let updates = 0;
  try {
    const response = await tool.execute("call", { queries: ["test"] }, signal(), () => { updates++; }, {} as any);
    assert.equal(response.isError, false); assert.equal(updates, 1); assert.equal(client.size, 0); assert.equal(calls, 1);
    admitted = undefined;
    host.handle(owner, { type: "web-search-call", key: "forged", lease, params: { queries: ["bad"] } });
    await delay(0); assert.equal(calls, 1);
  } finally { host.close(); client.clear(); }
});
test("search client cancels and ignores late responses", async () => {
  const client = new WebSearchClient(), abort = new AbortController(), messages: any[] = [];
  const promise = client.call(value => messages.push(value), "call", { queries: ["x"] }, abort.signal);
  abort.abort(); await assert.rejects(promise, /cancelled/); assert.equal(client.size, 0);
  client.reply({ type: "web-search-reply", key: messages[0].key, ok: true, data: {} });
  assert.equal(messages[1].type, "web-search-cancel");
});
test("search describes its purpose without changing the returned protocol", async () => {
  const data = { schemaVersion: 1, requestId: "request", status: "empty", items: [], warnings: [] };
  const tool = webSearchTool(async () => data);
  assert.equal(tool.description, "Search Google to find relevant web pages.");
  const result = await tool.execute("id", { queries: ["query"] }, undefined, undefined, {} as any);
  assert.deepEqual(result.content, [{ type: "text", text: JSON.stringify(data) }]);
  assert.equal(result.details, data); assert.equal(result.isError, false);
});
test("search remains main-only and invokes OpenCLI without native browser or reader calls", () => {
  const worker = readFileSync(new URL("../src/server/agent-worker.ts", import.meta.url), "utf8");
  assert.match(worker, /customTools: input\.task \? \[\] : .*webSearchTool\(callSearch\)/);
  assert.match(worker, /searchCalls\.size === 0/);
  const query = readFileSync(new URL("../src/server/web-access/search-query.ts", import.meta.url), "utf8");
  assert.match(query, /new SearchCommandCache\(new SearchInstallationCache\(root\)\)/);
  assert.doesNotMatch(query, /downloadPublic|webRead|SearchCDP|SearchBrowser|searchRelay/);
});
