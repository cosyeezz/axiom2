import { thinkingLevels } from "../shared/agent.js";
/** Use the model that actually answered; old transcripts may lack a thinking level. */
export function requestSelection(message, fallback) {
    // pi stamps thinkingLevel on provider results, including HTTP errors. Its
    // locally synthesized failure has no such evidence and must not use fallback.
    if (message.thinkingLevel == null && ["error", "aborted"].includes(message.stopReason))
        return;
    const thinking = message.thinkingLevel ?? fallback;
    if (message.role !== "assistant" || typeof message.provider !== "string" || !message.provider ||
        typeof message.model !== "string" || !message.model || !thinkingLevels.includes(thinking))
        return;
    return { provider: message.provider, id: message.model, thinking };
}
/** Selection entries alone do not prove that a model request ever started. */
export function lastRequestSelection(entries) {
    let thinking;
    let last;
    for (const entry of entries) {
        if (entry.type === "thinking_level_change" && thinkingLevels.includes(entry.thinkingLevel))
            thinking = entry.thinkingLevel;
        if (entry.type === "message" && entry.message.role === "assistant")
            last = requestSelection(entry.message, thinking) ?? last;
    }
    return last;
}
export function selectionChange(from, to) {
    if (!from || !to || (from.provider === to.provider && from.id === to.id && from.thinking === to.thinking))
        return;
    return { from, to };
}
//# sourceMappingURL=request-selection.js.map