import { AgentInputItemProcessor, AgentInputItemProcessorPriority, Session } from '../../vendor/cbc-core/node/index.js';
import { type AgentInputItem } from '../../vendor/cbc-shared/node/index.js';
import { ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import { ConsoleManager } from '../console';
import { TelemetryService } from '../telemetry/telemetry-protocol';
import { ToolCallArgumentRenderer, ToolManager } from '../tools';
import { PlanStorageService } from '../tools/plan-storage-service';
type WorkflowSourceResolverType = import('@genie/cbc-workflow').WorkflowSourceResolver;
export declare class ProductAgentInputItemProcessor implements AgentInputItemProcessor {
    priority: number;
    protected readonly productManager: ProductManager;
    process(rawItem: AgentInputItem, session: Session): Promise<void>;
}
export declare class McpUiHistoryInputItemProcessor implements AgentInputItemProcessor {
    priority: number;
    process(rawItem: AgentInputItem): Promise<void>;
}
export declare class FunctionCallAgentInputItemProcessor implements AgentInputItemProcessor {
    priority: AgentInputItemProcessorPriority;
    protected readonly toolManager: ToolManager;
    protected readonly logger: Logger;
    /**
     * Headless / 测试场景下 WorkflowSourceResolver 不一定注入(workflow 模块未启用)。
     * 缺失时跳过预解析,UI 走"saved workflow: <name>"降级文案。
     */
    protected readonly workflowSourceResolver?: WorkflowSourceResolverType;
    protected parseDisplayText(args: any, renderer?: ToolCallArgumentRenderer): string | undefined;
    process(rawItem: AgentInputItem): Promise<void>;
    /**
     * 仅当 (1) 是 DeferExecuteTool(Workflow) 调用且 (2) WorkflowSourceResolver 已注入时,
     * 主动 resolve 一次脚本,把 text 写到 providerData.workflowSourceText。
     *
     * 解析失败不影响主流程:UI 拿不到 text 就退化到"saved workflow: <name>"单行展示。
     * 不抛异常,因为本函数是审批 UI 的最佳努力增强,不是关键路径。
     */
    private maybePreloadWorkflowSource;
}
/**
 * `chat_tool_action` 的统一生命周期出口。
 *
 * 工具结果只有进入 addHistory 的 processor 链后，状态、错误信息和请求关联字段才已
 * 完整落定。流式、非流式、权限拒绝与取消恢复都会经过这里；因此不再借用下一次
 * `ModelProvider.getModel()` 的调用时机上报。
 */
export declare class ToolActionTelemetryInputItemProcessor implements AgentInputItemProcessor {
    priority: AgentInputItemProcessorPriority;
    protected readonly telemetryService: TelemetryService;
    protected readonly logger: Logger;
    private readonly reportedKeys;
    process(rawItem: AgentInputItem, session: Session): Promise<void>;
}
export declare class DisplayTextPolishProcessor implements AgentInputItemProcessor {
    priority: AgentInputItemProcessorPriority;
    /**
     * 把 function_call_result 的 renderer.value 统一转成显示就绪文本（剥 OSC/DCS、
     * 非 SGR 控制序列与字符集控制，折 \r 重画；SGR 颜色保留）。
     * renderer.value 是纯展示字段（llmContent/output 不经过这里），在入库口统一收口，
     * 上屏层（TUI / web-ui）拿到的即最终文本。流式帧不进本链，由 ShellStreamPusher
     * 在推送时做同一转换。
     */
    process(rawItem: AgentInputItem, _session: Session): Promise<void>;
}
export declare class ExitPlanModeInputItemProcessor implements AgentInputItemProcessor {
    priority: AgentInputItemProcessorPriority;
    protected readonly consoleManager: ConsoleManager;
    protected readonly planStorageService: PlanStorageService;
    process(rawItem: AgentInputItem, session: Session): Promise<void>;
}
export {};
