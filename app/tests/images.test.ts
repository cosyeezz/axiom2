// Real pi SDK/worker transport against a loopback fixture; no remote-provider claim.
import { projectionFixture } from "./projection-fixture.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type ServerResponse } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { deflateSync, crc32 } from "node:zlib";
import WebSocket from "ws";
import { startServer } from "../src/server/index.js";
import { imagesInput, imagePrompt, imageContent, imageDisplayText } from "../src/server/images.js";
import { chatMessage, transcriptMessages } from "../src/server/transcript.js";
import { TaskRecords } from "../src/server/tasks/records.js";
import { running } from "../src/shared/agent.js";
import type { ImageAttachment, Session, Workspace, Scope } from "../src/shared/protocol.js";

const png = (() => {
  const chunk = (name: string, data: Buffer) => {
    const type = Buffer.from(name), size = Buffer.alloc(4), crc = Buffer.alloc(4);
    size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
    return Buffer.concat([size, type, data, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from([0,255,0,0,255]))), chunk("IEND", Buffer.alloc(0))]).toString("base64");
})();
const image = (id = "imag1", data = png): ImageAttachment => ({ id, name: `${id}.png`, mimeType: "image/png", data });
const wait = async (check: () => boolean, message: string) => {
  const end = Date.now() + 30000;
  while (!check()) {
    if (Date.now() > end) throw Error(message);
    await new Promise((r) => setTimeout(r, 25));
  }
};
test("image boundaries, MIME signatures, base64, ordering, and metadata-only views", () => {
  assert.deepEqual(imagesInput(undefined), []);
  assert.deepEqual(imagesInput([image()]), [image()]);
  for (const bad of [null, {}, [image("image1")], [image(), image()], [image("imag01")], [{ ...image(), mimeType: "image/jpeg" }], [image("imag1", "data:image/png;base64," + png)], [image("imag1", "!!!!")], Array.from({ length: 5 }, (_, i) => image(`imag${i + 1}`))])
    assert.throws(() => imagesInput(bad), { code: "INVALID_IMAGE" });
  const padded = (n: number) => { const b = Buffer.alloc(n); Buffer.from(png, "base64").copy(b); return b.toString("base64"); };
  assert.throws(() => imagesInput([image("imag1", padded(5 * 1024 * 1024 + 1))]), { code: "INVALID_IMAGE" });
  assert.throws(() => imagesInput([image("imag1", padded(4 * 1024 * 1024)), image("imag2", padded(4 * 1024 * 1024)), image("imag3", padded(4 * 1024 * 1024))]), { code: "INVALID_IMAGE" });
  assert.match(imagePrompt("compare [imag2] [imag1]", [image(), image("imag2")]), /第 1 张图片对应 \[imag1\][\s\S]*第 2 张图片对应 \[imag2\]/);
  const view = chatMessage({ role: "custom", customType: "axiom-append", display: true, content: imageContent("look", [image()]), details: { images: [image()] } }, "test");
  assert.equal(view!.text, "look");
  assert.equal(view!.images![0].name, "imag1.png");
  assert.ok(!JSON.stringify(view).includes(png));
});

test("image mapping stays in model context but not live, pending or restored display", () => {
  const photos = [{ ...image(), name: 'quoted "image".png' }, image("imag3")];
  const original = "[imag3] compare [imag1]\n保留正文";
  const prompt = imagePrompt(original, photos);
  assert.equal(imageDisplayText(prompt, 2), original);
  assert.equal(imageDisplayText(prompt, 0), prompt);
  assert.equal(imageDisplayText(prompt + "\n用户后文", 2), prompt + "\n用户后文");
  assert.equal(imageDisplayText("图片附件映射：用户自己的说明", 2), "图片附件映射：用户自己的说明");
  const content = imageContent(original, photos);
  assert.equal(chatMessage({ role: "user", content }, "live")!.text, original);
  assert.equal(chatMessage({ role: "assistant", content }, "assistant")!.text, prompt);
  const branch = [
    { type: "custom", customType: "axiom-request", data: { runId: "pending", text: prompt, images: photos } },
    { type: "message", id: "restored", message: { role: "user", content } },
    { type: "custom_message", id: "append", customType: "axiom-append", display: true, content, details: { images: photos } },
  ];
  const views = transcriptMessages(projectionFixture(branch));
  assert.deepEqual(views.map((view) => view.text), [original, original], "legacy axiom-request copies are not another displayed message");
  assert.equal((content[0] as { text: string }).text, prompt, "display conversion never mutates model content");
});

test("images: no WS drafts, native prompt/history, text-only rejection, child live and queued append, restart no replay", { timeout: 120000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-images-")), cwd = join(root, "project");
  mkdirSync(cwd); mkdirSync(join(root, "pi"));
  const requests: any[] = [];
  let held: ServerResponse | undefined, holdNext = false;
  const finish = (res: ServerResponse) => {
    const delta = { role: "assistant", content: "Image fixture complete." };
    for (const [d, stop] of [[delta, null], [{}, "stop"]])
      res.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "vision", choices: [{ index: 0, delta: d, finish_reason: stop }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  };
  const fixture = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    requests.push(JSON.parse(raw));
    res.writeHead(200, { "Content-Type": "text/event-stream" }); res.flushHeaders();
    if (holdNext) { holdNext = false; held = res; return; }
    finish(res);
  });
  await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
  writeFileSync(join(root, "pi", "models.json"), JSON.stringify({ providers: { "images-fixture": {
    api: "openai-completions", baseUrl: `http://127.0.0.1:${(fixture.address() as any).port}/v1`,
    models: [{ id: "vision", input: ["text", "image"], contextWindow: 32000, maxTokens: 1000 }, { id: "text", input: ["text"], contextWindow: 32000, maxTokens: 1000 }],
  } } }));
  writeFileSync(join(root, "pi", "auth.json"), JSON.stringify({ "images-fixture": { type: "api_key", key: "fixture" } }));
  writeFileSync(join(root, "pi", "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
  const previousPi = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  let app = await startServer({ root, port: 0 });
  let ws: WebSocket | undefined;
  try {
    const w = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: cwd, authorized: true } }) as Workspace;
    const s = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: w.id }) as Session;
    const scope: Scope = { workspaceId: w.id, sessionId: s.id };
    const call = (op: string, params: Record<string, unknown> = {}, to = scope, requestId = randomUUID()) => app.tasks.command({ op, params, ...to, requestId });
    const choose = (id: string, to = scope) => call("agent.model", { selection: { provider: "images-fixture", id, thinking: "off" } }, to);
    await choose("text");
    await assert.rejects(call("prompt", { text: "reject", images: [image()] }), { code: "MODEL_IMAGE_UNSUPPORTED" });
    assert.equal(requests.length, 0);
    await choose("vision");
    ws = new WebSocket(app.origin.replace("http", "ws") + "/ws", { origin: app.origin });
    await new Promise<void>((resolve, reject) => { ws!.once("open", resolve); ws!.once("error", reject); });
    const socketCall = (op: string, params: unknown) => new Promise<any>((resolve, reject) => {
      const requestId = randomUUID();
      const receive = (data: WebSocket.RawData) => { const v = JSON.parse(data.toString()); if (v.requestId !== requestId) return; ws!.off("message", receive); v.ok ? resolve(v.data) : reject(v.error); };
      ws!.on("message", receive); ws!.send(JSON.stringify({ op, params, ...scope, requestId }));
    });
    // Exceeds the previous 200KB WS limit while staying within attachment limits.
    const bytes = Buffer.alloc(240000); Buffer.from(png, "base64").copy(bytes);
    const draftImage = image("imag1", bytes.toString("base64"));
    for (const op of ["draft.save", "draft.get", "draft.list"])
      await assert.rejects(socketCall(op, { viewId: "image-view", text: "[imag1]", images: [draftImage] }), { code: "UNKNOWN_OPERATION" });
    await assert.rejects(socketCall("prompt", { text: "large image crosses WS validation", images: [draftImage], attachments: [{ name: "bad", text: "binary\u0000" }] }), { code: "INVALID_ATTACHMENT" });
    const files = [{ name: "folder/first.rs", text: "first-upload-body" }, { name: "folder/second", text: "second-upload-body" }];
    const requestId = randomUUID(), params = { text: "compare [imag2] with [imag1]", attachment: { name: "legacy.txt", text: "legacy-upload-body" }, attachments: files, images: [image(), image("imag2")] };
    await call("prompt", params, scope, requestId);
    await wait(() => !running(app.agents.info(scope).run), "main image prompt unfinished");
    assert.equal(app.agents.info(scope).run!.status, "completed");
    // Request-only title instructions may follow the original user message.
    const latestUser = requests[0].messages.find((m: any) => m.role === "user" && JSON.stringify(m.content).includes(params.text));
    assert.equal(latestUser.content.filter((c: any) => c.type === "image_url").length, 2, JSON.stringify(latestUser));
    assert.match(JSON.stringify(latestUser), /第 1 张图片对应 \[imag1\]/);
    for (const content of ["legacy-upload-body", ...files.map((f) => f.text)]) assert.ok(JSON.stringify(latestUser).includes(content));
    for (const id of app.agents.thread(scope).ids) {
      const view = app.agents.message(scope, id, true);
      assert.ok(!JSON.stringify(view).includes(png));
      if (view?.images?.length) assert.ok(!view.text.includes("图片附件映射"));
    }
    await choose("text");
    await assert.rejects(call("prompt", { text: "history contains images" }), { code: "MODEL_IMAGE_UNSUPPORTED" });
    await choose("vision");
    await app.close(); ws = undefined;
    app = await startServer({ root, port: 0 });
    assert.equal(requests.length, 1);
    for (const id of app.agents.thread(scope).ids) {
      const view = app.agents.message(scope, id, true);
      if (view?.images?.length) assert.ok(!view.text.includes("图片附件映射"));
    }
    assert.equal(app.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='drafts'").get(), undefined);
    await call("prompt", params, scope, requestId);
    assert.equal(requests.length, 1, "receipt cannot replay images");
    await call("prompt", { text: "refer to previous images" });
    await wait(() => !running(app.agents.info(scope).run), "history restore unfinished");
    assert.ok(JSON.stringify(requests.at(-1).messages).includes("image_url"));
    const records = new TaskRecords(app.store);
    const { taskIds } = records.create(scope, "image-test", "image test context", [{ task: "child image task", role: "" }], { provider: "images-fixture", id: "vision", thinking: "off" });
    records.freeze(scope); // Do not wake parent while testing child transport.
    const taskId = taskIds[0], child = records.rows("WHERE id=?", taskId)[0], to = { workspaceId: w.id, sessionId: child.sessionId };
    holdNext = true;
    records.queue(taskId, "queued first [imag1]", "steer", [{ ...image(), name: "queued-first.png" }]);
    const queuedSecond = await call("task.append", { taskId, text: "queued second [imag1]", images: [{ ...image(), name: "queued-second.png" }] }) as any;
    await wait(() => !!held, "child initial request missing");
    const initial = requests.at(-1);
    assert.equal(JSON.stringify(initial.messages).match(/image_url/g)?.length, 2); // key and type
    const live = await call("task.append", { taskId, text: "steer [imag1]", attachments: files, images: [{ ...image(), name: "live.png" }], mode: "steer" }) as any;
    const afterImage = await call("task.append", { taskId, text: "text after live image", mode: "steer" }) as any;
    const follow = await call("task.append", { taskId, text: "follow [imag1]", images: [{ ...image(), name: "follow.png" }], mode: "followUp" }) as any;
    // Allow normalization to finish; arrival order, not decode speed, must order each pi queue.
    await new Promise((r) => setTimeout(r, 700));
    finish(held!); held = undefined;
    await wait(() => !running(app.agents.info(to).run), "child append unfinished");
    assert.equal(app.agents.info(to).run!.status, "completed");
    for (const inputId of [queuedSecond.inputId, live.inputId, follow.inputId])
      assert.equal(app.store.db.prepare("SELECT state FROM task_inputs WHERE id=?").get(inputId), undefined, "pi owns delivered input; no retained replay copy");
    const customViews = app.agents.thread(to).ids.map((id) => app.agents.message(to, id));
    assert.ok(customViews.some((v) => v?.images?.some((i) => i.name === "queued-second.png")));
    assert.ok(customViews.some((v) => v?.images?.some((i) => i.name === "live.png")));
    assert.ok(customViews.findIndex((v) => v?.id === `input-${live.inputId}`) < customViews.findIndex((v) => v?.id === `input-${afterImage.inputId}`), "later text must not overtake async image normalization");
    assert.ok(JSON.stringify(requests.at(-1)).includes("first-upload-body"));
    assert.ok(JSON.stringify(requests.at(-1)).includes("second-upload-body"));
    assert.ok(customViews.some((v) => v?.images?.some((i) => i.name === "follow.png")));
    assert.ok(customViews.every((v) => !JSON.stringify(v).includes(png)));
    assert.ok(customViews.filter((v) => v?.images?.length).every((v) => !v!.text.includes("图片附件映射")));
    for (const name of ["queued-first.png", "queued-second.png", "live.png", "follow.png"]) {
      const message = requests.at(-1).messages.find((m: any) => m.role === "user" && JSON.stringify(m.content).includes(name));
      assert.ok(message, `missing independent image mapping for ${name}`);
      assert.equal(message.content.filter((c: any) => c.type === "image_url").length, 1);
      assert.match(JSON.stringify(message.content), /第 1 张图片对应 \[imag1\]/);
    }
    await choose("text", to);
    await assert.rejects(call("task.append", { taskId, images: [image()] }), { code: "MODEL_IMAGE_UNSUPPORTED" });
    await choose("vision", to);
    // A corrupt payload with a valid signature must fail decoding without poisoning later inputs.
    holdNext = true;
    await call("prompt", { text: "hold while validating append" }, to);
    await wait(() => !!held, "decode test request missing");
    const bad = await call("task.append", { taskId, text: "invalid decode", images: [image("imag1", Buffer.from([137,80,78,71,13,10,26,10]).toString("base64"))] }) as any;
    const healthy = await call("task.append", { taskId, text: "healthy after decode failure" }) as any;
    await wait(() => !app.store.db.prepare("SELECT state FROM task_inputs WHERE id=?").get(bad.inputId), "decode failure not discarded");
    await new Promise((r) => setTimeout(r, 100));
    finish(held!); held = undefined;
    await wait(() => !running(app.agents.info(to).run), "decode test unfinished");
    assert.equal(app.store.db.prepare("SELECT state FROM task_inputs WHERE id=?").get(healthy.inputId), undefined);
    assert.ok(JSON.stringify(requests.at(-1)).includes("healthy after decode failure"), "later healthy input still reaches pi");
    assert.match(records.rows("WHERE id=?", taskId)[0].error!, /无法解码/);
    assert.ok(!JSON.stringify(requests.at(-1)).includes("invalid decode"));

    // Finish the turn while normalization is pending. No late custom message or auto-replay.
    holdNext = true;
    await call("prompt", { text: "finish boundary" }, to);
    await wait(() => !!held, "boundary request missing");
    const boundaryRun = app.agents.info(to).run!.id, beforeBoundary = requests.length;
    const late = await call("task.append", { taskId, text: "late decode boundary", images: Array.from({ length: 4 }, (_, i) => image(`imag${i + 1}`)) }) as any;
    finish(held!); held = undefined;
    await wait(() => !running(app.agents.info(to).run), "boundary test unfinished");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(app.agents.info(to).run!.id, boundaryRun, "normalization crossing settlement cannot create an automatic new run");
    assert.equal(requests.length, beforeBoundary);
    assert.equal(app.store.db.prepare("SELECT state FROM task_inputs WHERE id=?").get(late.inputId), undefined);
    assert.ok(!app.agents.thread(to).ids.includes(`input-${late.inputId}`));

    holdNext = true;
    await call("prompt", { text: "stop boundary" }, to);
    await wait(() => !!held, "stop boundary request missing");
    const beforeStop = requests.length;
    const stopped = await call("task.append", { taskId, text: "stop during decode", images: Array.from({ length: 4 }, (_, i) => image(`imag${i + 1}`)) }) as any;
    await call("task.cancel", { taskId });
    await wait(() => !running(app.agents.info(to).run), "stop boundary unfinished");
    (held as ServerResponse | undefined)?.destroy(); held = undefined;
    assert.equal(app.agents.info(to).run!.status, "cancelled");
    assert.equal(app.store.db.prepare("SELECT state FROM task_inputs WHERE id=?").get(stopped.inputId), undefined);
    assert.equal(requests.length, beforeStop, "stop cannot start another model turn after decoding");
    assert.ok(!app.agents.thread(to).ids.includes(`input-${stopped.inputId}`));

    // Child prompt route accepts image-only input and restores the same pi session.
    await call("prompt", { attachments: [{ name: "child.go", text: "child-prompt-upload-body" }], images: [image("imag3")] }, to);
    await wait(() => !running(app.agents.info(to).run) && records.rows("WHERE id=?", taskId)[0].status === "completed", "child prompt route unfinished");
    assert.ok(JSON.stringify(requests.at(-1)).includes("child-prompt-upload-body"));
    const queuedId = records.queue(taskId, "held on restart [imag1]", "followUp", [image()]);
    const before = requests.length;
    await app.close(); app = await startServer({ root, port: 0 });
    assert.equal(requests.length, before);
    assert.equal(app.store.db.prepare("SELECT state FROM task_inputs WHERE id=?").get(queuedId), undefined, "restart drops unsent queued input");
    assert.equal(app.store.db.prepare("SELECT * FROM task_input_images WHERE inputId=?").get(queuedId), undefined, "discarded input cannot retain image bytes");
    await assert.rejects(call("task.pending", { taskId }), { code: "UNKNOWN_OPERATION" });
    const restored = app.agents.thread(to).ids.map((id) => app.agents.message(to, id));
    assert.ok(restored.some((v) => v?.images?.some((i) => i.name === "follow.png")));
    assert.ok(restored.every((v) => !JSON.stringify(v).includes(png)));
  } finally {
    ws?.terminate(); await app.close(); fixture.closeAllConnections();
    await new Promise<void>((r) => fixture.close(() => r())); rmSync(root, { recursive: true, force: true });
    if (previousPi === undefined) delete process.env.AXIOM_PI_DIR;
    else process.env.AXIOM_PI_DIR = previousPi;
  }
});
