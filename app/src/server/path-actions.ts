import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AppError, text, type Command } from "../shared/protocol.js";
import type { Store } from "./storage.js";
import { FileManagerError, type FileManager } from "./file-manager.js";
import { Terminal, TerminalError } from "./terminal.js";

/** UI-only navigation and terminal launch; path contents are never executed. */
export class PathActions {
  constructor(private readonly store: Store, private readonly manager: Pick<FileManager, "open">, private readonly terminal: Pick<Terminal, "open"> = new Terminal()) {}
  resolve(c: Command): string {
    const p = c.params ?? {};
    if (Object.keys(p).some(key => key !== "path") || !["paths.resolve", "paths.reveal", "paths.terminal"].includes(c.op))
      throw new AppError("INVALID_INPUT", "路径操作无效");
    text(p.path, "本地路径", 4096);
    let path = p.path as string;
    if (/[\x00-\x1f\x7f]/.test(path)) throw new AppError("INVALID_INPUT", "本地路径无效");
    if (/^file:\/\//i.test(path)) {
      try {
        const url = new URL(path);
        if (url.search || url.hash) throw Error();
        path = fileURLToPath(url);
      } catch { throw new AppError("INVALID_INPUT", "本地文件链接无效"); }
    }
    if (/^~[\\/]/.test(path)) path = resolve(homedir(), path.slice(2));
    if (!isAbsolute(path)) {
      if (/^[a-z][a-z\d+.-]*:/i.test(path)) throw new AppError("INVALID_INPUT", "仅支持本地文件路径");
      const workspace = this.store.workspace(text(c.workspaceId, "工作空间"));
      if (!workspace.authorized) throw new AppError("AUTHORIZATION_REQUIRED", "请先授权工作空间文件访问");
      path = resolve(workspace.path, path);
    }
    if (path.length > 4096 || /[\x00-\x1f\x7f]/.test(path)) throw new AppError("INVALID_INPUT", "本地路径无效");
    return path;
  }
  async command(c: Command, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const path = this.resolve(c);
    if (c.op === "paths.terminal") {
      try { await this.terminal.open(path, signal); }
      catch (error) {
        if (error instanceof TerminalError) throw new AppError("TERMINAL_UNAVAILABLE", error.message);
        throw error;
      }
    } else if (c.op === "paths.reveal") {
      signal.throwIfAborted();
      let directory: string, selection: string | undefined;
      try {
        const folder = (await stat(path)).isDirectory();
        directory = folder ? path : dirname(path);
        if (!folder) selection = path;
      }
      catch (error) {
        // Configuration files may not exist until the first save. Show their parent.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new AppError("PATH_UNAVAILABLE", "路径无法访问");
        directory = dirname(path);
      }
      try { await this.manager.open(directory, signal, selection); }
      catch (error) {
        if (error instanceof FileManagerError) throw new AppError("PATH_UNAVAILABLE", error.message);
        throw error;
      }
    }
    return path;
  }
}
