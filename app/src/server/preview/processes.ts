import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import type { Store } from "../storage.js";
import { AppError, text, type Scope } from "../../shared/protocol.js";

export type ProjectProcess = { child: ChildProcess; exited: Promise<void> };
// Arbitrary project commands have no cooperative shutdown acknowledgement. Killing a
// process tree is bounded, but requires explicit cleanup verification, never PID replay.
export class PreviewProcesses {
  constructor(private readonly store: Store) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS preview_processes(
      id TEXT PRIMARY KEY,workspaceId TEXT NOT NULL,sessionId TEXT NOT NULL,
      pid INTEGER,state TEXT NOT NULL,command TEXT NOT NULL);
      UPDATE preview_processes SET state='unconfirmed' WHERE state='running'`);
  }
  pending(workspaceId: string) {
    return this.store.db
      .prepare(
        "SELECT id,pid,command FROM preview_processes WHERE workspaceId=? AND state='unconfirmed'",
      )
      .all(workspaceId);
  }
  confirm(workspaceId: string, ids: unknown) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 32)
      throw new AppError("INVALID_INPUT", "请选择已经检查的进程记录");
    const keys = ids.map((id) => text(id, "进程记录"));
    for (const id of keys)
      if (
        !this.store.db
          .prepare(
            "SELECT 1 FROM preview_processes WHERE id=? AND workspaceId=? AND state='unconfirmed'",
          )
          .get(id, workspaceId)
      )
        throw new AppError("PREVIEW_STALE", "进程记录已变化，请重新读取");
    for (const id of keys)
      this.store.db
        .prepare("UPDATE preview_processes SET state='confirmed' WHERE id=?")
        .run(id);
  }
  async start(
    scope: Scope,
    id: string,
    directory: string,
    p: Record<string, unknown>,
  ) {
    if (this.pending(scope.workspaceId).length)
      throw new AppError(
        "CLEANUP_UNCONFIRMED",
        "上次预览进程清理待核实，请检查后确认再启动",
      );
    if (
      !Number.isInteger(p.port) ||
      Number(p.port) < 1024 ||
      Number(p.port) > 65535
    )
      throw new AppError("INVALID_INPUT", "项目服务端口须为 1024–65535");
    const port = Number(p.port),
      executable = text(p.executable, "启动程序", 2000);
    if (!Array.isArray(p.args) || p.args.length > 32)
      throw new AppError("INVALID_INPUT", "启动参数须为最多 32 项的数组");
    const args = p.args.map((a) => text(a, "启动参数", 4000));
    const probe = createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once("error", () =>
        reject(new AppError("PORT_BUSY", "端口已使用；不会代理非本实例的服务")),
      );
      probe.listen(port, "127.0.0.1", () => probe.close(() => resolve()));
    });
    this.store.db
      .prepare("INSERT INTO preview_processes VALUES(?,?,?,NULL,'running',?)")
      .run(
        id,
        scope.workspaceId,
        scope.sessionId,
        JSON.stringify({ executable, args, directory, port }),
      );
    const child = spawn(
      executable === "node" ? process.execPath : executable,
      args,
      {
        cwd: directory,
        stdio: "ignore",
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        env: { ...process.env, PORT: String(port) },
      },
    );
    const exited = new Promise<void>((resolve) =>
      child.once("close", () => resolve()),
    );
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      this.store.db
        .prepare("UPDATE preview_processes SET pid=? WHERE id=?")
        .run(child.pid!, id);
      return { child, exited, port };
    } catch {
      if (child.pid) await this.stop(id, { child, exited });
      else
        this.store.db
          .prepare("UPDATE preview_processes SET state='confirmed' WHERE id=?")
          .run(id);
      throw new AppError("PREVIEW_START", "预览进程未启动，请检查程序与参数");
    }
  }
  interrupted(id: string) {
    this.store.db
      .prepare(
        "UPDATE preview_processes SET state='unconfirmed' WHERE id=? AND state='running'",
      )
      .run(id);
  }
  async stop(id: string, processHandle: ProjectProcess) {
    this.interrupted(id);
    const { child, exited } = processHandle;
    if (!child.pid || child.exitCode !== null || child.signalCode !== null)
      return;
    const kill = (force: boolean) => {
      if (process.platform === "win32") {
        const helper = spawn(
          join(
            process.env.SystemRoot ?? "C:\\Windows",
            "System32",
            "taskkill.exe",
          ),
          [...(force ? ["/F"] : []), "/T", "/PID", String(child.pid)],
          { stdio: "ignore", windowsHide: true },
        );
        helper.on("error", () => child.kill());
        const timeout = setTimeout(() => helper.kill(), 2000);
        helper.once("close", () => clearTimeout(timeout));
      } else
        try {
          process.kill(-child.pid!, force ? "SIGKILL" : "SIGTERM");
        } catch {
          child.kill(force ? "SIGKILL" : "SIGTERM");
        }
    };
    kill(false);
    let timer: ReturnType<typeof setTimeout>;
    await Promise.race([
      exited,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 2000);
      }),
    ]);
    clearTimeout(timer!);
    if (child.exitCode === null && child.signalCode === null) {
      kill(true);
      await Promise.race([
        exited,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 3000);
        }),
      ]);
      clearTimeout(timer!);
    }
  }
}
