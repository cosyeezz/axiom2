import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { Selection } from "../shared/agent.js";
import { ModelService } from "./model-service.js";
import { openTranscript } from "./transcript.js";
import { compactionInstructions } from "./compaction-display.js";
import { compressionError } from "./compression-error.js";

export interface CompressionInput {
  root: string;
  cwd: string;
  file: string;
  modelsFile: string;
  selection: Selection;
}
let session: AgentSession | undefined,
  cancelled = false,
  started = false;
const send = (value: unknown) => {
  if (process.connected) process.send?.(value);
};
process.on("disconnect", () => process.exit(1));
process.on("message", (event: any) => {
  if (event.type === "stop") {
    cancelled = true;
    session?.abortCompaction();
  }
  if (event.type === "start" && !started) {
    started = true;
    void run(event.input);
  }
});
async function run(input: CompressionInput) {
  try {
    const runtime = await new ModelService(input.root).runtime(
      input.modelsFile,
    );
    const model = runtime.getModel(
      input.selection.provider,
      input.selection.id,
    );
    const configurationError = runtime.getError();
    // Parser diagnostics may echo arbitrary secret configuration values.
    if (configurationError) throw Error("压缩模型配置读取失败，请检查供应商配置；原配置未修改。");
    if (!model) throw Error("所选压缩模型不可用，请检查供应商与模型配置。");
    // Snapshot-only summarization: no project resources, extension hooks or coding tools.
    const settingsManager = SettingsManager.inMemory({
      cacheWarming: "off",
      compaction: { enabled: false, keepRecentTokens: 0 },
    });
    const resourceLoader = new DefaultResourceLoader({
      cwd: input.cwd,
      agentDir: join(input.root, "pi"),
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: "",
      appendSystemPrompt: [],
    });
    await resourceLoader.reload();
    ({ session } = await createAgentSession({
      cwd: input.cwd,
      agentDir: join(input.root, "pi"),
      modelRuntime: runtime,
      model,
      thinkingLevel: input.selection.thinking,
      settingsManager,
      resourceLoader,
      sessionManager: openTranscript(input.file, input.cwd),
      noTools: "all",
    }));
    if (session.thinkingLevel !== input.selection.thinking)
      throw Error("压缩模型未能使用所选思考等级，请重新选择模型设置。");
    session.subscribe((event) => {
      if (event.type === "compaction_start") send({ type: "phase" });
    });
    if (cancelled) return send({ type: "cancelled" });
    // Pi 1.1.0 drops customInstructions in generateTurnPrefixSummary (split turns).
    // This session only compacts snapshots: include the same requirement in every
    // native summary request, without another model call or persisted chat message.
    const stream = session.agent.streamFunction;
    session.agent.streamFunction = (model, context, options) => stream(model, {
      ...context,
      messages: [...context.messages, { role: "user", content: compactionInstructions, timestamp: Date.now() }],
    }, options);
    const result = await session.compact(compactionInstructions);
    const entry = session.sessionManager.getLeafEntry();
    if (entry?.type !== "compaction") throw Error("pi 未生成有效的原生压缩记录，摘要未应用。");
    send({
      type: "completed",
      entry,
      summary: result.summary,
      before: result.tokensBefore,
      after: result.estimatedTokensAfter ?? null,
      usage:
        result.usage && result.usage.totalTokens > 0
          ? {
              input: result.usage.input,
              output: result.usage.output,
              total: result.usage.totalTokens,
              cost:
                result.usage.cost.total > 0 ? result.usage.cost.total : null,
            }
          : null,
    });
  } catch (error) {
    send(cancelled ? { type: "cancelled" } : { type: "failed", error: compressionError(error) });
  } finally {
    session?.dispose();
    if (process.connected)
      process.send?.({ type: "closed" }, () => process.exit(0));
    else process.exit(0);
  }
}
