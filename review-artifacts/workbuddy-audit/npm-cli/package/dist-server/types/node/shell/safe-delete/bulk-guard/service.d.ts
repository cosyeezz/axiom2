import type { SafeDeleteBulkGuardApprovalScope, SafeDeleteBulkGuardConfirmPayload, SafeDeleteBulkGuardContext, SafeDeleteBulkGuardContextInput, SafeDeleteBulkGuardDecision } from '@genie/sandbox-cli/safe-delete-bulk-guard';
import { readBulkGuardSignalFile } from '@genie/sandbox-cli/safe-delete-bulk-guard-client';
export declare function createSafeDeleteBulkGuardContext(input: SafeDeleteBulkGuardContextInput): SafeDeleteBulkGuardContext;
export declare function checkSafeDeleteBulkGuard(context: SafeDeleteBulkGuardContext, targets: readonly string[]): SafeDeleteBulkGuardDecision;
export declare function approveSafeDeleteBulkGuard(context: SafeDeleteBulkGuardContext, scope?: SafeDeleteBulkGuardApprovalScope): void;
export declare function rejectSafeDeleteBulkGuard(context: SafeDeleteBulkGuardContext, payload: SafeDeleteBulkGuardConfirmPayload): void;
export { readBulkGuardSignalFile };
