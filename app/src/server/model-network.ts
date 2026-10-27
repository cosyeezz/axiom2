import { fork, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import { CredentialSynchronizationError } from "@earendil-works/pi-coding-agent";
import { AppError } from "../shared/protocol.js";
import { providerProxyUrl, readProviderProxy } from "./integrations/model-proxy-env.js";

export const inModelNetworkWorker = process.env.AXIOM_MODEL_NETWORK_WORKER === "1";
export type NetworkOperation = "catalog" | "login" | "storeKey" | "checkAuth" | "prepareAuth" | "available" | "logout" | "usage";
type Callbacks = { signal?: AbortSignal; prompt?: (prompt: AuthPrompt) => Promise<string>; notify?: (event: AuthEvent) => void };
type Request = { id: string; op: NetworkOperation; resolve: (value: any) => void; reject: (error: unknown) => void; callbacks: Callbacks; cleanup: () => void; cancelled: boolean; abort: () => void };
type Slot = { child: ChildProcess; request?: Request; tail: Promise<unknown>; idle?: ReturnType<typeof setTimeout>; key: string; root: string; exiting: boolean; exited: Promise<void> };
const slots = new Map<string, Slot>(), live = new Set<Slot>();
function dispose(slot: Slot) {
  clearTimeout(slot.idle);
  if (slots.get(slot.key) === slot) slots.delete(slot.key);
  if (slot.exiting) return;
  slot.exiting = true;
  if (slot.child.exitCode !== null || slot.child.signalCode !== null) return;
  slot.child.kill("SIGTERM");
  const force = setTimeout(() => slot.child.kill("SIGKILL"), 1500); force.unref();
  void slot.exited.then(() => clearTimeout(force));
}
function send(slot: Slot, value: unknown) {
  if (!slot.child.connected || slot.exiting) { dispose(slot); return; }
  slot.child.send(value as any, error => { if (error) dispose(slot); });
}
export async function modelNetwork<T = any>(root: string, dir: string, provider: string, modelsPath: string, op: NetworkOperation, payload: Record<string, unknown> = {}, callbacks: Callbacks = {}): Promise<T> {
  const cancelled = () => new AppError("MODEL_NETWORK_CANCELLED", "模型网络操作已取消或超时。");
  if (callbacks.signal?.aborted) throw cancelled();
  const url = providerProxyUrl(root, readProviderProxy(modelsPath, provider));
  let configRevision = "missing";
  try { configRevision = createHash("sha256").update(readFileSync(modelsPath)).digest("hex"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const key = JSON.stringify([root, dir, provider, url ?? "direct", configRevision]);
  let slot = slots.get(key);
  if (!slot) {
    const ts = import.meta.url.endsWith(".ts");
    const child = fork(fileURLToPath(new URL(`./model-network-worker.${ts ? "ts" : "js"}`, import.meta.url)), [], {
      env: { ...process.env, AXIOM_PI_DIR: dir, AXIOM_MODEL_NETWORK_WORKER: "1" },
      execArgv: ts ? ["--import", import.meta.resolve("tsx")] : [], stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    let finish!: () => void;
    slot = { child, key, root, tail: Promise.resolve(), exiting: false, exited: new Promise<void>(resolve => { finish = resolve; }) };
    slots.set(key, slot); live.add(slot);
    const owned = slot;
    child.on("message", (message: any) => {
      const request = owned.request;
      if (!request || request.id !== message?.id) return;
      if (message.type === "prompt") {
        if (!request.callbacks.prompt) { request.abort(); return; }
        void Promise.resolve().then(() => request.callbacks.prompt!({ ...message.prompt, signal: request.callbacks.signal })).then(
          answer => { if (owned.request === request && !request.cancelled) send(owned, { type: "answer", id: request.id, promptId: message.promptId, answer }); },
          () => request.abort());
      } else if (message.type === "notify") {
        try { request.callbacks.notify?.(message.event); } catch { request.abort(); }
      } else if (message.type === "result" || message.type === "error") {
        request.cleanup(); owned.request = undefined;
        if (request.cancelled) request.reject(new AppError("MODEL_NETWORK_CANCELLED", "模型网络操作已取消或超时。"));
        else if (message.type === "result") request.resolve(message.value);
        else request.reject(message.credentialSync ? new CredentialSynchronizationError(provider, request.op === "logout" ? "logout" : "login", undefined, {})
          : new AppError(message.code ?? "MODEL_NETWORK_FAILED", message.message ?? "模型网络请求失败，请检查代理和供应商配置。"));
        owned.idle = setTimeout(() => { if (!owned.request) dispose(owned); }, 30_000); owned.idle.unref();
      }
    });
    const failed = () => {
      const request = owned.request; owned.request = undefined;
      request?.cleanup(); request?.reject(new AppError(request.cancelled ? "MODEL_NETWORK_CANCELLED" : "MODEL_NETWORK_FAILED", request.cancelled ? "模型网络操作已取消或超时。" : "模型网络进程已退出，请检查代理后重试。"));
      clearTimeout(owned.idle); owned.exiting = true;
      if (slots.get(key) === owned) slots.delete(key);
      live.delete(owned); finish();
    };
    child.once("exit", failed);
    child.once("error", () => { if (!child.pid) failed(); else dispose(owned); });
  }
  const owned = slot;
  let entered = false;
  const result = owned.tail.then(() => new Promise<T>((resolve, reject) => {
    entered = true;
    if (callbacks.signal?.aborted) { reject(cancelled()); return; }
    if (owned.exiting || !owned.child.connected) { reject(new AppError("MODEL_NETWORK_FAILED", "模型网络进程已关闭，请重试。")); return; }
    clearTimeout(owned.idle);
    const id = randomUUID();
    let cancellation: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      if (owned.request?.id !== id || owned.request.cancelled) return;
      owned.request.cancelled = true;
      send(owned, { type: "cancel", id });
      cancellation = setTimeout(() => dispose(owned), 2000);
    };
    const timeout = setTimeout(abort, op === "login" ? 10 * 60_000 : 30_000);
    owned.request = { id, op, resolve, reject, callbacks, cancelled: false, abort, cleanup: () => { clearTimeout(timeout); clearTimeout(cancellation); callbacks.signal?.removeEventListener("abort", abort); } };
    callbacks.signal?.addEventListener("abort", abort, { once: true });
    send(owned, { type: "request", id, root, dir, provider, modelsPath, op, payload });
  }));
  owned.tail = result.catch(() => {});
  const signal = callbacks.signal;
  if (!signal) return result;
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      // Queued work has no side effects to settle. Active credential operations
      // retain their lock until the worker acknowledges cancellation or exits.
      if (!entered) { signal.removeEventListener("abort", abort); reject(cancelled()); }
    };
    signal.addEventListener("abort", abort, { once: true });
    result.then(value => { signal.removeEventListener("abort", abort); resolve(value); },
      error => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort();
  });
}
export async function closeModelNetworks(root: string) {
  const owned = [...live].filter(slot => slot.root === root);
  for (const slot of owned) dispose(slot);
  await Promise.all(owned.map(slot => slot.exited));
}
