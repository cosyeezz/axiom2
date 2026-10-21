import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { omitResumeControls, resumeControlType } from "./resume-session.js";

/** Enter prompt's fresh system-prompt lifecycle without inventing a user turn.
 * The public Agent receives a hidden host control instead of the synthetic user
 * input. Existing context hooks exclude it; context_edit excludes it on restore.
 */
export async function resumeReloadedSession(session: AgentSession, onStart?: () => void) {
  const agent = session.agent, original = agent.prompt;
  let invoked = false;
  agent.prompt = (async (input: AgentMessage | AgentMessage[] | string) => {
    agent.prompt = original;
    if (!Array.isArray(input)) throw Error("pi 续接消息形态改变，未自动恢复。");
    const users = input.filter(message => message.role === "user");
    if (users.length !== 1) throw Error("pi 续接边界改变，未自动恢复。");
    invoked = true;
    const messages: AgentMessage[] = input.map(message => message.role === "user" ? {
      role: "custom", customType: resumeControlType, content: [], display: false, timestamp: message.timestamp,
    } : message);
    onStart?.();
    await (original as (messages: AgentMessage[]) => Promise<void>).call(agent, messages);
  }) as typeof agent.prompt;
  try {
    await session.prompt("", { expandPromptTemplates: false, source: "extension" });
    if (!invoked) throw Error("扩展拦截了重载后的续接，未自动恢复。");
  } finally {
    agent.prompt = original;
    omitResumeControls(session);
  }
}
