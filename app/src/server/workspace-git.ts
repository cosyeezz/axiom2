import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import type { GitBranchInfo } from "../shared/git.js";
import { AppError, text, type Command } from "../shared/protocol.js";
import type { Store } from "./storage.js";

const exec = promisify(execFile);

/** Git resolves nested directories, linked worktrees and unborn branches itself. */
export async function readGitBranch(path: string, signal: AbortSignal): Promise<GitBranchInfo | null> {
  signal.throwIfAborted();
  // A server launched from another checkout must not inherit its repository overrides.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")));
  const directories = (env.PATH ?? env.Path ?? "").split(delimiter).filter(isAbsolute);
  let executable: string | undefined;
  for (const directory of new Set(directories)) {
    const candidate = join(directory, process.platform === "win32" ? "git.exe" : "git");
    try { await access(candidate, constants.X_OK); executable = candidate; break; }
    catch { /* Only explicit absolute PATH entries; never run a project-local git. */ }
  }
  signal.throwIfAborted();
  if (!executable) return null;
  const run = async (args: string[]) => (await exec(executable, args, {
    cwd: path, env: { ...env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8", timeout: 2000, maxBuffer: 16 * 1024, windowsHide: true, signal,
  })).stdout.replace(/[\r\n]+$/, "");
  try {
    const ref = await run(["symbolic-ref", "--quiet", "HEAD"]);
    return ref.startsWith("refs/heads/") && ref.length > 11 ? { name: ref.slice(11), detached: false } : null;
  } catch (error) {
    signal.throwIfAborted();
    // Exit 1 means detached HEAD; other failures include non-Git and unavailable paths.
    if ((error as { code?: unknown }).code !== 1) return null;
    try {
      const name = await run(["rev-parse", "--verify", "--short", "HEAD"]);
      return /^[a-f\d]{4,64}$/i.test(name) ? { name, detached: true } : null;
    } catch { signal.throwIfAborted(); return null; }
  }
}

export class WorkspaceGit {
  constructor(private readonly store: Store) {}
  async command(c: Command, signal: AbortSignal): Promise<GitBranchInfo | null> {
    if (c.op !== "git.branch" || c.sessionId !== undefined || Object.keys(c.params ?? {}).length)
      throw new AppError("INVALID_INPUT", "Git 分支读取仅接受工作空间标识");
    const workspace = this.store.workspace(text(c.workspaceId, "工作空间标识"));
    if (!workspace.authorized) throw new AppError("AUTHORIZATION_REQUIRED", "请先授权工作空间文件访问");
    return readGitBranch(workspace.path, signal);
  }
}
