import { closeSync, fstatSync, openSync, readSync, statSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { extname, resolve } from "node:path";
import { SessionManager, buildSessionProjection } from "@earendil-works/pi-coding-agent";
import { AppError, attachmentDisplay } from "../shared/protocol.js";
import { persistedSkillInput } from "../shared/skills.js";
import { imageDisplayText, imagesInput } from "./images.js";
import { taskToolName } from "../shared/tasks.js";
import { taskCallPreview, toolPreview, toolSummary } from "../shared/tool-summary.js";
import { stripSessionTitle } from "./session-title.js";
import { compactionDisplay } from "./compaction-display.js";
import { thinkingDisplay } from "./thinking-display.js";
import { outputTruncated } from "./execution-outcome.js";
import { modelRequestError } from "./error-message.js";
import { taskDisplayText } from "./task-output.js";
function displayPhase(message, content, streaming) {
    if (message.role !== "assistant" || content.some(c => c.type === "toolCall") ||
        ["error", "aborted", "length"].includes(message.stopReason))
        return undefined;
    // Responses starts at pending and marks explicit final_answer at text_start,
    // before it writes textSignature at text_end. Other APIs cannot use this hint.
    if (streaming && message.stopReason === "stop" &&
        ["openai-responses", "openai-codex-responses", "azure-openai-responses"].includes(message.api))
        return "final_answer";
    for (const block of [...content].reverse()) {
        if (block.type !== "text" || typeof block.textSignature !== "string")
            continue;
        try {
            const signature = JSON.parse(block.textSignature);
            if (signature?.v === 1 && typeof signature.id === "string" &&
                (signature.phase === "commentary" || signature.phase === "final_answer"))
                return signature.phase;
        }
        catch { /* Opaque signatures are not display metadata. */ }
    }
    return !streaming && message.stopReason === "stop" ? "final_answer" : undefined;
}
export const toolKey = (runId, callId) => `${runId}-${createHash("sha256").update(callId).digest("hex").slice(0, 24)}`;
// Only display fields cross IPC/WS. Error messages are bounded and credential-redacted;
// provider signatures and arbitrary diagnostic objects are not forwarded.
export function chatMessage(message, id, streaming = false) {
    if (![
        "user",
        "assistant",
        "toolResult",
        "custom",
        "compactionSummary",
    ].includes(message.role))
        return null;
    if (message.role === "custom" && !message.display)
        return null;
    const content = typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : (message.content ?? []);
    const text = taskDisplayText(message.role === "toolResult" ? message.toolName : "", message.details, message.isError) ?? (content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n") ||
        message.summary ||
        "");
    // Internal result notifications remain in the native transcript for the agent,
    // including legacy payloads, but are not conversation UI messages.
    if (message.role === "custom" && message.customType === "axiom-result")
        return null;
    const imageBlocks = content.filter((c) => c.type === "image");
    const metadata = message.axiomImages ?? message.details?.images;
    const images = imageBlocks.map((c, i) => ({
        id: metadata?.[i]?.id ?? `imag${i + 1}`,
        name: metadata?.[i]?.name ?? `图片 ${i + 1}`,
        mimeType: c.mimeType,
    }));
    const isInput = message.role === "user" || (message.role === "custom" && message.customType === "axiom-append");
    // Inline mapping is the outer suffix when legacy inline and path attachments coexist.
    const skillInput = isInput ? persistedSkillInput(message) : undefined;
    const taskInputText = message.role === "custom" && message.customType === "axiom-append" && typeof message.details?.taskInputText === "string"
        ? message.details.taskInputText : text;
    const display = isInput ? attachmentDisplay(imageDisplayText(skillInput?.text ?? taskInputText, imageBlocks.length)) : { text, attachments: [] };
    for (const attachment of display.attachments)
        if (attachment.kind === "image") {
            const mimeTypes = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
            images.push({ id: attachment.id, name: attachment.name, path: attachment.path,
                // A display hint only; files.preview detects actual bytes and enforces supported types.
                mimeType: mimeTypes[extname(attachment.path).toLowerCase()] ?? "application/octet-stream" });
        }
    const assistantDisplay = message.role === "assistant"
        ? thinkingDisplay(stripSessionTitle(display.text, streaming), streaming)
        : { text: display.text, thinking: "", active: false };
    const thinking = [content
            .filter((c) => c.type === "thinking")
            .map((c) => c.thinking)
            .join("\n"), assistantDisplay.thinking].filter(Boolean).join("\n\n");
    const thinkingActive = message.role === "assistant" && streaming &&
        (assistantDisplay.active || content.at(-1)?.type === "thinking");
    const phase = displayPhase(message, content, streaming);
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
        ...(phase ? { phase } : {}),
        ...(skillInput ? { skills: skillInput.skills } : {}),
        ...(images.length ? { images } : {}),
        ...(display.attachments.length ? { attachments: display.attachments.map(({ id, kind, name, path }) => ({ id, kind, name, path })) } : {}),
        ...(thinking ? { thinking } : {}),
        ...(thinkingActive ? { thinkingActive: true } : {}),
        streaming,
        ...(message.compression ? { compression: message.compression } : {}),
        inputIds: message.axiomInputIds ?? (message.details?.axiomInput ? [message.details.axiomInput] : undefined),
        ...(message.role === "assistant"
            ? {
                calls: content
                    .filter((c) => c.type === "toolCall")
                    .map((c) => ({
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
export function boundedMessage(message) {
    const cap = 16000;
    const textCap = message.role === "toolResult" && !taskToolName(message.toolName ?? "") ? 320 : cap;
    const hash = (text) => createHash("sha256").update(text).digest("hex");
    const calls = message.calls?.map((call) => ({ ...call,
        input: call.input.slice(0, taskToolName(call.name) ? cap : 512),
        inputLength: call.input.length, inputRevision: hash(call.input),
        summary: toolSummary(call),
        taskPreview: taskCallPreview(call),
    }));
    const truncated = message.text.length > textCap || (message.thinking?.length ?? 0) > 320 ||
        calls?.some((call) => call.input.length < call.inputLength);
    const textRevision = hash(message.text), thinkingRevision = hash(message.thinking ?? "");
    const { deliveryTiming: _timing, ...projection } = message;
    let thinkingTail;
    if (message.thinkingActive && message.streaming && (message.thinking?.length ?? 0) > 320) {
        let start = Math.max(0, Math.floor((message.thinking.length - 512) / 256) * 256);
        const code = message.thinking.charCodeAt(start);
        if (code >= 0xdc00 && code <= 0xdfff)
            start++;
        thinkingTail = message.thinking.slice(start);
    }
    return {
        ...projection,
        text: message.text.slice(0, textCap), textLength: message.text.length, textRevision,
        thinking: message.thinking?.slice(0, 320), thinkingLength: message.thinking?.length, thinkingRevision,
        // Advance in chunks so streaming appends do not reflow the tail's start on every token.
        // At most 767 code units; completed/history previews retain their existing prefix only.
        thinkingTail,
        calls,
        ...(message.role === "toolResult" ? { preview: toolPreview(message) } : {}),
        // Detect same-length edits beyond the preview and invalidate detail pages on live updates.
        detailsRevision: truncated ? hash(JSON.stringify([textRevision, thinkingRevision, calls?.map((call) => call.inputRevision)])) : undefined,
        truncated,
    };
}
/** Bounded ownership read; native body parsing and tail recovery remain pi's responsibility. */
export function transcriptHeader(file) {
    const fd = openSync(file, "r");
    try {
        const identity = fstatSync(fd);
        if (!identity.isFile())
            throw Error("Not a regular session file");
        const chunks = [];
        let bytesRead = 0;
        while (bytesRead < 64 * 1024) {
            const chunk = Buffer.allocUnsafe(1024);
            const size = readSync(fd, chunk, 0, chunk.length, null);
            if (!size)
                throw Error("Session header has no newline");
            bytesRead += size;
            const newline = chunk.subarray(0, size).indexOf(10);
            chunks.push(chunk.subarray(0, newline < 0 ? size : newline));
            if (newline >= 0)
                return { header: JSON.parse(Buffer.concat(chunks).toString("utf8")), identity, bytesRead };
        }
        throw Error("Session header exceeds 64 KiB");
    }
    finally {
        closeSync(fd);
    }
}
export function openTranscript(file, cwd, options = {}) {
    try {
        // Validate ownership, then let pi handle its native JSONL recovery (including a partial tail).
        const { header, identity } = transcriptHeader(file);
        if (header?.type !== "session" || typeof header.cwd !== "string")
            throw Error();
        // Resolve OS aliases natively: Windows short names and macOS /var aliases
        // must identify the same real workspace, without case-folding path strings.
        if (resolve(header.cwd) !== resolve(cwd) && realpathSync.native(header.cwd) !== realpathSync.native(cwd))
            throw Error();
        const manager = options.readOnly ? SessionManager.inMemory(cwd) : SessionManager.open(file);
        // Keep native recovery/migration in memory for statistics-only readers.
        if (options.readOnly)
            manager.setSessionFile(file);
        const current = statSync(file);
        if (current.dev !== identity.dev || current.ino !== identity.ino || current.birthtimeMs !== identity.birthtimeMs)
            throw Error("Session replaced during read");
        return manager;
    }
    catch {
        throw new AppError("SESSION_FILE_ERROR", "会话文件缺失、损坏或工作目录不符；原记录保留，未创建空会话替代。");
    }
}
// One identity adapter for both metadata views and on-demand native image lookup.
export function transcriptEntries(manager, original = false) {
    // Ignore compaction boundaries for reading, while retaining native retry/context edits.
    // Only the active branch is eligible; abandoned branches and system records stay private.
    const projection = original
        ? buildSessionProjection(manager.getBranch().filter((entry) => entry.type !== "compaction")
            .map((entry, index, entries) => ({ ...entry, parentId: entries[index - 1]?.id ?? null })))
        : manager.buildSessionProjection();
    return projection.entries.flatMap(({ sourceEntry: entry, messages }) => {
        if (!messages.length)
            return [];
        if (entry.type === "compaction")
            return [{ message: { role: "compactionSummary", summary: entry.summary,
                        compression: compactionDisplay(entry, manager.getBranch()) }, id: entry.id, entryId: entry.id }];
        if (entry.type === "custom_message" && entry.display) {
            return [{
                    message: messages[0],
                    id: entry.details?.axiomInput ? `input-${entry.details.axiomInput}` : entry.id,
                    entryId: entry.id,
                }];
        }
        if (entry.type !== "message")
            return [];
        const m = messages[0];
        return [{ message: m, id: m.axiomId ?? (m.role === "toolResult" ? `tool-${m.toolCallId}` : entry.id), entryId: entry.id }];
    });
}
/** Only user-authored, currently visible inputs are eligible, including pre-compaction history. */
export function transcriptInput(manager, messageId) {
    const input = transcriptEntries(manager, true).find(({ id }) => id === messageId);
    if (!input || !(input.message.role === "user" || input.message.role === "custom" && input.message.customType === "axiom-append"))
        throw new AppError("NOT_EDITABLE", "消息不存在、已离开当前对话，或不是可编辑的用户消息。");
    return input;
}
export function transcriptForkPoint(manager, messageId) {
    const entry = transcriptEntries(manager, true).find(({ id }) => id === messageId);
    const view = entry && chatMessage(entry.message, entry.id);
    if (!entry || !view || !(view.role === "user" || view.role === "assistant" &&
        view.phase === "final_answer" && view.status === "completed" && !view.calls?.length && !view.error))
        throw new AppError("NOT_FORKABLE", "消息不存在、已离开当前对话，或不是已完成的回复或用户消息。");
    return { entryId: entry.entryId, before: view.role === "user" };
}
export function transcriptMessages(manager, original = false) {
    return transcriptEntries(manager, original).flatMap(({ message, id }) => {
        const converted = chatMessage(message, id);
        return converted ? [converted] : [];
    });
}
/** Read only a displayed native block from the bound current branch; never follow paths. */
export function transcriptImage(manager, messageId, imageId, original = false) {
    const entry = transcriptEntries(manager, original).find(({ id }) => id === messageId);
    const view = entry && chatMessage(entry.message, entry.id);
    const images = view?.images?.filter((image) => !image.path) ?? [];
    const index = images.findIndex((image) => image.id === imageId);
    if (!entry || index < 0)
        throw new AppError("NOT_FOUND", "图片不存在或不属于此消息");
    const block = entry.message.content.filter((c) => c.type === "image")[index];
    // Reuse strict MIME/signature/base64 and per-image bounds; don't trust JSONL metadata.
    return imagesInput([{ ...images[index], data: block.data }])[0];
}
//# sourceMappingURL=transcript.js.map