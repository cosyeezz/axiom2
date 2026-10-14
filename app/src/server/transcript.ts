import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { extname, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { AppError, attachmentDisplay, type ImageAttachment } from "../shared/protocol.js";
import { imageDisplayText, imagesInput } from "./images.js";
import type { ChatMessage } from "../shared/agent.js";
import { stripSessionTitle } from "./session-title.js";
import { compactionDisplay } from "./compaction-display.js";
import { thinkingDisplay } from "./thinking-display.js";
import { outputTruncated } from "./execution-outcome.js";
import { modelRequestError } from "./error-message.js";

export const toolKey = (runId: string, callId: string) =>
  `${runId}-${createHash("sha256").update(callId).digest("hex").slice(0, 24)}`;

// Only display fields cross IPC/WS. Error messages are bounded and credential-redacted;
// provider signatures and arbitrary diagnostic objects are not forwarded.
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
  // Display-only projection: keep native JSON and delivery identifiers untouched for the agent.
  if (message.role === "custom" && message.customType === "axiom-result") {
    const labels = {
      completed: "子代理已完成",
      cancelled: "子代理已取消",
      failed: "子代理执行失败",
      interrupted: "子代理执行中断",
    };
    let state: NonNullable<ChatMessage["taskNotice"]> = "unknown";
    let resultId: string | undefined;
    try {
      const payload = JSON.parse(text), status = payload?.status;
      if (typeof payload?.resultId === "string" && payload.resultId.length <= 200) resultId = payload.resultId;
      if (typeof status === "string" && Object.hasOwn(labels, status))
        state = status as keyof typeof labels;
    } catch { /* Legacy or malformed notices must never leak their raw payload. */ }
    return { id, role: "notice", text: state === "unknown" ? "收到子代理状态通知" : labels[state], taskNotice: state, ...(resultId ? { resultId } : {}) };
  }
  const imageBlocks = content.filter((c: any) => c.type === "image");
  const metadata = message.axiomImages ?? message.details?.images;
  const images: NonNullable<ChatMessage["images"]> = imageBlocks.map((c: any, i: number) => ({
    id: metadata?.[i]?.id ?? `imag${i + 1}`,
    name: metadata?.[i]?.name ?? `图片 ${i + 1}`,
    mimeType: c.mimeType,
  }));
  const isInput = message.role === "user" || (message.role === "custom" && message.customType === "axiom-append");
  // Inline mapping is the outer suffix when legacy inline and path attachments coexist.
  const display = isInput ? attachmentDisplay(imageDisplayText(text, imageBlocks.length)) : { text, attachments: [] };
  for (const attachment of display.attachments) if (attachment.kind === "image") {
    const mimeTypes: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
    images.push({ id: attachment.id!, name: attachment.name, path: attachment.path!,
      // A display hint only; files.preview detects actual bytes and enforces supported types.
      mimeType: mimeTypes[extname(attachment.path!).toLowerCase()] ?? "application/octet-stream" });
  }
  const assistantDisplay = message.role === "assistant"
    ? thinkingDisplay(stripSessionTitle(display.text, streaming), streaming)
    : { text: display.text, thinking: "", active: false };
  const thinking = [content
    .filter((c: any) => c.type === "thinking")
    .map((c: any) => c.thinking)
    .join("\n"), assistantDisplay.thinking].filter(Boolean).join("\n\n");
  const thinkingActive = message.role === "assistant" && streaming &&
    (assistantDisplay.active || content.at(-1)?.type === "thinking");
  return {
    id,
    // User-authored Steering/follow-up shares user presentation in live and history views.
    // Keep the native custom message unchanged; result notifications remain notices.
    role: isInput ? "user" : ["custom", "compactionSummary"].includes(message.role)
      ? "notice"
      : message.role,
    text: assistantDisplay.text,
    ...(images.length ? { images } : {}),
    ...(thinking ? { thinking } : {}),
    ...(thinkingActive ? { thinkingActive: true } : {}),
    streaming,
    ...(message.compression ? { compression: message.compression } : {}),
    inputIds: message.axiomInputIds ?? (message.details?.axiomInput ? [message.details.axiomInput] : undefined),
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
            : ["error", "length"].includes(message.stopReason)
              ? "failed"
              : message.stopReason === "aborted"
                ? "cancelled"
                : "completed",
          ...(message.stopReason === "length" ? { error: outputTruncated } : {}),
          ...(message.stopReason === "error"
            ? {
                error: modelRequestError(message.errorMessage),
              }
            : {}),
        }
      : {}),
    ...(message.role === "toolResult"
      ? {
          toolName: message.toolName,
          toolCallId: message.axiomRunId ? toolKey(message.axiomRunId, message.toolCallId) : message.toolCallId,
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
    // Validate ownership, then let pi handle its native JSONL recovery (including a partial tail).
    const header = JSON.parse(readFileSync(file, "utf8").split("\n", 1)[0]);
    if (
      header?.type !== "session" ||
      resolve(header?.cwd ?? "") !== resolve(cwd)
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
// One identity adapter for both metadata views and on-demand native image lookup.
function transcriptEntries(manager: SessionManager): { message: any; id: string }[] {
  return manager.buildSessionProjection().entries.flatMap(({ sourceEntry: entry, messages }) => {
    if (!messages.length) return [];
    if (entry.type === "compaction") return [{ message: { role: "compactionSummary", summary: entry.summary,
      compression: compactionDisplay(entry, manager.getBranch()) }, id: entry.id }];
    if (entry.type === "custom_message" && entry.display) {
      return [{
        message: messages[0],
        id: (entry.details as any)?.axiomInput ? `input-${(entry.details as any).axiomInput}` : entry.id,
      }];
    }
    if (entry.type !== "message") return [];
    const m = messages[0] as any;
    return [{ message: m, id: m.axiomId ?? (m.role === "toolResult" ? `tool-${m.toolCallId}` : entry.id) }];
  });
}
export function transcriptMessages(manager: SessionManager): ChatMessage[] {
  return transcriptEntries(manager).flatMap(({ message, id }) => {
    const converted = chatMessage(message, id);
    return converted ? [converted] : [];
  });
}
/** Read only a displayed native block from the bound current branch; never follow paths. */
export function transcriptImage(manager: SessionManager, messageId: string, imageId: string): ImageAttachment {
  const entry = transcriptEntries(manager).find(({ id }) => id === messageId);
  const view = entry && chatMessage(entry.message, entry.id);
  const images = view?.images?.filter((image) => !image.path) ?? [];
  const index = images.findIndex((image) => image.id === imageId);
  if (!entry || index < 0) throw new AppError("NOT_FOUND", "图片不存在或不属于此消息");
  const block = entry.message.content.filter((c: any) => c.type === "image")[index];
  // Reuse strict MIME/signature/base64 and per-image bounds; don't trust JSONL metadata.
  return imagesInput([{ ...images[index], data: block.data }])[0];
}
