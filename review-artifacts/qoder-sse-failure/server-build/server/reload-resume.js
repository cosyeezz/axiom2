/** Enter prompt's fresh system-prompt lifecycle without inventing a user turn.
 * Remove only the synthetic user before Agent.prompt records its input; keep
 * native system deltas and extension messages in order. Removing a control in a
 * context hook would make Pi collapse all system sections into a new head.
 */
export async function resumeReloadedSession(session, onStart) {
    const agent = session.agent, original = agent.prompt;
    let invoked = false;
    agent.prompt = (async (input) => {
        agent.prompt = original;
        if (!Array.isArray(input))
            throw Error("pi 续接消息形态改变，未自动恢复。");
        const users = input.filter(message => message.role === "user");
        if (users.length !== 1)
            throw Error("pi 续接边界改变，未自动恢复。");
        invoked = true;
        const messages = input.filter(message => message.role !== "user");
        onStart?.();
        await original.call(agent, messages);
    });
    try {
        await session.prompt("", { expandPromptTemplates: false, source: "extension" });
        if (!invoked)
            throw Error("扩展拦截了重载后的续接，未自动恢复。");
    }
    finally {
        agent.prompt = original;
    }
}
//# sourceMappingURL=reload-resume.js.map