import { randomUUID, randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import type { Store } from "../storage.js";
import type { Tasks } from "../tasks.js";
import {
  AppError,
  object,
  text,
  type Command,
  type Scope,
} from "../../shared/protocol.js";
import type { Preview } from "../../shared/preview.js";
import { contained, gateway } from "./gateway.js";
import { PreviewProcesses, type ProjectProcess } from "./processes.js";
import { Annotations } from "./annotations.js";

export type PreviewView = Preview & { binding: string };
type Live = {
  view: PreviewView;
  close: () => Promise<void>;
  process?: ProjectProcess;
};
export class Previews {
  private live = new Map<string, Live>();
  private tail: Promise<unknown> = Promise.resolve();
  private closing = false;
  private processes: PreviewProcesses;
  private annotations: Annotations;
  constructor(
    private readonly store: Store,
    private readonly tasks: Tasks,
    private readonly origin: () => string,
  ) {
    this.processes = new PreviewProcesses(store);
    this.annotations = new Annotations(store, tasks);
  }
  list(scope: Scope) {
    this.store.session(scope.workspaceId, scope.sessionId);
    return [...this.live.values()]
      .filter(
        (x) =>
          x.view.workspaceId === scope.workspaceId &&
          x.view.sessionId === scope.sessionId,
      )
      .map((x) => ({ ...x.view }));
  }
  private own(scope: Scope, id: unknown) {
    const live = this.live.get(text(id, "预览标识"));
    if (
      !live ||
      live.view.workspaceId !== scope.workspaceId ||
      live.view.sessionId !== scope.sessionId
    )
      throw new AppError("PREVIEW_SCOPE", "预览已关闭或不属于此会话");
    return live;
  }
  // Only lifecycle mutations serialize; page requests and other product regions do not.
  private serial<T>(operation: () => Promise<T>) {
    const job = this.tail.then(operation);
    this.tail = job.catch(() => {});
    return job;
  }
  async command(c: Command): Promise<unknown> {
    const scope = {
        workspaceId: text(c.workspaceId, "工作空间"),
        sessionId: text(c.sessionId, "会话"),
      },
      p = object(c.params ?? {});
    this.store.session(scope.workspaceId, scope.sessionId);
    if (c.op === "preview.list") return this.list(scope);
    if (c.op === "preview.cleanup.get")
      return this.processes.pending(scope.workspaceId);
    if (c.op === "annotation.list") return this.annotations.list(scope);
    if (c.op === "annotation.receipt")
      return this.annotations.receipt(scope, text(p.requestId, "请求标识"));
    return this.serial(async () => {
      if (this.closing) throw new AppError("PREVIEW_CLOSED", "服务正在退出");
      this.store.session(scope.workspaceId, scope.sessionId);
      return this.store.external(c, async () => {
        if (c.op === "preview.cleanup.confirm") {
          if (p.confirmed !== true)
            throw new AppError(
              "CONFIRMATION_REQUIRED",
              "需先核实并结束残留项目进程",
            );
          this.processes.confirm(scope.workspaceId, p.ids);
          return { confirmed: true };
        }
        if (c.op === "preview.open") return this.open(scope, p);
        const live = this.own(scope, p.previewId);
        if (c.op === "preview.close") {
          await this.stop(live);
          return {
            closed: live.view.id,
            cleanup: live.process ? "unconfirmed" : "confirmed",
          };
        }
        if (c.op === "preview.refresh") {
          if (live.view.status !== "running")
            throw new AppError("PREVIEW_CLOSED", "预览已停止，请重新打开");
          live.view.revision = randomUUID();
          return { ...live.view };
        }
        if (c.op === "annotation.send")
          return this.annotations.send(c, live.view);
        throw new AppError("UNKNOWN_OPERATION", "预览操作无效");
      });
    });
  }
  private async open(scope: Scope, p: Record<string, unknown>) {
    if (p.authorized !== true)
      throw new AppError(
        "AUTHORIZATION_REQUIRED",
        "需授权项目预览；页面脚本和启动命令可以执行项目代码",
      );
    if (this.live.size >= 4)
      throw new AppError(
        "PREVIEW_LIMIT",
        "最多同时打开 4 个预览，请先关闭不用的实例",
      );
    if (p.mode !== "static" && p.mode !== "server")
      throw new AppError("INVALID_INPUT", "预览模式无效");
    const directory = await contained(
      this.store.workspace(scope.workspaceId).path,
      text(p.directory, "预览相对目录", 2000),
    );
    if (!(await stat(directory)).isDirectory())
      throw new AppError("PREVIEW_PATH", "预览路径必须是目录");
    const id = randomUUID(),
      binding = randomBytes(24).toString("hex");
    const handle =
      p.mode === "server"
        ? await this.processes.start(scope, id, directory, p)
        : undefined;
    const view: PreviewView = {
      ...scope,
      id,
      binding,
      url: "",
      origin: "",
      directory,
      revision: randomUUID(),
      mode: p.mode,
      status: "running",
    };
    try {
      const server = await gateway({
        id,
        binding,
        directory,
        parentOrigin: this.origin(),
        revision: () => view.revision,
        upstream: handle?.port,
      });
      Object.assign(view, { url: server.url, origin: server.origin });
      const live: Live = { view, close: server.close, process: handle };
      this.live.set(id, live);
      handle?.child.once("close", () => {
        if (!this.live.has(id)) return;
        this.live.delete(id);
        this.processes.interrupted(id);
        view.status = "stopped";
        void server.close();
      });
      if (
        handle &&
        (handle.child.exitCode !== null || handle.child.signalCode !== null)
      ) {
        await this.stop(live);
        throw new AppError(
          "PREVIEW_START",
          "项目服务已退出，请检查启动命令和端口；清理需核实",
        );
      }
      return { ...view };
    } catch (error) {
      if (handle) await this.processes.stop(id, handle);
      throw error;
    }
  }
  private async stop(live: Live) {
    this.live.delete(live.view.id);
    live.view.status = "stopped";
    await live.close();
    if (live.process) await this.processes.stop(live.view.id, live.process);
  }
  remove(c: Command) {
    // Lock order matches annotation.send: preview lifecycle first, model writer second.
    // Keep deletion inside both locks so no new preview/prompt can slip into a removed session.
    return this.serial(() =>
      this.tasks.agents.models.serial(async () => {
        if (this.store.receipt(c.requestId).status === "committed")
          return this.tasks.remove(c);
        if (c.params?.confirmed !== true)
          throw new AppError("CONFIRMATION_REQUIRED", "删除会话需要确认");
        const scope = { workspaceId: c.workspaceId!, sessionId: c.sessionId! };
        this.store.session(scope.workspaceId, scope.sessionId);
        const sessions = new Set([
          scope.sessionId,
          ...this.tasks.list(scope).tasks.map((task) => task.sessionId),
        ]);
        for (const live of [...this.live.values()])
          if (
            live.view.workspaceId === scope.workspaceId &&
            sessions.has(live.view.sessionId)
          )
            await this.stop(live);
        if (this.processes.pending(scope.workspaceId).length)
          throw new AppError(
            "CLEANUP_UNCONFIRMED",
            "预览进程清理待核实；请检查并确认后再删除会话",
          );
        return this.tasks.remove(c);
      }),
    );
  }
  async close() {
    this.closing = true;
    await this.serial(() =>
      Promise.allSettled([...this.live.values()].map((x) => this.stop(x))),
    );
  }
}
