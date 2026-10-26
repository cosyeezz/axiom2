export const compressionMemoryPrompt = "即将压缩上下文，请先整理并更新本会话记忆。记忆维护是当前任务的中间步骤，不改变用户目标或授权范围。维护后立即继续当前仍可推进的工作；压缩由程序在后台处理，无需等待，也不要仅以‘已更新记忆’结束回复。只有任务及必要验证完成，或确实需要用户输入、授权或遇到阻塞时才结束。";
const customType = "axiom-compression-memory";
const message = (id) => ({ customType, content: compressionMemoryPrompt, display: false, details: { compressionId: id } });
const matches = (value, id) => value.role === "custom" && value.customType === customType &&
    value.details?.compressionId === id;
/** One reminder per compression; memory maintenance is left to the main session. */
export class CompressionMemory {
    pending = new Map();
    request(id) {
        if (!this.pending.has(id))
            this.pending.set(id, false);
    }
    sent(id) { return this.pending.get(id) === true; }
    delete(id) { this.pending.delete(id); }
    clear() { this.pending.clear(); }
    context(session, messages) {
        for (const id of this.pending.keys()) {
            if (!messages.some(value => matches(value, id))) {
                const reminder = message(id);
                session.sessionManager.appendCustomMessageEntry(reminder.customType, reminder.content, reminder.display, reminder.details);
                session.refreshContext();
                // context_with_system preserves all existing system sections and history.
                messages = [...messages, { role: "custom", ...reminder, timestamp: Date.now() }];
            }
            this.pending.set(id, true);
        }
        return messages;
    }
    boundary(id, event) {
        if (!this.pending.has(id) || this.sent(id) || event.outcome !== "completed")
            return;
        if (event.context.contextMessages.some(value => matches(value, id)))
            return { continue: true };
        return { entries: [...event.entries, { type: "custom_message", ...message(id) }], continue: true };
    }
}
//# sourceMappingURL=compression-memory.js.map