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
    if (!model || runtime.getError()) throw Error();
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
    if (session.thinkingLevel !== input.selection.thinking) throw Error();
    session.subscribe((event) => {
      if (event.type === "compaction_start") send({ type: "phase" });
    });
    if (cancelled) return send({ type: "cancelled" });
    const result = await session.compact();
    send({
      type: "completed",
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
  } catch {
    send({ type: cancelled ? "cancelled" : "failed" });
  } finally {
    session?.dispose();
    if (process.connected)
      process.send?.({ type: "closed" }, () => process.exit(0));
    else process.exit(0);
  }
}
