/**
 * REPL sandbox 的**会话级能力指纹** —— worker 同步判定键的第二半（见 repl-worker-manager）。
 *
 * 为什么需要它：worker 里的工具集新鲜度原先只比较 `overlayCatalogEpoch(indexEpoch, surfaceEpoch)`，
 * 而这两个 epoch 都只反映「索引版本 / overlay 开关」，**不含「本会话此刻能不能用某个工具」**。
 * 工具可见性还有第三个来源：Agent Home 的表面 / 身份 / 已加入频道（房间类工具的 isEnabled
 * 正是靠它拒绝），这三者可以在 indexEpoch 与 surfaceEpoch 都不变的情况下翻转。
 * 评现实测：同一会话第二个 cell 里 `typeof SpeakInChannel` 仍是 `undefined`，epoch+1 才变 function。
 *
 * 为什么不把能力并进 agent 级 epoch：`overlayCatalogEpoch` 同时是 prompt 骨架目录 / `agent.tools`
 * 的冻结键（跨会话共享），把 per-session 能力混进去会让**别的会话**跟着抖振 —— 打爆 prompt
 * cache，而沙箱里该补的工具照样补不上（那不是它负责的键）。所以指纹只喂给 **worker 侧**
 * （本就是 per-session）的同步判定，不参与任何 prompt 缓存键。
 *
 * 口径（#125667 评审）：**宽松可见性** —— 用 `resolveAgentHomeSelf` 的缺省解析（认不出同事身份
 * 时回落默认 Agent），与房间类工具 `isEnabled` 的 `hasChannelIdentity` 同源。动作身份的 strict
 * 拆分在调用点（`fallbackToDefault: false`），不在这里。
 *
 * ── 已知边界（别把它当通用兜底）──────────────────────────────────────────────
 * 1. **覆盖面 = Agent Home 能力面，不是"工具面通用新鲜度"**：只有表面 / 身份 / 可见频道这三类
 *    输入。`TeamCreate`、`ComputerUse`、`PushNotification`、`--tools` 等其它 isEnabled 来源
 *    同样可能"epoch 不变而可见性翻转"，本指纹**不覆盖**它们；将来若要一网打尽，得先有一个
 *    统一的、可枚举的工具可见性信号，而不是往这里继续塞。
 * 2. **不含 async settings（已知 stale 窗口）**：`surface` 来自 `isAgentHomeSurface`（feature env
 *    + 宿主/形态否决 + 真实会话），**不含** `isAgentHomeOrchestrationEnabled`（要读 settings，
 *    异步）；`isAgentHomeRuntimeArmed()` 又只增不减。所以"用户在 Web UI 里把 Agent Home 关掉"
 *    不会改指纹，沙箱里可能留一个 stale 全局。**不越权**（执行层 `checkToolAllowed` 会拿 live
 *    isEnabled 拒掉），只是模型会看到"存在却调不动"。要收敛需把 settings 结果纳入指纹 ——
 *    代价是每 cell 一次异步设置读，抖动/成本需要单独评估，当前刻意不做。
 * 3. **只是新鲜度键，不是授权判据**：`selfId` 在"未认领 job"与"用户主会话"两种形态下取值相同
 *    （都是默认 Agent）、`channelIds` 也都是全部可见频道 —— 这是宽松口径的必然结果。它能回答
 *    "沙箱要不要重采"，绝不能回答"这个工具能不能调"（后者 = live `isEnabled` + 动作侧
 *    `fallbackToDefault: false`）。
 */
import type { Session } from '../../../vendor/cbc-core/node/index.js';
export interface SandboxCapability {
    /** Agent Home 表面是否成立（`isAgentHomeSurface`：功能总闸 ∧ 宿主/形态未否决 ∧ 真实会话）。 */
    surface: boolean;
    /** 本会话解析出的 Agent Home 身份 id；表面关 / 认不出身份时缺省。 */
    selfId?: string;
    /** 本会话可见（能说话）的频道 id。主 Agent = 全部可见频道，同事 = 自己名下那些。 */
    channelIds: readonly string[];
}
/**
 * 纯函数：同状态稳定、状态变则变（频道集合先去重再排序，避免顺序抖动造成假变更）。
 * **不做任何 I/O**，便于单测直接喂状态。
 */
export declare function sandboxCapabilityFingerprint(capability: SandboxCapability): string;
/**
 * 本会话此刻的能力指纹。
 *
 * 表面关（WorkBuddy 宿主 / 非 PWA ACP / `-p` 与 stream-json 这类无人值守入口，或功能总闸被 env
 * 关掉）**不读盘也不读 settings**，直接返回常量 —— 这条路径每个 cell 都会走一次，不能为不可能的
 * 频道能力白付 I/O。**普通 TUI / CLI 会话就落在这一档**（2026-09-22 入口判据：
 * 表面要求 Web UI 拉起或同事 job 身份，TUI 里新开的对话不算表面）。
 *
 * 目录不可用 / 认不出身份时返回一个**稳定**的"表面开但无身份"指纹：同一状态下每次解析结果相同，
 * 不会让每个 cell 都当成变更重推一次目录；目录一旦出现（同事身份被登记）指纹随之变化，工具即补齐。
 */
export declare function resolveSandboxCapabilityFingerprint(session?: Session): Promise<string>;
