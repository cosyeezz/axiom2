/**
 * Agent 侧敏感命令检测适配器。
 *
 * 分类算法由 `@genie/sandbox-cli` 持有；本层只负责 DI、规则优先级、日志和审计。
 */
import { Logger } from '@celljs/core';
import type { SecurityCenterCommandRule } from '../bash-sandbox/bash-sandbox-protocol';
import { type SecurityAuditContext } from '../utils/security-audit-log';
/** DI symbol for {@link SensitiveCommandDetector}. */
export declare const SensitiveCommandDetector: unique symbol;
/** Agent 对外保留的敏感命令结果。 */
export interface SensitiveDetectResult {
    sensitive: boolean;
    reason?: string;
    matchedPaths?: string[];
}
export interface SensitiveCommandDetector {
    /**
     * Detect whether a command accesses (reads, writes, or deletes) sensitive credential paths.
     *
     * @param command - Raw command string (before canonicalisation).
     * @returns Detection result; `sensitive=true` means "skip sandbox, show approval UI directly".
     */
    detect(command: string, auditContext?: SecurityAuditContext): SensitiveDetectResult;
    /** Replace ordered command rules cached by the detector. */
    setOrderedCommandRules?(rules: readonly SecurityCenterCommandRule[] | undefined): void;
}
export declare class SensitiveCommandDetectorImpl implements SensitiveCommandDetector {
    protected readonly logger: Logger;
    private sensitiveCredentialPaths;
    private orderedCommandRules;
    detect(command: string, auditContext?: SecurityAuditContext): SensitiveDetectResult;
    private _detect;
    /** Update the sensitive credential path list at runtime. */
    setSensitiveCredentialPaths(paths: readonly string[]): void;
    setOrderedCommandRules(rules: readonly SecurityCenterCommandRule[] | undefined): void;
    /** @deprecated Use {@link setSensitiveCredentialPaths} instead. */
    setSensitiveReadPaths(paths: readonly string[]): void;
}
