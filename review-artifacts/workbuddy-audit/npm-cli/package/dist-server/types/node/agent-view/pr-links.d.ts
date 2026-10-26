/**
 * PR 关联采集（M17 / G-PR）—— 纯函数，无 I/O。
 *
 * 对齐 Claude 文档语义的可行子集：会话里 `gh` 命令的**自身输出**点名了
 * 哪个 PR，就把会话关联到它（创建/编辑/评论/checkout 一视同仁——都是
 * 输出里带 PR URL）。输出里没点名 PR 的 gh 命令不产生关联。
 *
 * 已知偏差（记录在案）：`push 到有 open PR 的分支 → 主动 gh pr view 反查`
 * 未实现——那需要额外的网络查询链路，v1 只认命令输出。
 */
import { type AgentJobLink } from './agent-view-protocol';
export interface PrLinkCandidate {
    number: number;
    href?: string;
}
/** 从一段文本里抽出全部 PR 链接（按编号去重，先出现的 href 胜出） */
export declare function extractPrLinksFromText(text: string): PrLinkCandidate[];
/** 这条 Bash 命令是不是 gh 调用（只有 gh 命令的输出才建立 PR 关联） */
export declare function isGhCommand(command: string): boolean;
/** 会话历史条目的最小形状（避免依赖完整的 AgentInputItem 类型树） */
export interface PrScanHistoryItem {
    type?: string;
    name?: string;
    callId?: string;
    arguments?: string;
    output?: {
        text?: string;
    } | string | {
        type: string;
        text?: string;
    }[];
}
/**
 * 扫全量历史：找 gh 命令的 Bash 调用，从**配对的结果**里抽 PR 链接。
 *
 * 只看 gh 命令输出而不是所有 Bash 输出：`cat CHANGELOG.md` 里出现的
 * 历史 PR 链接不代表这个会话在处理它。
 */
export declare function collectPrLinks(history: readonly PrScanHistoryItem[]): PrLinkCandidate[];
/**
 * 把新发现的 PR 合并进已有的 children。
 *
 * - 已有条目保留（status/href 是状态刷新的成果，不能被裸发现覆盖掉）
 * - 新条目默认 status 'open'
 * - 没有任何新增时返回 undefined —— 调用方据此跳过写盘
 */
export declare function mergePrLinks(existing: AgentJobLink[] | null | undefined, found: readonly PrLinkCandidate[]): AgentJobLink[] | undefined;
