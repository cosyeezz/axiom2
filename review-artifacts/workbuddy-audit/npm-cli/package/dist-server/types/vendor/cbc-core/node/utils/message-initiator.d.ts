/**
 * Which side a model-bound user message stands for: user intent or harness-internal input.
 * The gateway reads the per-call result from `extra_vars.initiator`.
 *
 * Explicit marks ride on `providerData`, which the SDK chat converter spreads onto the
 * wire message; the `__codebuddy` prefix makes the final transport boundary strip them.
 * Nothing but this classifier may read the marks.
 */
export declare const MESSAGE_INITIATOR_KEY = "__codebuddyInitiator";
/**
 * `true` on harness content attached next to the real trigger (step reminders, injected
 * context): it never decides the initiator, so the message it rides with does.
 */
export declare const ATTACHED_CONTEXT_KEY = "__codebuddyAttachedContext";
export type MessageInitiator = 'user' | 'agent';
export declare function isAttachedContext(markers: Record<string, unknown> | undefined): boolean;
/**
 * Teammate mail written as `<teammate-message teammate_id="...">` blocks: another agent's
 * message is user intent; only text made entirely of framework notices is not.
 */
export declare function isFrameworkTeammateNoticeText(text: string): boolean;
export declare function classifyUserMessageMarkers(markers: Record<string, unknown> | undefined): MessageInitiator;
/**
 * The newest user message in the trailing run that is not attached context decides; a run
 * of only attached context reports `agent`. `agentType` / `purpose` describe the model call
 * (X-Agent-Type / X-Agent-Purpose): calls outside the main loop are harness-internal, except
 * the `/btw` side question, which answers the user on a forked session.
 */
export declare function resolveTrailingMessageInitiator(messages: readonly unknown[], call?: {
    agentType?: string;
    purpose?: string;
}): MessageInitiator | undefined;
//# sourceMappingURL=message-initiator.d.ts.map