import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { Configuration } from "../shared/protocol.js";

export async function configuration(root: string): Promise<Configuration> {
  const dir = join(root, "pi");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const result: Configuration = {
    revision: "",
    providerCount: 0,
    modelCount: 0,
    available: [],
    dataRoot: root,
  };
  try {
    let raw = '{"providers":{}}';
    try {
      raw = await readFile(join(dir, "models.json"), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    result.revision = createHash("sha256").update(raw).digest("hex");
    const config = JSON.parse(raw);
    if (
      !config ||
      typeof config.providers !== "object" ||
      !config.providers ||
      Array.isArray(config.providers)
    )
      throw Error();
    const allowed = new Set<string>();
    for (const [id, p] of Object.entries(config.providers) as [
      string,
      { models?: { id: string }[]; modelOverrides?: Record<string, unknown> },
    ][]) {
      if (!p || typeof p !== "object") throw Error();
      result.providerCount++;
      for (const m of p.models ?? []) {
        if (typeof m.id !== "string") throw Error();
        allowed.add(`${id}/${m.id}`);
      }
      for (const modelId of Object.keys(p.modelOverrides ?? {}))
        allowed.add(`${id}/${modelId}`);
    }
    result.modelCount = allowed.size;
    const runtime = await ModelRuntime.create({
      authPath: join(dir, "auth.json"),
      modelsPath: join(dir, "models.json"),
      modelsStorePath: join(dir, "models-store.json"),
      allowModelNetwork: false,
    });
    if (runtime.getError()) throw Error();
    result.available = (
      await runtime.getAvailable(undefined, {
        signal: AbortSignal.timeout(5000),
      })
    )
      .filter((m) => allowed.has(`${m.provider}/${m.id}`))
      .map((m) => ({
        provider: m.provider,
        id: m.id,
        name: m.name,
        levels: getSupportedThinkingLevels(m),
      }));
  } catch {
    // Never return pi parser errors: they can include secret configuration values.
    result.error =
      "pi 配置读取失败；原文件未覆盖，请检查应用数据目录中的配置。";
    result.available = [];
  }
  return result;
}
