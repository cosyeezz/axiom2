import { providerProxyUrl, readProviderProxy } from "./integrations/model-proxy-env.js";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createModelRuntime } from "./model-runtime.js";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { Configuration } from "../shared/protocol.js";

export async function configuration(root: string): Promise<Configuration> {
  const dir = process.env.AXIOM_PI_DIR || join(root, "pi");
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
    const runtime = await createModelRuntime({
      providerIds: Object.keys(config.providers),
      authPath: join(dir, "auth.json"),
      modelsPath: join(dir, "models.json"),
      modelsStorePath: join(dir, "models-store.json"),
      allowModelNetwork: false,
    });
    if (runtime.getError()) throw Error();
    const credentials = await runtime.listCredentials();
    for (const credential of credentials) {
      if (Object.hasOwn(config.providers, credential.providerId)) continue;
      result.providerCount++;
      for (const model of runtime.getModels(credential.providerId))
        allowed.add(`${model.provider}/${model.id}`);
    }
    // A provider-only configuration uses pi's native catalog in either storage location.
    for (const [provider, definition] of Object.entries(config.providers) as [string, any][])
      if (!(definition.models?.length || Object.keys(definition.modelOverrides ?? {}).length))
        for (const model of runtime.getModels(provider)) allowed.add(`${provider}/${model.id}`);
    result.modelCount = allowed.size;
    const configuredProviders = [...new Set([...Object.keys(config.providers), ...[...allowed].map(key => key.slice(0, key.indexOf("/")))])];
    // Available models come from local credential/provider metadata, not the network.
    // Compute them on the runtime above instead of forking one worker per provider;
    // the routes are still resolved so a stopped proxy stays an explicit warning.
    const available = await Promise.all(configuredProviders.map(async provider => {
      try {
        providerProxyUrl(root, readProviderProxy(join(dir, "models.json"), provider));
        return await runtime.getAvailable(provider, { signal: AbortSignal.timeout(10000) });
      } catch {
        result.warning = "部分供应商的连接检查未完成，已保留其配置模型；请检查供应商代理、线路与认证设置。";
        return credentials.some(item => item.providerId === provider) ? runtime.getModels(provider) : [];
      }
    }));
    result.available = available.flat()
      .filter((m) => allowed.has(`${m.provider}/${m.id}`))
      .map((m) => ({
        provider: m.provider,
        id: m.id,
        name: m.name,
        levels: getSupportedThinkingLevels(m),
        ...(m.input.includes("image") ? { input: m.input } : {}),
      }));
  } catch {
    // Never return pi parser errors: they can include secret configuration values.
    result.error =
      "pi 配置读取失败；原文件未覆盖，请检查应用数据目录中的配置。";
    result.available = [];
  }
  return result;
}
