import { defineTool } from "@earendil-works/pi-coding-agent";
import { memoryQueryDescription } from "../shared/memory-prompts.js";
import type { MemoryIncompleteReason, MemoryQueryResult } from "../shared/memory.js";
import { Type } from "typebox";

const queryIssues: Record<NonNullable<MemoryQueryResult["reason"]> | MemoryIncompleteReason, string> = {
  unavailable: "查询暂不可用",
  timeout: "查询超时",
  revision_conflict: "来源已变化，结果未发布",
  read_failed: "资料读取失败",
  locator_invalid: "原目的定位已失效，未猜测来源",
  read_limit: "读取达到上限",
  turn_limit: "查询轮数达到上限",
  output_limit: "结果长度达到上限",
  model_output_limit: "模型输出达到上限",
};
function queryText(details: unknown): string {
  const result = details as Partial<MemoryQueryResult> | null;
  if (!result || typeof result.answer !== "string" || typeof result.incomplete !== "boolean")
    throw Error("记忆查询返回格式无效");
  const answer = result.answer.trim();
  if (result.incomplete || result.reason || result.incompleteReason) {
    const reason = result.reason ?? result.incompleteReason;
    const issue = reason && Object.hasOwn(queryIssues, reason) ? queryIssues[reason] : "未获得完整结果";
    return `记忆查询未完成：${issue}。${answer ? `\n\n部分结果：\n${answer}` : ""}`;
  }
  return answer || "未找到相关记忆。";
}

export function memoryQueryTool(call: (id: string, params: unknown, signal?: AbortSignal) => Promise<unknown>) {
  return defineTool({ name: "memory_query", label: "查询记忆",
    description: memoryQueryDescription,
    parameters: Type.Object({ question: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
    execute: async (id, params, signal) => {
      const details = await call(id, params, signal);
      // Only content enters the model context; keep audit metadata in details.
      return { content: [{ type: "text", text: queryText(details) }], details };
    } });
}
