/**
 * 会话的权限模式全集。
 *
 * 注意：**不是每个值都能进 `--permission-mode`**。能进进程 argv 的是
 * CLI_PROCESS_PERMISSION_MODES（本枚举的一个子集）；HTTP dispatch 面又比它更窄
 * （见 ALLOWED_DISPATCH_PERMISSION_MODES）。三处是有意的三层，不要合并——
 * ignore / work / delegate 只用于会话内部状态，不是可选的进程模式。
 */
export declare enum PermissionMode {
    Default = "default",
    AcceptEdits = "acceptEdits",
    Plan = "plan",
    Auto = "auto",
    DontAsk = "dontAsk",
    BypassPermissions = "bypassPermissions",
    FullAccess = "fullAccess",
    Ignore = "ignore",
    Work = "work"
}
/** Modes that must not bypass interruption-layer direct approval. */
export declare function isRestrictedDirectApproveMode(mode: PermissionMode | undefined): boolean;
/** 推理强度等级；与 product 的值集合保持一致。 */
export type ReasoningEffortLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
//# sourceMappingURL=settings-types.d.ts.map