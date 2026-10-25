import { join } from "node:path";
import { componentEnvironment, prepareComponentEnvironment } from "./component-environment.js";
import { runTool, type ToolRunOptions } from "./tool-process.js";

export type NativeRunOptions = Omit<ToolRunOptions, "cwd" | "beforeStart"> & { environmentDirectory?: string };
/** Native components share supervision, never RTK-specific settings or databases. */
export async function runNative(file: string, args: string[], options: NativeRunOptions): Promise<Buffer> {
  options.signal?.throwIfAborted();
  const { environmentDirectory = join(options.root, "environment"), ...runOptions } = options;
  prepareComponentEnvironment(environmentDirectory);
  const env = componentEnvironment(environmentDirectory, { ...process.env, ...options.env });
  const result = await runTool(file, args, { ...runOptions, env,
    errorOutput: options.errorOutput ?? (options.output === "tail" ? "tail" : "structured") });
  if (result.code !== 0) throw Error("程序执行失败，请检查输入和安装状态。");
  return result.stdout;
}
