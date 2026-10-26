import type { Session } from '../session/session-protocol';
/**
 * 归还本轮 turn 持有的 tracing 重初始化闸门（genie#113158）。
 *
 * 闸门计数只能由持有 release 的那一轮归还，且 session 上只存一个 release 槽位。
 * 因此**每一个结束本轮 root span 的出口**都必须调用本函数：正常 Stop、PTL 无
 * 续跑的兜底清理、下一轮开始时对残留 root span 的强制收尾。任一出口漏掉，
 * 下一轮的 markTraceTurnOpen 就会覆盖掉未归还的 release，计数从此单调递增、
 * 永不归零——后续 re-init 被无限推迟，auth/product 配置变更再也不生效。
 *
 * release 自身幂等，重复调用安全。
 */
export declare function releaseTraceTurnGate(session: Session): void;
//# sourceMappingURL=trace-turn-gate.d.ts.map