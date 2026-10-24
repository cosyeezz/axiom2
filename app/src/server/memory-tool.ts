import { defineTool } from "@earendil-works/pi-coding-agent";
import { memoryQueryDescription } from "../shared/memory-prompts.js";
import type { MemoryIncompleteReason, MemoryQueryResult } from "../shared/memory.js";
import { Type } from "typebox";
import { memoryDetail } from "./memory-detail.js";

const queryIssues: Record<NonNullable<MemoryQueryResult["reason"]> | MemoryIncompleteReason, string> = {
  unavailable: "查询暂不可用",
  timeout: "查询超时",
  revision_conflict: "来源已变化，结果未发布",
  read_failed: "资料读取失败",
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

export function memoryDetailTool(entry: () => string | undefined) {
  return defineTool({ name: "memory_detail", label: "记忆详情",
    description: "写入或读取本会话单条详情，每次只处理一个编号。新建由工具分配编号并挂到主项；不手写编号或边界。更新先读取取得revision，可提交content整块替换，或oldText/newText唯一匹配局部替换。新建必须提供anchor（入口中唯一的完整标题/事项行）及entryRevision（入口内容SHA-256，可用bash计算）；已有详情重新关联需id、revision及这两个字段，可省略content保持详情不变。修订冲突重新读取，不强行覆盖。失败若提示详情已保存但未关联，先read该编号，再用返回revision、entryRevision及anchor重新关联，不重复创建。",
    parameters: Type.Object({ action: Type.Union([Type.Literal("read"), Type.Literal("write")]),
      id: Type.Optional(Type.Integer({ minimum: 1, description: "read必填；write省略则新建" })),
      content: Type.Optional(Type.String({ description: "write的完整详情正文，不含受管标记" })),
      revision: Type.Optional(Type.String({ description: "更新已有详情必填，来自最近一次read/write返回值" })),
      oldText: Type.Optional(Type.String({ minLength: 1 })), newText: Type.Optional(Type.String()),
      anchor: Type.Optional(Type.String({ description: "主文档内唯一的完整标题或事项原文，不含换行" })),
      entryRevision: Type.Optional(Type.String({ description: "关联主项时必填，当前MEMORY.md的SHA-256" })),
    }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      const path = entry();
      if (!path) throw Error("本会话记忆不可用");
      const details = memoryDetail(path, params, signal);
      return { content: [{ type: "text", text: JSON.stringify(details) }], details };
    } });
}

export function memoryQueryTool(call: (id: string, params: unknown, signal?: AbortSignal) => Promise<unknown>) {
  return defineTool({ name: "memory_query", label: "查询记忆",
    description: memoryQueryDescription,
    parameters: Type.Object({ topic: Type.String({ minLength: 1 }), question: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
    execute: async (id, params, signal) => {
      const details = await call(id, params, signal);
      // Only content enters the model context; keep audit metadata in details.
      return { content: [{ type: "text", text: queryText(details) }], details };
    } });
}
