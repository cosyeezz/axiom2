export { buildPowerShellSafeDeleteEnv, buildSafeDeleteEnv, type SafeDeleteEnvBuildOptions } from './safe-delete-env';
export { buildSandboxSafeDeletePosixBootstrap as buildSafeDeletePosixBootstrap, } from '@genie/sandbox-cli/shell-runtime-bootstrap';
export { isSafeDeleteHelperProcessExecRecord, isSafeDeleteHelperPath, } from '@genie/sandbox-cli/safe-delete-attribution';
export { appendSafeDeleteReportEvent, attachSafeDeleteReportEvents, ensureSafeDeleteReportPath, readSafeDeleteReport, SAFE_DELETE_REPORT_ENV, type SafeDeleteReportEvent, } from '@genie/sandbox-cli/safe-delete-report';
export { logSafeDeleteInjection, parseSafeDeleteBulkThreshold, resolveSafeDeleteRuntimeConfig, resolveSafeDeleteRuntimeEnabled, type SafeDeleteRuntimeConfig, } from './safe-delete-settings';
export { approveSafeDeleteBulkGuard, createSafeDeleteBulkGuardContext, readBulkGuardSignalFile, rejectSafeDeleteBulkGuard, } from './bulk-guard/service';
export { SAFE_DELETE_BULK_STATE_DIR_NAME, type SafeDeleteBulkGuardSignal as BulkGuardSignal } from '@genie/sandbox-cli/safe-delete-bulk-guard';
export { DEFAULT_SAFE_DELETE_BULK_THRESHOLD } from '@genie/sandbox-cli/presets/safe-delete-policy';
export { resolveWindowsRecycleBinAuditPath, filterSafeDeleteTempProbeNoise, matchesSafeDeleteEscalationCommand, parseSafeDeleteBulkConfirmInfo, shouldEscalateSafeDeleteBulkConfirm, shouldEscalateSafeDeleteFailClosed, normalizeWindowsShellPathForAudit, SAFE_DELETE_BULK_CONFIRM_MARKER_RE, SAFE_DELETE_FAIL_CLOSED_MARKER_RE, type SafeDeleteBulkConfirmInfo, } from '@genie/sandbox-cli/safe-delete-sandbox-helpers';
/**
 * 从 sandbox 配置判定 safe-delete 运行时是否启用。
 *
 * 默认启用（fail-open）：未配置或读取失败时返回 true，
 * 只有显式设为 false 才禁用。
 */
