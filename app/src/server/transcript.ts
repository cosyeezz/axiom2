import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { AppError } from "../shared/protocol.js";
import type { ChatMessage } from "../shared/agent.js";

export const toolKey = (runId: string, callId: string) =>
  `${runId}-${createHash("sha256").update(callId).digest("hex").slice(0, 24)}`;

// Only display fields cross IPC/WS. Provider diagnostics, signatures and arbitrary details do not.
export function chatMessage(
  message: any,
  id: string,
  streaming = false,
): ChatMessage | null {
  if (
    ![
      "user",
      "assistant",
      "toolResult",
      "custom",
      "compactionSummary",
    ].includes(message.role)
  )
    return null;
  if (message.role === "custom" && !message.display) return null;
  const content =
    typeof message.content === "string"
      ? [{ type: "text", text: message.content }]
      : (message.content ?? []);
  const text =
    content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n") ||
    message.summary ||
    "";
  const thinking = content
    .filter((c: any) => c.type === "thinking")
    .map((c: any) => c.thinking)
    .join("\n");
  return {
    id,
    role: ["custom", "compactionSummary"].includes(message.role)
      ? "notice"
      : message.role,
    text,
    ...(thinking ? { thinking } : {}),
    streaming,
    ...(message.role === "assistant"
      ? {
          calls: content
            .filter((c: any) => c.type === "toolCall")
            .map((c: any) => ({
              id: message.axiomRunId ? toolKey(message.axiomRunId, c.id) : c.id,
              name: c.name,
              input: JSON.stringify(c.arguments, null, 2),
            })),
          status: streaming
            ? "running"
            : message.stopReason === "error"
              ? "failed"
              : message.stopReason === "aborted"
                ? "cancelled"
                : "completed",
          ...(message.stopReason === "error"
            ? {
                error:
                  "模型请求失败；请检查认证、额度、接口与网络。供应商原始错误未转发。",
              }
            : {}),
        }
      : {}),
    ...(message.role === "toolResult"
      ? {
          toolName: message.toolName,
          toolCallId: message.toolCallId,
          durationMs: message.durationMs,
          status: message.isError ? "failed" : "completed",
        }
      : {}),
  };
}
export function boundedMessage(message: ChatMessage): ChatMessage {
  const cap = 16000;
  return {
    ...message,
    text: message.text.slice(0, cap),
    thinking: message.thinking?.slice(0, cap),
    calls: message.calls?.map((c) => ({ ...c, input: c.input.slice(0, cap) })),
    truncated:
      message.text.length > cap ||
      (message.thinking?.length ?? 0) > cap ||
      message.calls?.some((c) => c.input.length > cap),
  };
}
export function openTranscript(file: string, cwd: string): SessionManager {
  try {
    // pi can recover partial files; product recovery must not silently treat damage as success.
    const lines = readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    if (
      lines[0]?.type !== "session" ||
      resolve(lines[0]?.cwd ?? "") !== resolve(cwd)
    )
      throw Error();
    return SessionManager.open(file);
  } catch {
    throw new AppError(
      "SESSION_FILE_ERROR",
      "会话文件缺失、损坏或工作目录不符；原记录保留，未创建空会话替代。",
    );
  }
}
export function transcriptMessages(manager: SessionManager): ChatMessage[] {
  const branch = manager.getBranch();
  const recorded = new Set(
    branch.flatMap((e) =>
      e.type === "message" ? [(e.message as any).axiomId] : [],
    ),
  );
  return branch.flatMap((entry): ChatMessage[] => {
    if (entry.type === "custom" && entry.customType === "axiom-request") {
      const data = entry.data as { runId: string; text: string };
      return !recorded.has(data.runId)
        ? [
            {
              id: data.runId,
              role: "user",
              text: data.text,
              error: "请求已受理，但尚未确认进入模型上下文。不会自动重新发送。",
            },
          ]
        : [];
    }
    if (entry.type === "custom_message" && entry.display) {
      const m = chatMessage(
        { role: "custom", content: entry.content, display: true },
        entry.id,
      );
      return m ? [m] : [];
    }
    if (entry.type !== "message") return [];
    const m = entry.message as any;
    const converted = chatMessage(
      m,
      m.axiomId ??
        (m.role === "toolResult" ? `tool-${m.toolCallId}` : entry.id),
    );
    return converted ? [converted] : [];
  });
}
