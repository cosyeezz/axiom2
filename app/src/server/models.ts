import { providerProxyUrl, readProviderProxy } from "./integrations/model-proxy-env.js";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createModelRuntime } from "./model-runtime.js";
import { executionModelsRaw } from "./execution-model-config.js";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { Configuration } from "../shared/protocol.js";

/** Model discovery is advisory metadata, never execution admission. */
export async function configuration(root: string): Promise<Configuration> {
  const dir = process.env.AXIOM_PI_DIR || join(root, "pi");
  const result: Configuration = { revision: "", providerCount: 0, modelCount: 0, available: [], dataRoot: root };
  const warning = () => { result.warning = "部分供应商的配置或连接检查未完成；其他供应商不受影响，请检查对应模型、代理与认证设置。"; };
  let directory: string | undefined;
  try {
    const read = async (name: string, fallback: string) => {
      try { return await readFile(join(dir, name), "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback; throw error; }
    };
    const raw = await read("models.json", '{"providers":{}}');
    result.revision = createHash("sha256").update(raw).digest("hex");
    const config = JSON.parse(raw.replace(/^\uFEFF/, ""));
    if (!config || !config.providers || typeof config.providers !== "object" || Array.isArray(config.providers)) throw Error();
    let credentialIds: string[] = [];
    try { credentialIds = Object.keys(JSON.parse(await read("auth.json", "{}"))); } catch { warning(); }
    const providers = [...new Set([...Object.keys(config.providers), ...credentialIds])];
    result.providerCount = providers.length;
    directory = await mkdtemp(join(tmpdir(), "axiom-model-directory-"));
    const snapshots = directory;
    const counts = await Promise.all(providers.map(async (provider, index) => {
      try {
        const definition = config.providers[provider];
        if (definition !== undefined && (!definition || typeof definition !== "object" || Array.isArray(definition))) throw Error();
        const path = join(snapshots, `${index}.json`);
        await writeFile(path, executionModelsRaw(raw, provider), { flag: "wx", mode: 0o600 });
        const runtime = await createModelRuntime({ providerIds: [provider], providerScope: provider, metadataOnly: true,
          authPath: join(dir, "auth.json"), modelsPath: path, modelsStorePath: join(dir, "models-store.json"), allowModelNetwork: false });
        if (runtime.getError()) throw Error(); // This runtime contains only this provider's custom definition.
        const allowed = new Set<string>();
        for (const model of definition?.models ?? []) allowed.add(model.id);
        for (const id of Object.keys(definition?.modelOverrides ?? {})) allowed.add(id);
        if (!allowed.size) for (const model of runtime.getModels(provider)) allowed.add(model.id);
        const credentials = await runtime.listCredentials();
        let available;
        try {
          providerProxyUrl(root, readProviderProxy(path, provider));
          available = await runtime.getAvailable(provider, { signal: AbortSignal.timeout(10000) });
        } catch {
          warning();
          available = credentials.some(item => item.providerId === provider) ? runtime.getModels(provider) : [];
        }
        result.available.push(...available.filter(model => allowed.has(model.id)).map(model => ({
          provider: model.provider, providerName: definition?.name || runtime.getProvider(provider)?.name || provider,
          id: model.id, name: model.name, levels: getSupportedThinkingLevels(model),
          ...(model.input.includes("image") ? { input: model.input } : {}),
        })));
        return allowed.size;
      } catch { warning(); return 0; }
    }));
    result.modelCount = counts.reduce((a, b) => a + b, 0);
    // Preserve deterministic provider/model order regardless of asynchronous catalog checks.
    const order = new Map(providers.map((provider, index) => [provider, index]));
    result.available.sort((a, b) => order.get(a.provider)! - order.get(b.provider)!);
  } catch {
    // A structurally unreadable document cannot be safely split. This affects
    // discovery only; history, resource reload and explicit requests remain independent.
    result.error = "pi 配置读取失败；原文件未覆盖，请检查应用数据目录中的配置。";
  } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
  return result;
}
