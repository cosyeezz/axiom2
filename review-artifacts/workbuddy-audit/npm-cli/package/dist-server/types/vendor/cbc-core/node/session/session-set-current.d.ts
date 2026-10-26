/**
 * setCurrent 换会话时要不要拆旧会话（complete Subjects / 停 cron / 清 task）。
 *
 * Web UI 多标签共用一个进程：掐掉旧 Web 会话的 Subject 会把另一个浏览器打死，
 * 所以旧会话带 `webUiAcp` 时默认留活。
 *
 * ACP 宿主之间不能通过 setCurrent 互相拆会话。WorkBuddy 与 Web UI 可能
 * 共用一个 agent-cli 进程，hostKind 只控制能力 gate，不拥有另一个宿主的
 * Subject / cron / task 生命周期。
 */
export declare function shouldTeardownOutgoingSessionOnSetCurrent(input: {
    oldWebUiAcp?: boolean;
    incomingHostKind?: string;
}): boolean;
//# sourceMappingURL=session-set-current.d.ts.map