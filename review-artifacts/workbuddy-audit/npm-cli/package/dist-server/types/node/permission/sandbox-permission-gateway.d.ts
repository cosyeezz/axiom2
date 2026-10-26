import { Logger } from '@celljs/core';
import { type BashSandboxManager as IBashSandboxManager } from '../bash-sandbox/bash-sandbox-protocol';
/**
 * DI symbol for {@link SandboxPermissionGateway}.
 */
export declare const SandboxPermissionGateway: unique symbol;
/**
 * Sandbox Permission Gateway — 新权限路径入口分流。
 *
 * 职责：判断当前工具目标是否应走"沙箱新路径"（跳过 8-Phase 规则链）。
 *
 * 设计原则：
 * - 分流判据：本轮沙箱执行路径是否已启用（SandboxTurnConfig.useSandboxCLI）
 * - 同一个请求只走一条路径，新旧互斥
 * - 不改动旧路径任何逻辑
 *
 * 当此 Gateway 判断走新路径时，needsApproval 返回 false，权限判断完全交由
 * SandboxOrchestrator 在执行阶段处理（ApprovalStore → 沙箱执行 → 归因 → 提权）。
 */
export interface SandboxPermissionGateway {
    /**
     * 判断工具目标（命令或文件路径）是否应走沙箱新路径。
     * 非字符串输入直接返回 false，不读取沙箱配置。
     *
     * @returns true = 走新路径（跳过 8-Phase），false = 走旧路径（8-Phase 规则链）
     */
    shouldUseSandboxPath(target: unknown): Promise<boolean>;
}
/**
 * 默认实现：基于 SandboxConfig.enabled 判断（与 Orchestrator 同口径）。
 */
export declare class SandboxPermissionGatewayImpl implements SandboxPermissionGateway {
    protected readonly bashSandboxManager?: IBashSandboxManager;
    protected readonly logger: Logger;
    shouldUseSandboxPath(target: unknown): Promise<boolean>;
}
