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
  const brief = Type.String({ minLength: 1, maxLength: 30, pattern: "^(?![\\s\\S]*[\\r\\n\\u0000])(?=[\\s\\S]*\\S)[\\s\\S]+$", description: "单行核心目标，最多30个字符（含英文、数字和标点），不要填写任务正文。" });
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
        "异步委派 1–8 个独立子任务，用于调研、分析、审查或执行测试、构建和静态检查。独立测试优先并行委派。context 必须给出背景，每项 title 用不超过30字概括核心目标并作为卡片标题，task 给出完整目标、范围和交付要求；测试任务应注明工作目录、命令或测试范围、前置条件及独立端口／输出路径。子代理可用 read、grep、find、ls 和平台命令工具，可产生测试产物；不得修改源码、测试代码、配置、锁文件或基准快照、安装依赖或加载外部扩展。代码修改由主代理完成。测试返回实际命令、退出码、关键输出、产物路径及未验证项。返回 taskIds、排队状态和预算，不等待结果。子任务结束后收到 taskId/runId/resultId 通知，再用 read_result 读取；不要轮询。子代理不能继续委派。",
      parameters: Type.Object(
        {
          context: text,
          tasks: Type.Array(
            Type.Object(
              {
                title: brief,
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
        "补充本主会话所属调研或测试子任务，summary 用不超过30字概括本次追加目标，text 保留完整要求；原任务标题保持不变。追问不能提升权限，代码修改仍由主代理执行。steer（默认且唯一模式）在 pi 安全边界送达；停止中追加会等待旧执行退出后自动启动新执行，再次停止会撤销待续接要求。结束后追问沿用同一子会话并创建新执行。受理运行中追加后刷新工作时限；总结中追加会恢复工作并刷新时限。工作到期进入无工具总结，总结超过 3 分钟强停；不要用作进度查询。",
      parameters: Type.Object(
        {
          taskId: id,
          summary: brief,
          text,
          mode: Type.Optional(StringEnum(["steer"])),
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
        "读取完成通知指定的不可变结果，必须同时传 taskId 与 resultId。可重复读取，无副作用；不是任务进度查询工具。结果完整保存，单页最多 16,000 字符；truncated 为 true 时用 nextOffset 继续读取同一 resultId，直至结束。reportKind 区分最终回复、部分成果和系统事实。",
      parameters: Type.Object(
        { taskId: id, resultId: id, offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 16000 })) },
        { additionalProperties: false },
      ),
      execute: execute("read_result"),
    }),
  ];
}
