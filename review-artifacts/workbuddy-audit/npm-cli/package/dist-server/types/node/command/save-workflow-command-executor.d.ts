/**
 * /save-workflow <runId> <name> [--scope=project|user]
 *
 * 单一职责:解析参数 + 调用 WorkflowManager.saveAs 把脚本快照复制到 registry。
 *
 * 实际的"找快照 → 校验 name → mkdir + copyFile → invalidate"逻辑沉到 Manager,
 * 与 UI 端 WorkflowSavePanel 共享同一段代码(R1 领域下沉)。
 *
 * 行为:
 *   - --scope=project (默认): `<cwd>/.codebuddy/workflows/<name>.js`
 *   - --scope=user           : `~/.codebuddy/workflows/<name>.js`
 *   - 同名直接覆盖(对齐 CC)
 */
import { Logger } from '@genie/telemetry';
import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import type { WorkflowManager } from '@genie/cbc-workflow';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
interface ParsedArgs {
    runId?: string;
    name?: string;
    scope: 'project' | 'user';
    error?: string;
}
export declare class SaveWorkflowCommandExecutor implements CommandExecutor {
    name: string;
    autoGenerateHistory: boolean;
    protected readonly logger: Logger;
    protected readonly sessionManager: SessionManager;
    protected readonly manager: WorkflowManager;
    execute(ctx: CommandExecuteContext): Promise<void>;
    private run;
    /**
     * 解析 argv:
     *   /save-workflow <runId> <name> [--scope=project|user]
     *   /save-workflow <runId> <name> --user / --project (短形式)
     *
     * Visible-for-testing(无副作用、无依赖,可作为 instance 方法直接调用)。
     */
    parseArgs(args: unknown[]): ParsedArgs;
    static usage(reason?: string): string;
    private appendHistory;
}
export {};
