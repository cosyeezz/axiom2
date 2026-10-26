/**
 * 持久化到会话转录（off-tree `session-meta` 行）的 key 的单一真源。
 *
 * 为什么单列一个文件：`codebuddy.ai/privateDataSticky`（隐私锁定恢复标记）这个字面量
 * 同时被三处使用 —— 读侧白名单（`session-store` 的 `PERSISTED_SESSION_META_KEYS`）、
 * 新建/继承（`session-admission-service`）、派生继承（`agent-service`）。此前三处各写
 * 一份字面量，任何一处笔误都会让「写入的键」与「可持久化的键」静默错开，表现为锁位
 * 不落盘、或落盘后读不回来。
 *
 * 归属：agent-cli 的 `node/model/private-data-sticky.ts` 是该标记的语义所有者（它还
 * 同时导出两个分享标记键），但 core 不能反向依赖 agent-cli，所以真源放在这里；两侧
 * 字面量由 `agent-cli/src/node/session/session-store.spec.ts` 的白名单断言钉住同步。
 */
export declare const PRIVATE_DATA_STICKY_META_KEY = "codebuddy.ai/privateDataSticky";
//# sourceMappingURL=session-meta-keys.d.ts.map