import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import { CredentialSynchronizationError } from "@earendil-works/pi-coding-agent";
import { ModelService } from "./model-service.js";
import { AppError, text } from "../shared/protocol.js";
import type { AuthState } from "../shared/models.js";
import { openAuthBrowser } from "./auth-browser.js";

type Flow = {
  owner: object;
  controller: AbortController;
  state: AuthState;
  operation?: Promise<void>;
  opening?: Promise<{ opened: true }>;
  pending?: {
    id: string;
    resolve: (answer: string) => void;
    options?: readonly { id: string }[];
    type: AuthPrompt["type"];
  };
};
function safeUrl(value: string) {
  const url = new URL(value);
  if (
    value.length > 16000 ||
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw Error("invalid auth URL");
  return value;
}
export class Logins {
  private flows = new Map<string, Flow>();
  private running = new Set<Promise<unknown>>();
  private disconnected = new WeakSet<object>();
  constructor(
    private models: ModelService,
    private publish: (owner: object, state: AuthState) => void,
    private changed: () => Promise<void>,
    private openBrowser = openAuthBrowser,
  ) {}
  get(owner: object, id: string) {
    const flow = this.flows.get(id);
    if (!flow || flow.owner !== owner)
      throw new AppError(
        "AUTH_SCOPE_MISMATCH",
        "认证流程不属于当前连接或已过期",
      );
    return flow;
  }
  async start(
    owner: object,
    provider: unknown,
    type: unknown,
    revision: unknown,
  ) {
    if (this.models.authActive)
      throw new AppError("AUTH_BUSY", "已有认证流程，请先完成或取消");
    const providerId = text(provider, "供应商 ID", 160);
    if (type !== "api_key" && type !== "oauth")
      throw new AppError("INVALID_INPUT", "认证方式无效");
    // Set before awaiting so concurrent starts/saves cannot cross the login boundary.
    this.models.authActive = true;
    try {
      const {
        config,
        runtime,
        revision: current,
      } = await this.models.serial(() => this.models.load());
      if (this.disconnected.has(owner))
        throw new AppError("AUTH_CANCELLED", "连接已关闭，未启动认证");
      if (revision !== current)
        throw new AppError("REVISION_CONFLICT", "配置已改变，请重新读取后认证");
      if (!Object.hasOwn(config.providers, providerId) && type !== "oauth")
        throw new AppError("NOT_FOUND", "请先发布自定义供应商配置");
      const method =
        type === "oauth"
          ? runtime.getProvider(providerId)?.auth.oauth
          : runtime.getProvider(providerId)?.auth.apiKey;
      if (!method?.login)
        throw new AppError("AUTH_UNSUPPORTED", "该供应商不支持所选认证方式");
      const id = randomUUID(),
        controller = new AbortController();
      const flow: Flow = {
        owner,
        controller,
        state: {
          id,
          providerId,
          status: "running",
          message: "正在启动 pi 认证…",
        },
      };
      for (const [key, old] of this.flows)
        if (old.owner === owner && old.state.status !== "running")
          this.flows.delete(key);
      this.flows.set(id, flow);
      const send = () => this.publish(owner, { ...flow.state });
      const timeout = setTimeout(() => controller.abort(), 10 * 60_000);
      const prompt = (p: AuthPrompt) =>
        new Promise<string>((resolve, reject) => {
          const promptId = randomUUID(),
            signal = p.signal
              ? AbortSignal.any([p.signal, controller.signal])
              : controller.signal;
          const abort = () => {
            if (flow.pending?.id === promptId) {
              flow.pending = undefined;
              flow.state.prompt = undefined;
              send();
            }
            reject(new DOMException("认证已取消", "AbortError"));
          };
          if (signal.aborted) {
            abort();
            return;
          }
          signal.addEventListener("abort", abort, { once: true });
          flow.pending = {
            id: promptId,
            type: p.type,
            options: p.type === "select" ? p.options : undefined,
            resolve: (answer) => {
              signal.removeEventListener("abort", abort);
              flow.pending = undefined;
              flow.state.prompt = undefined;
              send();
              resolve(answer);
            },
          };
          flow.state.message = "请完成 pi 认证提示；输入仅发送到本地服务。";
          flow.state.prompt = {
            id: promptId,
            type: p.type,
            message: p.message.slice(0, 1000),
            ...(p.type !== "select" && p.placeholder ? { placeholder: p.placeholder.slice(0, 1000) } : {}),
            ...(p.type === "select"
              ? {
                  options: p.options.map((o) => ({ id: o.id, label: o.label })),
                }
              : {}),
          };
          send();
        });
      const notify = (event: AuthEvent) => {
        if (controller.signal.aborted) return;
        if (event.type === "auth_url") flow.state.url = safeUrl(event.url);
        if (event.type === "device_code") {
          flow.state.url = safeUrl(event.verificationUri);
          flow.state.userCode = event.userCode.slice(0, 200);
        }
        // Provider errors/progress can include credential material. Do not forward arbitrary text.
        flow.state.message =
          "按 pi 认证提示完成登录；关闭或取消会终止当前流程。";
        send();
      };
      const devicePath = join(this.models.root, "installation-id");
      const operation = runtime
        .login(
          providerId,
          type,
          { signal: controller.signal, prompt, notify },
          {
            agentName: "Axiom2",
            getDeviceId: () => {
              try {
                return readFileSync(devicePath, "utf8");
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                  throw error;
                const value = randomUUID();
                writeFileSync(devicePath, value, { flag: "wx", mode: 0o600 });
                return value;
              }
            },
          },
        )
        .then(async () => {
          const persisted = await this.models.runtime();
          if (!(await persisted.listCredentials()).some((c) => c.providerId === providerId && c.type === type))
            throw new CredentialSynchronizationError(providerId, "login", undefined, { cause: Error("Credential not persisted") });
          flow.state.status = "completed";
          flow.state.message = "pi 已保存认证；这不代表模型调用已验证。";
        })
        .catch((error) => {
          flow.state.status = "failed";
          flow.state.message =
            error instanceof CredentialSynchronizationError
              ? "认证已改变，但目录同步失败；请重新读取，勿重复登录。"
              : controller.signal.aborted
                ? "认证已取消或超时；若供应商刚完成回调，请重新读取确认认证状态。"
                : "pi 认证未完成；请检查供应商配置后重试。";
        })
        .finally(async () => {
          clearTimeout(timeout);
          flow.pending = undefined;
          flow.state.prompt = undefined;
          flow.state.url = undefined;
          flow.state.userCode = undefined;
          this.models.authActive = false;
          await this.changed().catch(() => {
            flow.state.message += " 目录刷新失败，请重新读取。";
          });
          if (this.flows.has(id)) send();
        });
      flow.operation = operation;
      this.running.add(operation);
      void operation.finally(() => this.running.delete(operation));
      return { id, status: "accepted" };
    } catch (error) {
      this.models.authActive = false;
      throw error;
    }
  }
  open(owner: object, id: string) {
    const flow = this.get(owner, id);
    if (flow.state.status !== "running" || flow.controller.signal.aborted || !flow.state.url)
      throw new AppError("AUTH_EXPIRED", "授权链接已失效，请重新登录。");
    if (flow.opening) return flow.opening;
    flow.opening = this.openBrowser(safeUrl(flow.state.url), flow.controller.signal)
      .then(() => ({ opened: true as const }))
      .catch(() => { throw new AppError("BROWSER_OPEN_FAILED", "无法打开系统浏览器，请复制授权链接手动打开。"); })
      .finally(() => { flow.opening = undefined; });
    return flow.opening;
  }
  answer(owner: object, id: string, promptId: unknown, answer: unknown) {
    const flow = this.get(owner, id);
    if (
      !flow.pending ||
      flow.pending.id !== promptId ||
      flow.state.status !== "running"
    )
      throw new AppError("AUTH_STALE_PROMPT", "认证问题已完成或失效");
    if (typeof answer !== "string" || answer.length > 8192 || answer.includes("\0"))
      throw new AppError("INVALID_INPUT", "认证输入无效（最多 8192 字符）");
    // Text prompts may deliberately accept blank (e.g. Copilot's default github.com domain).
    const value = flow.pending.type === "text" ? answer.trim() : text(answer, "认证输入", 8192);
    if (
      flow.pending.type === "secret" &&
      (value.startsWith("!") || /^[*•●]+$/.test(value) || /[\r\n]/.test(value))
    )
      throw new AppError(
        "INVALID_INPUT",
        "密钥不能是掩码或包含换行；命令型密钥请在配置页明确授权保存。",
      );
    if (
      flow.pending.options &&
      !flow.pending.options.some((o) => o.id === value)
    )
      throw new AppError("INVALID_INPUT", "请选择有效认证选项");
    flow.pending.resolve(value);
    return { accepted: true };
  }
  async cancel(owner: object, id: string) {
    const flow = this.get(owner, id);
    flow.controller.abort();
    await flow.operation;
    return { cancelled: true };
  }
  disconnect(owner: object) {
    this.disconnected.add(owner);
    for (const [id, flow] of this.flows)
      if (flow.owner === owner) {
        flow.controller.abort();
        this.flows.delete(id);
      }
  }
  async close() {
    for (const flow of this.flows.values()) flow.controller.abort();
    await Promise.allSettled(this.running);
    this.flows.clear();
  }
}
