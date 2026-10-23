import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { TaskTool } from "../shared/tasks.js";

export function taskTools(
  call: (
    name: TaskTool,
    id: string,
    params: unknown,
    signal?: AbortSignal,
  ) => Promise<unknown>,
) {
  const execute =
    (name: TaskTool) =>
    async (id: string, params: unknown, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      const details = await call(name, id, params, signal);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(details) }],
        details,
      };
    };
  return [
    defineTool({
      name: "delegate",
      label: "委派子任务",
      description:
        "委派多个独立的异步任务，支持调研、分析、审查、测试、构建和静态检查。每项任务的交付正文不超过2000字，请据此拆分任务，确保能在此篇幅内交代结论和必要证据。",
      parameters: Type.Object(
        {
          context: Type.String({ description: "各任务共享的背景，不超过200字。子代理不了解主会话上下文：为什么委派这些任务，结果将用于什么？" }),
          tasks: Type.Array(
            Type.Object(
              {
                title: Type.String({ description: "概括该任务的核心目标，30字以内。" }),
                task: Type.String({ description: "该任务的具体委派内容。结合共同背景，子代理能否明确要做什么、有哪些约束、需要交付什么？" }),
              },
              { additionalProperties: false },
            ),
          ),
        },
        { additionalProperties: false },
      ),
      execute: execute("delegate"),
    }),
    defineTool({
      name: "append",
      label: "追问子任务",
      description:
        "向已有子任务追加要求，用于补充信息、调整方向或继续处理。已结束的子任务可继续执行；不用于查询进度。",
      parameters: Type.Object(
        {
          taskId: Type.String({ description: "需要追加要求的子任务 ID，取自 delegate 返回或完成通知。" }),
          summary: Type.String({ description: "概括本次追加的核心要求，不超过30字。" }),
          text: Type.String({ description: "本次追加的具体要求。结合原任务，子代理能否明确需要补充或调整什么、需要交付什么？" }),
        },
        { additionalProperties: false },
      ),
      execute: execute("append"),
    }),
    defineTool({
      name: "cancel_task",
      label: "停止子任务",
      description: "停止指定子任务，不影响其他任务。",
      parameters: Type.Object(
        {
          taskId: Type.String({ description: "需要停止的子任务 ID，取自 delegate 返回或完成通知。" }),
          reason: Type.Optional(Type.String({ description: "为什么需要停止该子任务？" })),
        },
        { additionalProperties: false },
      ),
      execute: execute("cancel_task"),
    }),
    defineTool({
      name: "read_result",
      label: "读取子任务结果",
      description: "读取子任务结果，可重复读取。",
      parameters: Type.Object(
        {
          taskId: Type.String({ description: "需要读取的子任务 ID，与 resultId 取自同一条完成通知。" }),
          resultId: Type.String({ description: "需要读取的结果 ID，与 taskId 取自同一条完成通知。" }),
        },
        { additionalProperties: false },
      ),
      execute: execute("read_result"),
    }),
  ];
}
