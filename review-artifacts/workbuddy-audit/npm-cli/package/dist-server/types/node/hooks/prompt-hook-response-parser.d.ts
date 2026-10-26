import { PromptHookResult } from '../../vendor/cbc-shared/node/index.js';
/**
 * 把 LLM 返回的字符串解析成 PromptHookResult。
 *
 * 抽成纯函数模块以便：
 *   1. 单测里直接 import 就能测 happy / 损坏 / markdown 包裹 / 三态语义；
 *   2. service 只负责调度 LLM、拿到字符串后转给本模块——职责分离；
 *   3. 未来扩展 schema（例如新增 `cancel`、`retry`）时只改这一处。
 *
 * 支持的格式：
 *   - 直接 JSON：{"ok": true}
 *   - 带 reason：{"ok": false, "reason": "..."}
 *   - 三态 impossible（CC parity）：{"ok": false, "impossible": true, "reason": "..."}
 *   - markdown 代码块包裹：```json\n{...}\n```
 *   - 任意位置嵌入的简单 {...} 片段
 *
 * 解析失败时返回 `{ ok: true, reason: 'Failed to parse...' }`，与历史行为一致
 * （防御性：解析错不阻塞用户）；inconclusive 标记让 Goal 区分放行与达成。
 */
export declare function parsePromptHookResponse(response: string): PromptHookResult;
