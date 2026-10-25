import { join } from "node:path";
import { rtkDirectory } from "./rtk-config.js";
import { runTool, type ToolRunOptions } from "./tool-process.js";
import { componentEnvironment, prepareComponentEnvironment } from "./component-environment.js";
export { assertToolProcessesStopped } from "./tool-process.js";

export type RtkRun = (file: string, args: string[], options: Omit<ToolRunOptions, "cwd" | "beforeStart">) => Promise<Buffer>;
export const runRtk: RtkRun = async (file, args, options) => {
  options.signal?.throwIfAborted();
  const directory = rtkDirectory(options.root), state = join(directory, "environment");
  prepareComponentEnvironment(state);
  const result = await runTool(file, args, { ...options, errorOutput: options.errorOutput ?? (options.output === "tail" ? "tail" : "structured"), env: {
    ...componentEnvironment(state, { ...process.env, ...options.env }), NO_COLOR: "1", RTK_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1", RTK_RECALL: "0", RTK_TEE: "0",
    RTK_DB_PATH: join(directory, "upstream.db"), RTK_RECALL_DB: join(directory, "upstream-recall.db"),
  } });
  if (result.code !== 0) throw Error("程序执行失败，请检查输入和安装状态。");
  return result.stdout;
};
