import { nativeQueuedMessages } from "./native-queue.js";
/** Serial callers reserve each ID until the SDK queue or transcript proves its outcome. */
export async function queueTaskNotifications(session, items, submitted, persisted, accepting, emit) {
    for (const item of items) {
        if (persisted.has(item.id)) {
            emit({ type: "delivered", ids: [item.id] });
            continue;
        }
        if (submitted.has(item.id))
            continue;
        if (!accepting()) {
            emit({ type: "input-error", id: item.id, error: "通知未进入安全交付边界" });
            continue;
        }
        submitted.add(item.id);
        try {
            await session.sendCustomMessage({ customType: "axiom-result", content: item.content, display: true,
                details: { axiomInput: item.id } }, { deliverAs: "steer" });
        }
        catch {
            try {
                const matches = (message) => message.role === "custom" && message.customType === "axiom-result" && message.details?.axiomInput === item.id;
                const retained = nativeQueuedMessages(session).some(matches) || session.agent.state.messages.some(matches) ||
                    session.sessionManager.getEntries().some(entry => entry.type === "custom_message" && entry.customType === "axiom-result" && entry.details?.axiomInput === item.id);
                if (retained)
                    continue; // Throwing after enqueue must not authorize duplicate injection.
            }
            catch {
                emit({ type: "input-error", id: item.id, uncertain: true, error: "通知提交结果未知；须先核对会话记录，未自动重发。" });
                continue;
            }
            submitted.delete(item.id);
            emit({ type: "input-error", id: item.id, error: "通知未入队；未自动重发。" });
        }
    }
}
//# sourceMappingURL=task-notifications.js.map