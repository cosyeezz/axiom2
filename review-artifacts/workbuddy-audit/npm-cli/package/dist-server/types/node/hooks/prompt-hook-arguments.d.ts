/**
 * 构建 prompt hook 评估请求里的 `ARGUMENTS` JSON。
 *
 * 抽成独立模块以便：
 *   1. 单测里直接 import 就能覆盖各事件类型的字段路径——不必构造整个
 *      PromptHookService 的依赖图（Runner / AgentManager / ContainerUtil）；
 *   2. 与 Claude Code `/goal` Stop hook 评估请求严格 parity，作为单测靶子；
 *   3. 字段集合演进时只改这一处，避免漂移到其它 hook 类型。
 *
 * cc parity 字段映射（Stop / SubagentStop 重点）：
 *   - session_id, transcript_path, cwd, hook_event_name      （所有事件）
 *   - permission_mode                                       （所有事件，由 PermissionModeHookInputProcessor 注入）
 *   - stop_hook_active, last_assistant_message              （Stop / SubagentStop；上游 session-hook-manager 填）
 *   - background_tasks, session_crons                       （Stop / SubagentStop；由 StopHookSessionContextProcessor 注入）
 *
 * 这里只做"读 HookInput → 拼 JSON"，不做数据采集——数据源解耦到 processor。
 */
import { HookInput } from './hook-protocol';
/**
 * 把 HookInput 转成与 cc 严格对齐的 ARGUMENTS JSON 字符串。
 *
 * 字段顺序与 cc 请求体一致，避免 prompt cache 因 key 顺序漂移而 miss。
 * 注意：JSON.stringify 保留对象 key 插入顺序，所以 `args` 对象的 key
 * 添加顺序就是输出顺序——不要轻易重排。
 */
export declare function buildPromptHookArgumentsJson(input: HookInput): string;
