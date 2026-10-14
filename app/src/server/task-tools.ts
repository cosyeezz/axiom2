import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
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
  const text = Type.String({ minLength: 1, maxLength: 12000 }),
    id = Type.String({ minLength: 1, maxLength: 200 });
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
        "异步委派 1–8 个独立只读调研子任务，用于调查、分析和审查，不用于实施修改。context 必须给出背景，task 给出目标、范围和交付要求。子代理仅有 read、grep、find、ls，不能修改文件、执行 shell 或加载外部扩展；所有修改与命令验证由主代理完成。返回 taskIds、排队状态和预算，不等待结果。子任务结束后收到 taskId/runId/resultId 通知，再用 read_result 读取；不要轮询。子代理不能继续委派。",
      parameters: Type.Object(
        {
          context: text,
          tasks: Type.Array(
            Type.Object(
              {
                task: text,
                systemPrompt: Type.Optional(
                  Type.String({ minLength: 1, maxLength: 4000 }),
                ),
              },
              { additionalProperties: false },
            ),
            { minItems: 1, maxItems: 8 },
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
        "补充本主会话所属只读调研子任务，追问不能提升权限，修改仍由主代理执行。steer（默认）在 pi 安全边界送达，followUp 在当前工作结束后送达。结束后追问沿用同一子会话并创建新执行。追加不延长本次预算；不要用作进度查询。",
      parameters: Type.Object(
        {
          taskId: id,
          text,
          mode: Type.Optional(StringEnum(["steer", "followUp"])),
        },
        { additionalProperties: false },
      ),
      execute: execute("append"),
    }),
    defineTool({
      name: "cancel_task",
      label: "停止子任务",
      description:
        "直接强制停止指定子任务，其他任务不受影响，不再请求模型总结。返回受理回执，已有结果经完成通知读取；停止不回滚文件或外部副作用。",
      parameters: Type.Object(
        {
          taskId: id,
          reason: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
        },
        { additionalProperties: false },
      ),
      execute: execute("cancel_task"),
    }),
    defineTool({
      name: "read_result",
      label: "读取子任务结果",
      description:
        "读取完成通知指定的不可变结果，必须同时传 taskId 与 resultId。可重复读取，无副作用；不是任务进度查询工具。结果正文最多 16,000 字符，完整过程在子会话中。",
      parameters: Type.Object(
        { taskId: id, resultId: id },
        { additionalProperties: false },
      ),
      execute: execute("read_result"),
    }),
  ];
}
