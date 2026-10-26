// pi 1.1.0 exposes only next-turn peek and text-only session queue mirrors.
// Keep this version-bound read adapter isolated and fail closed on API drift.
// Mutations use public Agent APIs, synchronously, so consumption cannot race a recall.
function queues(session) {
    const agent = session.agent;
    const steer = agent.steeringQueue?.messages, followUp = agent.followUpQueue?.messages;
    if (!Array.isArray(steer) || !Array.isArray(followUp))
        throw Error("Unsupported pi queue layout");
    return { steer, followUp };
}
export function nativeQueuedMessages(session) {
    const { steer, followUp } = queues(session);
    return [...steer, ...followUp];
}
function inputId(message) {
    if (message.role !== "custom" || message.customType !== "axiom-append")
        return;
    const id = message.details?.axiomInput;
    return typeof id === "string" ? id : undefined;
}
export function retainedInput(session, id) {
    const matches = (message) => inputId(message) === id;
    return nativeQueuedMessages(session).some(matches) || session.messages.some(matches) ||
        session.sessionManager.getEntries().some((entry) => entry.type === "custom_message" &&
            entry.customType === "axiom-append" && entry.details?.axiomInput === id);
}
export function nativeInputs(session) {
    return Object.entries(queues(session)).flatMap(([mode, messages]) => messages.flatMap((message) => {
        const id = inputId(message);
        return id ? [{ id, mode: mode }] : [];
    }));
}
export function recallNativeInputs(session, ids) {
    const removed = [];
    for (const [mode, messages] of Object.entries(queues(session))) {
        const keep = messages.filter((message) => {
            const id = inputId(message);
            if (!id || !ids.has(id))
                return true;
            removed.push(id);
            return false;
        });
        if (keep.length === messages.length)
            continue;
        // Leave native user-message display mirrors intact. Only our ID-tagged
        // custom inputs are removed; result notifications/extensions are preserved.
        if (mode === "steer") {
            session.agent.clearSteeringQueue();
            for (const message of keep)
                session.agent.steer(message);
        }
        else {
            session.agent.clearFollowUpQueue();
            for (const message of keep)
                session.agent.followUp(message);
        }
    }
    return removed;
}
//# sourceMappingURL=native-queue.js.map