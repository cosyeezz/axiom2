import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
export function memoryQueryTool(call: (id: string, params: unknown, signal?: AbortSignal) => Promise<unknown>) {
  return defineTool({ name: "memory_query", label: "查询记忆",
    description: "同步查询当前工作空间的历史工作、决定、问题处理和验证经验。延续既有任务时先读取本会话 MEMORY.md；仅当跨会话证据缺失且确有必要时调用一次本工具。新问题已有当前证据时不强制查询。内部只读 pi Agent 按需读取摘要、详细资料和允许的引用文件，返回事实、来源修订、背景、覆盖范围和未确认项。不读原始对话，不执行脚本，不递归委派。读取本会话 MEMORY.md 直接用 read，压缩后重读不调用本工具。",
    parameters: Type.Object({ question: Type.String({ minLength: 1, maxLength: 8000 }) }, { additionalProperties: false }),
    execute: async (id, params, signal) => {
      const details = await call(id, params, signal);
      return { content: [{ type: "text", text: JSON.stringify(details) }], details };
    } });
}
