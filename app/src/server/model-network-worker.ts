import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CredentialSynchronizationError, readStoredCredential } from "@earendil-works/pi-coding-agent";
import { queryProviderUsage } from "./provider-usage.js";
import { ensureModelProvider } from "./model-runtime.js";
import { ModelService } from "./model-service.js";
import { AppError } from "../shared/protocol.js";
import { configureModelNetwork } from "./integrations/model-proxy-env.js";

let active: { id: string; controller: AbortController } | undefined;
const prompts = new Map<string, (answer: string) => void>();
const send = (value: unknown) => { if (process.connected) process.send?.(value); };
process.on("disconnect", () => { active?.controller.abort(); process.exit(0); });
process.on("message", (message: any) => {
  if (message.type === "cancel" && active && active.id === message.id) { active.controller.abort(); return; }
  if (message.type === "answer" && active?.id === message.id) { prompts.get(message.promptId)?.(message.answer); return; }
  if (message.type !== "request" || active) return;
  const controller = new AbortController(); active = { id: message.id, controller };
  void run(message, controller.signal).then(value => send({ type: "result", id: message.id, value }), error => send({
    type: "error", id: message.id, credentialSync: error instanceof CredentialSynchronizationError,
    code: error instanceof AppError ? error.code : "MODEL_NETWORK_FAILED",
    message: error instanceof AppError ? error.message : controller.signal.aborted ? "模型网络操作已取消或超时。" : "模型网络请求失败，请检查代理、线路和供应商配置。",
  })).finally(() => { active = undefined; prompts.clear(); });
});
async function run(message: any, signal: AbortSignal) {
  const { root, provider, modelsPath, payload, op, id } = message;
  configureModelNetwork(root, modelsPath, provider);
  const models = new ModelService(root);
  if (op === "catalog") return models.catalog(provider, payload.revision, signal);
  if (op === "usage") return queryProviderUsage(provider, readStoredCredential(provider, join(models.dir, "auth.json")), signal);
  const runtime = await models.runtime(modelsPath);
  await ensureModelProvider(runtime, provider);
  if (runtime.getError()) throw new AppError("CONFIG_READ_FAILED", "模型配置未通过校验。");
  if (op === "checkAuth") return runtime.checkAuth(provider, { signal });
  if (op === "prepareAuth") {
    const model = runtime.getModel(provider, payload.modelId);
    // Auth resolution may rotate OAuth under the SDK credential-store lock.
    // Never send its token, headers or credential back across IPC.
    return !!(model && await runtime.getAuth(model, { signal, minOAuthValidityMs: 330_000 }));
  }
  if (op === "available") return runtime.getAvailable(provider, { signal });
  if (op === "logout") { await runtime.logout(provider); await runtime.removeRuntimeApiKey(provider); return; }
  let supplied = false;
  const result = await runtime.login(provider, op === "storeKey" ? "api_key" : payload.type, {
    signal,
    notify: event => { if (op === "login") send({ type: "notify", id, event }); },
    prompt: async prompt => {
      if (op === "storeKey") {
        if (supplied || prompt.type !== "secret") throw new AppError("AUTH_INTERACTION_REQUIRED", "此供应商需要额外认证步骤，请使用单独登录流程。");
        supplied = true; return payload.key;
      }
      const promptId = randomUUID();
      const promptSignal = prompt.signal ? AbortSignal.any([signal, prompt.signal]) : signal;
      return new Promise<string>((resolve, reject) => {
        const abort = () => { prompts.delete(promptId); reject(new DOMException("认证已取消", "AbortError")); };
        if (promptSignal.aborted) { abort(); return; }
        promptSignal.addEventListener("abort", abort, { once: true });
        prompts.set(promptId, answer => { prompts.delete(promptId); promptSignal.removeEventListener("abort", abort); resolve(answer); });
        const { signal: _signal, ...serializable } = prompt;
        send({ type: "prompt", id, promptId, prompt: serializable });
      });
    },
  }, { agentName: "Axiom2", getDeviceId: () => {
    const file = join(root, "installation-id");
    try { return readFileSync(file, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; const value = randomUUID(); writeFileSync(file, value, { flag: "wx", mode: 0o600 }); return value; }
  } });
  return result;
}
