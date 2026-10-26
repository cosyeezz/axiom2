/**
 * 会话历史序列化（jobs 上下文继承用）。
 *
 * 从某个会话的历史里提取「主会话在做什么」的可见摘要，注入后台 job 的继承上下文：
 * - user：只取真实输入（skipRun / 无可见内容 / 后台任务通知注入都剔除）
 * - assistant：剔除空内容
 * - 双向消毒：剥除会打破包裹结构的闭合标签，防止历史内容逃逸
 *   <system-reminder> / 引用块边界（注入防护，对齐 Codex untrusted 语义）
 */
import { type AgentInputItem } from '../../vendor/cbc-shared/node/index.js';
/** 从 assistant 消息项提取可见文本（output_text/text 块，防御式解析） */
export declare function extractAssistantText(item: AgentInputItem): string;
/**
 * 全量序列化会话历史（jobs 上下文继承用）。
 *
 * 不做条数/字符预算截断，把整个历史按时间正序摊开。
 * 工具调用沿用压缩链路的既有约定（history-engineering-compactor）：
 *   <previous_tool_call>Tool: x / Arguments: y / <result><omitted /></result></previous_tool_call>
 * —— 调用保留（名字+参数，大负载字段换 <omitted>），结果一律省略且不单独渲染。
 * 过滤规则：剔 skipRun / 任务通知 / 空内容。
 */
export declare function serializeHistoryForInherit(history: readonly AgentInputItem[]): string;
