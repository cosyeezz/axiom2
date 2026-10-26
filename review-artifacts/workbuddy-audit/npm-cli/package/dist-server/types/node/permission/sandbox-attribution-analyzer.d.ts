/**
 * Sandbox Attribution Analyzer — 失败归因分析器。
 *
 * 设计文档 § 五-⑤ 定位：
 * - 命令失败是"代码写错了"还是"沙箱拦住了"？只有后者才进入沙箱裁决处理。
 * - 归因只做因果判断；文件权限由后续流程消费 Center 原始裁决。
 *
 * 归因矩阵（权限系统只关注硬拦截，越界写入到影子区不进入此矩阵）：
 *
 * | exitCode      | EPERM 拦截记录                                       | 归因             |
 * |---------------|-----------------------------------------------------|-----------------|
 * | 0 或 null     | 无 / 仅 `process-exec*` / 已知启动缓存噪声 / 仅 `sysctl/ioctl/IOKit` | ✅ `success`    |
 * | 0             | 仅 `file-read-metadata`                            | ✅ `success`    |
 * | 任意           | 有可操作文件拦截或网络拦截                              | 🔒 `sandbox_denied` |
 * | ≠0            | 无可操作文件拦截且无网络拦截                            | ❌ `error`      |
 *
 * 过滤规则：
 * - `reason=forbidden_program` → non_actionable（程序黑名单硬拦截，不可通过文件授权修复）
 * - `process-exec*`      → 默认归因为 `error`（进程执行权限不足，弹提权 UI 也修不了）
 *   但 safe-delete helper（`genie-trash` / `osascript`）或带 `SAFE_DELETE`
 *   签名的包装进程（如 perl）例外，进入 `sandbox_denied` 以支持无弹窗本地重跑降级。
 * - PowerShell 启动缓存等已知进程副作用 → ignore（不计入 blocked 列表）
 * - `sysctl/ioctl/IOKit`  → ignore（静默丢弃，不上报遥测，不计入 blocked 列表）
 * - 命令成功且有效拦截仅为 `file-read-metadata` → ignore（保留原始记录，不升级提权）
 * - 其余（`file-write*`, `file-read-data` 等）→ 可操作，进入裁决处理
 *
 * 边界：
 * - Linux (bwrap) 无结构化拦截记录，1 期不弹提权 UI → 返回 error
 * - 越界写入到影子区（全局投影模式）不进入此矩阵——命令正常完成（exitCode=0）
 */
import type { DecisionRecord } from '@genie/sandbox-cli/protocol';
import type { FileBlockRecord } from '../sandbox-cli/sandbox-cli-protocol';
import type { ShellResult } from '../shell';
import type { ShellNetworkBlockRecord } from '../shell/shell-protocol';
/**
 * Attribution status — the causal judgement for a command execution.
 *
 * - `success`:        command succeeded (exitCode 0 / null), no actionable escalation needed.
 * - `error`:          command failed for non-sandbox reasons (code bug, missing dep, etc.).
 * - `sandbox_denied`: command failed because the sandbox blocked actionable file or network operations.
 */
export type AttributionStatus = 'success' | 'error' | 'sandbox_denied';
/**
 * Input for the attribution analyzer.
 *
 * Directly sourced from {@link ShellResult} fields after sandbox execution.
 */
export interface AttributionInput {
    /** Process exit code. 0 or null means success. */
    exitCode: number | null;
    /** Structured file block records from the IPC compatibility boundary. */
    fileBlockRecords?: FileBlockRecord[];
    /** Structured network block records from the IPC compatibility boundary. */
    networkBlockRecords?: ShellNetworkBlockRecord[];
    /** Center authority records from the current execution (may be empty or undefined). */
    decisionRecords?: DecisionRecord[];
}
/**
 * Result of the attribution analysis.
 */
export interface AttributionResult {
    /** The causal judgement. */
    status: AttributionStatus;
    /**
     * Actionable file evidence — only populated when `status === 'sandbox_denied'`.
     *
     * These are the records that passed filtering (excluded `process-exec*` and
     * `sysctl/ioctl/IOKit` entries). Downstream policy handling joins these
     * subjects to native Center verdicts.
     */
    actionableFileBlocks: FileBlockRecord[];
    /**
     * Network evidence — passed through as-is for post-exec ask/deny handling.
     */
    networkBlockRecords: ShellNetworkBlockRecord[];
    /** Center authority records preserved alongside their internal evidence projection. */
    decisionRecords: DecisionRecord[];
    /** Non-allow Center decisions that must not be silently treated as command errors. */
    actionableDecisionRecords: DecisionRecord[];
    /** Subject 不完整或 domain 暂无审批映射的非 allow 决策，调用方必须 fail-closed。 */
    unmappedDecisionRecords: DecisionRecord[];
    /**
     * File evidence that was filtered out as non-actionable
     * (`process-exec*` or program-blacklist hits). Kept for diagnostics / telemetry.
     */
    filteredNonActionable: FileBlockRecord[];
    /**
     * File evidence that was silently ignored
     * (known runtime cache writes, `sysctl/ioctl/IOKit`, or successful
     * metadata-only probes). Kept for diagnostics only.
     */
    filteredIgnored: FileBlockRecord[];
}
/**
 * Operations that indicate process-execution permission failures.
 * These are **non-actionable**: showing the user a file-permission UI
 * wouldn't help, because the issue is that the process itself was
 * blocked from spawning.
 *
 * Matched against `FileBlockRecord.raw.operation` (case-insensitive prefix).
 */
type AttributionShellResult = Pick<ShellResult, 'exitCode' | 'fileBlockRecords' | 'networkBlockRecords' | 'decisionRecords'>;
/** 保证所有 ShellResult 消费链都把 Center 权威记录纳入归因。 */
export declare function analyzeShellResultAttribution(result: AttributionShellResult): AttributionResult;
/**
 * Analyze the attribution of a sandboxed command execution.
 *
 * This is a **pure function** — no side effects, no DI dependencies.
 * It is the single source of truth for "why did this command fail?"
 * in the new permission path.
 *
 * @param input - Execution result from the sandbox (exitCode + attribution evidence).
 * @returns Attribution result with status and filtered evidence.
 */
export declare function analyzeAttribution(input: AttributionInput): AttributionResult;
export {};
