import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelService } from "../src/server/model-service.js";
import type { ModelInput, ProviderDraft } from "../src/shared/models.js";

test("input capabilities survive save/reload, overlapping overrides and legacy drafts; invalid input never publishes", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-model-input-"));
  const previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  try {
    const service = new ModelService(root);
    const provider: ProviderDraft = {
      id: "vision-test", providerId: "vision-test", name: "视觉测试", api: "openai-completions",
      url: "http://127.0.0.1:1/v1", key: "", headers: [], body: [],
      models: [{ key: "vision", id: "vision", name: "视觉模型", levels: ["none"], input: ["text", "image"], headers: [], body: [] }],
    };
    await service.save({ ...await service.read(), providers: [provider] });
    const path = join(service.dir, "models.json");
    const raw = () => JSON.parse(readFileSync(path, "utf8"));
    let draft = await service.read();
    assert.deepEqual(draft.providers[0].models[0].input, ["text", "image"]);
    assert.deepEqual((await service.runtime()).getModel("vision-test", "vision")?.input, ["text", "image"]);
    // Older clients omit this field and must not strip existing image support.
    delete draft.providers[0].models[0].input;
    await service.save(draft);
    assert.deepEqual((await service.read()).providers[0].models[0].input, ["text", "image"]);
    for (const invalid of [[], ["image"], ["text", "text"], ["text", "audio"], null, "text"]) {
      draft = await service.read();
      draft.providers[0].models[0].input = invalid as ModelInput[];
      const before = readFileSync(path, "utf8");
      await assert.rejects(service.save(draft), (error: any) => error.code === "INVALID_CONFIG" && /视觉模型.*输入能力/.test(error.message));
      assert.equal(readFileSync(path, "utf8"), before);
    }
    // pi applies input overrides after custom definitions. Edit the effective value.
    const config = raw();
    config.providers["vision-test"].models[0].input = ["text"];
    config.providers["vision-test"].modelOverrides.vision = { input: ["text", "image"], contextWindow: 123456 };
    writeFileSync(path, JSON.stringify(config));
    draft = await service.read();
    assert.deepEqual(draft.providers[0].models[0].input, ["text", "image"]);
    draft.providers[0].models[0].input = ["text"];
    await service.save(draft);
    assert.deepEqual((await service.runtime()).getModel("vision-test", "vision")?.input, ["text"]);
    assert.equal((await service.runtime()).getModel("vision-test", "vision")?.contextWindow, 123456);
    assert.equal(raw().providers["vision-test"].modelOverrides.vision.input, undefined);
    draft = await service.read();
    draft.providers[0].models[0].input = ["text", "image"];
    draft.providers[0].models[0].id = "renamed-vision";
    await service.save({ ...draft, confirmLogout: true });
    assert.deepEqual((await service.runtime()).getModel("vision-test", "renamed-vision")?.input, ["text", "image"]);
  } finally {
    if (previous === undefined) delete process.env.AXIOM_PI_DIR;
    else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("native catalog input remains inherited until edited, including when a native override is renamed", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-native-input-"));
  const previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  try {
    const service = new ModelService(root);
    const draft = await service.read();
    const model = (await service.runtime()).getModels("openai").find(m => m.input.includes("image") && !m.reasoning)!;
    assert.ok(model);
    const provider: ProviderDraft = { id: "openai", providerId: "openai", name: "OpenAI", api: model.api, url: model.baseUrl, key: "", headers: [], body: [], models: [
      { key: model.id, id: model.id, name: model.name, levels: ["none"], input: [...model.input], headers: [], body: [] },
    ] };
    await service.save({ ...draft, providers: [provider] });
    const path = join(service.dir, "models.json");
    assert.equal(JSON.parse(readFileSync(path, "utf8")).providers.openai.modelOverrides[model.id].input, undefined);
    let next = await service.read();
    next.providers[0].models[0].input = ["text"];
    await service.save(next);
    assert.deepEqual((await service.runtime()).getModel("openai", model.id)?.input, ["text"]);
    // Restore inheritance to exercise rename from a metadata-only override.
    const config = JSON.parse(readFileSync(path, "utf8"));
    delete config.providers.openai.modelOverrides[model.id].input;
    writeFileSync(path, JSON.stringify(config));
    next = await service.read();
    delete next.providers[0].models[0].input;
    next.providers[0].models[0].id = "renamed-native-vision";
    await service.save({ ...next, confirmLogout: true });
    assert.deepEqual((await service.runtime()).getModel("openai", "renamed-native-vision")?.input, model.input);
  } finally {
    if (previous === undefined) delete process.env.AXIOM_PI_DIR;
    else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
