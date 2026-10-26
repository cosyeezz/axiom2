import type { AgentInputItem } from '../../../cbc-shared/node/index.js';
/**
 * 人发出一条消息时所在的界面。`web-ui` 只由 Web UI 的 ACP 连接声明；
 * TUI、远程控制、REST 等其余人工入口一律是 `other`。
 */
export type HumanInputSurface = 'web-ui' | 'other';
export declare function tagHumanInputSurface(items: readonly AgentInputItem[], surface: HumanInputSurface): void;
export declare function copyHumanInputSurface(from: object, to: object): void;
/** 一批输入里最后一条登记过的用户消息的来源；整批都没登记（系统发起的轮次）返回 undefined。 */
export declare function admittedHumanInputSurface(items: unknown): HumanInputSurface | undefined;
/**
 * 把这一轮的来源写到会话上。只在一批输入**真正开始执行**时调用：排队中的消息不能改写
 * 正在跑的那一轮的判断。系统发起的轮次（来信、续跑、队列空 drain）不调用，沿用上次的值。
 */
export declare function recordLastHumanInputSurface(session: {
    options?: object;
}, surface: HumanInputSurface): void;
export declare function lastHumanInputSurface(session: {
    options?: object;
} | undefined): HumanInputSurface | undefined;
//# sourceMappingURL=human-input-surface.d.ts.map