import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server/index.js";
import { TaskRecords, target } from "../src/server/tasks/records.js";
import { prepareSkillInput } from "../src/server/skill-input.js";
import { skillId } from "../src/server/capability-resources.js";
import { skillsInput } from "../src/shared/skills.js";
import { running } from "../src/shared/agent.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
import type { EditableMessage } from "../src/shared/rewrite.js";
const wait = async (check: () => boolean) => { const until = Date.now() + 25000; while (!check()) { if (Date.now() > until) throw Error("fixture timed out"); await new Promise(resolve => setTimeout(resolve, 20)); } };

test("skill input rejects forged identity, malformed YAML, invalid bytes and oversized guides", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-skill-input-")), filePath = join(root, "SKILL.md");
  const skill = { filePath, name: "guide", description: "Guide" }, ref = { id: skillId(filePath), name: "forged-name", description: "forged description" };
  try {
    writeFileSync(filePath, "---\nname: actual\ndescription: Current description\n---\nACTUAL_GUIDE");
    const input = prepareSkillInput("hello", [ref], [skill]);
    assert.match(input.prompt, /ACTUAL_GUIDE/); assert.equal(input.metadata?.skills[0].name, "actual");
    assert.throws(() => prepareSkillInput("hello", [{ ...ref, id: "0".repeat(64) }], [skill]), { code: "SKILL_UNAVAILABLE" });
    assert.throws(() => skillsInput([ref, ref]), { code: "INVALID_INPUT" });
    assert.throws(() => skillsInput([{ ...ref, path: filePath }]), { code: "INVALID_INPUT" });
    writeFileSync(filePath, "---\nname: [SECRET_PARSE_EXCERPT\ndescription: test\n---\nBody");
    assert.throws(() => prepareSkillInput("hello", [ref], [skill]), error => (error as any).code === "SKILL_INVALID" && !(error as Error).message.includes("SECRET_PARSE_EXCERPT"));
    writeFileSync(filePath, Buffer.from([0xff])); assert.throws(() => prepareSkillInput("hello", [ref], [skill]), { code: "SKILL_READ_FAILED" });
    writeFileSync(filePath, "a".repeat(128 * 1024 + 1)); assert.throws(() => prepareSkillInput("hello", [ref], [skill]), { code: "SKILL_READ_FAILED" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("real Skill prompt, Steering, recall, rewrite and restarted history preserve immutable display metadata", { timeout: 120000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-skill-flow-")), cwd = join(root, "project"), pi = join(root, "pi");
  mkdirSync(join(cwd, ".pi", "skills", "guide"), { recursive: true }); mkdirSync(pi);
  const file = join(cwd, ".pi", "skills", "guide", "SKILL.md");
  const writeGuide = (version: string) => writeFileSync(file, `---\nname: guide\ndescription: Description ${version}\n---\nGUIDE_BODY_${version}`);
  writeGuide("ONE");
  const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = pi;
  const bodies: any[] = [], releases: (() => void)[] = [];
  const fixture = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk; bodies.push(JSON.parse(raw));
    res.writeHead(200, { "Content-Type": "text/event-stream" }); res.flushHeaders();
    releases.push(() => { for (const [delta, finish_reason] of [[{ role: "assistant", content: "Done" }, null], [{}, "stop"]])
      res.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      res.end("data: [DONE]\n\n"); });
  });
  await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
  writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: { fixture: { api: "openai-completions", baseUrl: `http://127.0.0.1:${(fixture.address() as any).port}/v1`, models: [{ id: "fixture" }] } } }));
  writeFileSync(join(pi, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "fixture" } }));
  writeFileSync(join(pi, "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
  let app: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    app = await startServer({ root, port: 0 });
    const w = app.store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: cwd, authorized: true } }) as Workspace;
    const s = app.store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: w.id }) as Session;
    const scope = { workspaceId: w.id, sessionId: s.id };
    const call = (op: string, params: Record<string, unknown> = {}) => app!.tasks.command({ op, params, ...scope, requestId: randomUUID() });
    const catalog = await app.agents.capabilities.get(scope), skill = catalog.skills.find(item => item.name === "guide")!;
    const skills = [{ id: skill.id, name: "client label", description: "client description" }];
    await call("agent.model", { selection: { provider: "fixture", id: "fixture", thinking: "off" } });
    await call("prompt", { text: "FIRST", skills }); await wait(() => bodies.length === 1);
    assert.match(JSON.stringify(bodies[0].messages), /GUIDE_BODY_ONE/);
    await wait(() => !!app!.agents.messages(scope).find(m => m?.text === "FIRST"));
    assert.equal(app.agents.messages(scope).find(m => m?.text === "FIRST")?.skills?.[0].description, "Description ONE");
    await call("prompt", { text: "RECALL", skills });
    const recalled = await call("agent.recall") as any;
    assert.deepEqual(recalled.drafts[0].skills, skills);
    writeGuide("TWO");
    await call("prompt", { text: "APPENDED", skills }); releases[0]();
    await wait(() => bodies.length === 2); assert.match(JSON.stringify(bodies[1].messages), /GUIDE_BODY_TWO/);
    assert.doesNotMatch(JSON.stringify(bodies[1].messages), /RECALL/);
    await wait(() => !!app!.agents.messages(scope).find(m => m?.text === "APPENDED"));
    assert.equal(app.agents.messages(scope).find(m => m?.text === "APPENDED")?.skills?.[0].description, "Description TWO");
    assert.equal(app.agents.messages(scope).find(m => m?.text === "FIRST")?.skills?.[0].description, "Description ONE");
    releases[1](); await wait(() => !running(app!.agents.info(scope).run));
    await app.close(); app = await startServer({ root, port: 0 });
    const history = app.agents.messages(scope), first = history.find(m => m?.text === "FIRST")!, appended = history.find(m => m?.text === "APPENDED")!;
    assert.equal(first.skills?.[0].description, "Description ONE"); assert.equal(appended.skills?.[0].description, "Description TWO");
    const editable = await call("agent.editable", { messageId: appended.id }) as EditableMessage;
    assert.equal(editable.draft.text, "APPENDED"); assert.deepEqual(editable.draft.skills, appended.skills);
    writeGuide("THREE");
    await call("prompt", { ...editable.draft, text: "REWRITTEN", rewrite: { messageId: appended.id, revision: editable.revision } });
    await wait(() => bodies.length === 3); assert.match(JSON.stringify(bodies[2].messages), /GUIDE_BODY_THREE/);
    releases[2](); await wait(() => !running(app!.agents.info(scope).run));
    assert.equal(app.agents.messages(scope).find(m => m?.text === "REWRITTEN")?.skills?.[0].description, "Description THREE");
    assert.ok(!app.agents.messages(scope).some(m => m?.text === "APPENDED"));
    const records = new TaskRecords(app.store);
    const childId = records.create(scope, "skill-fixture", "Research", [{ task: "Child initial", role: "" }], { provider: "fixture", id: "fixture", thinking: "off" }).taskIds[0];
    const child = target(records.rows("WHERE id=?", childId)[0]);
    await app.tasks.command({ op: "prompt", requestId: randomUUID(), ...child, params: { text: "", skills } });
    await wait(() => bodies.length === 4);
    await wait(() => !!app!.agents.info(child).queue?.length);
    assert.deepEqual(app.agents.info(child).queue?.[0].skills, skills);
    releases[3](); await wait(() => bodies.length === 5);
    assert.match(JSON.stringify(bodies[4].messages), /GUIDE_BODY_THREE/);
    releases[4](); await wait(() => !running(app!.agents.info(child).run));
    assert.equal(app.agents.messages(child).find(m => m?.skills?.length)?.skills?.[0].description, "Description THREE");
  } finally {
    await app?.close(); fixture.closeAllConnections(); await new Promise<void>(resolve => fixture.close(() => resolve()));
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
