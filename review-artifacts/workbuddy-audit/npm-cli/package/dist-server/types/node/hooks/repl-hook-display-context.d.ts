/**
 * Hook 展示归属：REPL 内层工具调用触发的 Hook 消息挂到外层 REPL 调用下（providerData.replParentCallId）。
 *
 * REPL broker 写、HookExecutor 读。放在 hooks 域而不是 tools/repl：server 产物会把 `tools/repl/`
 * 整个目录置空，HookExecutor 从那里导入会在 Hook 带提示消息时于子进程 exit 回调里抛错。
 */
import type { Session } from '../../vendor/cbc-core/node/index.js';
export declare function runWithReplHookDisplayParent<T>(session: Session | undefined, innerCallId: string | undefined, outerReplCallId: string | undefined, execute: () => Promise<T> | T): Promise<T>;
export declare function getReplHookDisplayParent(session: Session | undefined, innerCallId: string | undefined): string | undefined;
