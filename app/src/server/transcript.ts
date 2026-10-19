import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { extname, resolve } from "node:path";
import { SessionManager, buildSessionProjection } from "@earendil-works/pi-coding-agent";
import { AppError, attachmentDisplay, type ImageAttachment } from "../shared/protocol.js";
import { imageDisplayText, imagesInput } from "./images.js";
import type { ChatMessage } from "../shared/agent.js";
import { taskToolName } from "../shared/tasks.js";
import { toolPreview, toolSummary } from "../shared/tool-summary.js";
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
    ...(typeof message.axiomRunId === "string" ? { runId: message.axiomRunId } : {}),
    ...(message.role === "assistant" && message.axiomSelectionChange
      ? { selectionChange: message.axiomSelectionChange } : {}),
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
  const textCap = message.role === "toolResult" && !taskToolName(message.toolName ?? "") ? 320 : cap;
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  const calls = message.calls?.map((call) => ({ ...call,
    input: call.input.slice(0, taskToolName(call.name) ? cap : 512),
    inputLength: call.input.length, inputRevision: hash(call.input),
    summary: toolSummary(call),
  }));
  const truncated = message.text.length > textCap || (message.thinking?.length ?? 0) > 320 ||
    calls?.some((call) => call.input.length < call.inputLength);
  const textRevision = hash(message.text), thinkingRevision = hash(message.thinking ?? "");
  return {
    ...message,
    text: message.text.slice(0, textCap), textLength: message.text.length, textRevision,
    thinking: message.thinking?.slice(0, 320), thinkingLength: message.thinking?.length, thinkingRevision,
    calls,
    ...(message.role === "toolResult" ? { preview: toolPreview(message) } : {}),
    // Detect same-length edits beyond the preview and invalidate detail pages on live updates.
    detailsRevision: truncated ? hash(JSON.stringify([textRevision, thinkingRevision, calls?.map((call) => call.inputRevision)])) : undefined,
    truncated,
  };
}
/** Bounded ownership read; native body parsing and tail recovery remain pi's responsibility. */
export function transcriptHeader(file: string) {
  const fd = openSync(file, "r");
  try {
    const identity = fstatSync(fd);
    if (!identity.isFile()) throw Error("Not a regular session file");
    const chunks: Buffer[] = [];
    let bytesRead = 0;
    while (bytesRead < 64 * 1024) {
      const chunk = Buffer.allocUnsafe(1024);
      const size = readSync(fd, chunk, 0, chunk.length, null);
      if (!size) throw Error("Session header has no newline");
      bytesRead += size;
      const newline = chunk.subarray(0, size).indexOf(10);
      chunks.push(chunk.subarray(0, newline < 0 ? size : newline));
      if (newline >= 0) return { header: JSON.parse(Buffer.concat(chunks).toString("utf8")), identity, bytesRead };
    }
    throw Error("Session header exceeds 64 KiB");
  } finally { closeSync(fd); }
}
export function openTranscript(file: string, cwd: string): SessionManager {
  try {
    // Validate ownership, then let pi handle its native JSONL recovery (including a partial tail).
    const { header, identity } = transcriptHeader(file);
    if (header?.type !== "session" || typeof header.cwd !== "string" || resolve(header.cwd) !== resolve(cwd)) throw Error();
    const manager = SessionManager.open(file);
    const current = statSync(file);
    if (current.dev !== identity.dev || current.ino !== identity.ino || current.birthtimeMs !== identity.birthtimeMs) throw Error("Session replaced during read");
    return manager;
  } catch {
    throw new AppError(
      "SESSION_FILE_ERROR",
      "会话文件缺失、损坏或工作目录不符；原记录保留，未创建空会话替代。",
    );
  }
}
// One identity adapter for both metadata views and on-demand native image lookup.
function transcriptEntries(manager: SessionManager, original = false): { message: any; id: string; entryId: string }[] {
  // Ignore compaction boundaries for reading, while retaining native retry/context edits.
  // Only the active branch is eligible; abandoned branches and system records stay private.
  const projection = original
    ? buildSessionProjection(manager.getBranch().filter((entry) => entry.type !== "compaction")
      .map((entry, index, entries) => ({ ...entry, parentId: entries[index - 1]?.id ?? null })))
    : manager.buildSessionProjection();
  return projection.entries.flatMap(({ sourceEntry: entry, messages }) => {
    if (!messages.length) return [];
    if (entry.type === "compaction") return [{ message: { role: "compactionSummary", summary: entry.summary,
      compression: compactionDisplay(entry, manager.getBranch()) }, id: entry.id, entryId: entry.id }];
    if (entry.type === "custom_message" && entry.display) {
      return [{
        message: messages[0],
        id: (entry.details as any)?.axiomInput ? `input-${(entry.details as any).axiomInput}` : entry.id,
        entryId: entry.id,
      }];
    }
    if (entry.type !== "message") return [];
    const m = messages[0] as any;
    return [{ message: m, id: m.axiomId ?? (m.role === "toolResult" ? `tool-${m.toolCallId}` : entry.id), entryId: entry.id }];
  });
}
/** Only user-authored, currently visible inputs are eligible, including pre-compaction history. */
export function transcriptInput(manager: SessionManager, messageId: string) {
  const input = transcriptEntries(manager, true).find(({ id }) => id === messageId);
  if (!input || !(input.message.role === "user" || input.message.role === "custom" && input.message.customType === "axiom-append"))
    throw new AppError("NOT_EDITABLE", "消息不存在、已离开当前对话，或不是可编辑的用户消息。");
  return input;
}
export function transcriptMessages(manager: SessionManager, original = false): ChatMessage[] {
  return transcriptEntries(manager, original).flatMap(({ message, id }) => {
    const converted = chatMessage(message, id);
    return converted ? [converted] : [];
  });
}
/** Read only a displayed native block from the bound current branch; never follow paths. */
export function transcriptImage(manager: SessionManager, messageId: string, imageId: string, original = false): ImageAttachment {
  const entry = transcriptEntries(manager, original).find(({ id }) => id === messageId);
  const view = entry && chatMessage(entry.message, entry.id);
  const images = view?.images?.filter((image) => !image.path) ?? [];
  const index = images.findIndex((image) => image.id === imageId);
  if (!entry || index < 0) throw new AppError("NOT_FOUND", "图片不存在或不属于此消息");
  const block = entry.message.content.filter((c: any) => c.type === "image")[index];
  // Reuse strict MIME/signature/base64 and per-image bounds; don't trust JSONL metadata.
  return imagesInput([{ ...images[index], data: block.data }])[0];
}
