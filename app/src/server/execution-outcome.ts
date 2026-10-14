import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Run } from "../shared/agent.js";
import { modelRequestError } from "./error-message.js";

export const outputTruncated = "输出达到模型长度限制，任务尚未完成；可继续处理。";
/** Only messages emitted by this execution may decide its outcome. */
export function executionOutcome(messages: readonly AgentMessage[], cancelled: boolean, aborted: boolean, started = false) : Pick<Run, "status" | "error" | "reasonCode"> {
  if (cancelled) return { status: "cancelled", error: null, reasonCode: "USER_STOPPED" };
  const last = messages.findLast((message) => message.role === "assistant");
  if (aborted || last?.stopReason === "aborted")
    return { status: "interrupted", error: "执行意外中断；未自动重做。", reasonCode: "EXECUTION_ABORTED" };
  if (last?.stopReason === "error")
    return { status: "failed", error: modelRequestError(last.errorMessage), reasonCode: "MODEL_ERROR" };
  if (last?.stopReason === "length")
    return { status: "failed", error: outputTruncated, reasonCode: "OUTPUT_TRUNCATED" };
  if (last?.stopReason === "toolUse")
    return { status: "interrupted", error: "工具阶段结束后尚未取得最终回复；请核对已有操作再继续。", reasonCode: "INCOMPLETE_TOOL_TURN" };
  if (!last && started)
    return { status: "interrupted", error: "执行未产生可确认的模型回复。", reasonCode: "MISSING_REPLY" };
  // An extension command may handle input without producing an assistant. It must
  // not inherit the previous execution's success/failure or trigger a replay.
  return { status: "completed", error: null, reasonCode: last ? null : "HANDLED_WITHOUT_REPLY" };
}
