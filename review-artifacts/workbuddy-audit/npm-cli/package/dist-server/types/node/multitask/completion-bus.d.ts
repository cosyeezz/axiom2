import { Application, ApplicationLifecycle } from '@celljs/core';
import type { Session } from '../../vendor/cbc-core/node/index.js';
import { type AgentTask } from '../agent-task/agent-task-protocol';
export declare const MultitaskCompletionBus: unique symbol;
/** @deprecated use MultitaskCompletionBus */
/** @internal 未接线 — 仅保留原文档用名，生产请用 MultitaskCompletionBus */
export declare const CompletionBus: symbol;
export type TaskTerminalKind = 'completed' | 'failed' | 'cancelled' | 'killed';
/** 必须裸 `<task-notification>`；kind 放子节点。带属性会被现网 isSystemInjected 漏掉。 */
export declare function buildAgentTaskNotificationXml(task: {
    id?: string;
    status?: string;
    result?: string;
    error?: string;
}, status: string): string;
export declare function handleMultitaskTaskTerminal(opts: {
    task: Pick<AgentTask, 'id' | 'status' | 'error' | 'sessionId'> & {
        resume?: unknown;
        getMainSession?: () => Session | undefined;
        result?: string;
    };
    kind: TaskTerminalKind;
    notifyEvent: (session: Session, xml: string) => void;
}): void;
/** 必须同时绑 ApplicationLifecycle，否则 IoC 不实例化、终态订不上。 */
export declare class MultitaskCompletionBusImpl implements ApplicationLifecycle<Application> {
    private bound;
    protected start(): void;
    onStart(): Promise<void>;
    private safeBind;
    private bind;
    private onTerminal;
}
/** @deprecated name kept for the original spec wording */
/** @internal 未接线 — 仅保留原文档用名，生产请用 MultitaskCompletionBusImpl */
export declare const CompletionBusImpl: typeof MultitaskCompletionBusImpl;
