import { type AgentInputItem } from '../../../cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { AgentManager } from '../agent/agent-protocol';
import { AgentInputItemProcessor, AgentInputItemProcessorPriority, Session } from './session-protocol';
export declare class DefaultInputItemProcessor implements AgentInputItemProcessor {
    priority: AgentInputItemProcessorPriority;
    protected readonly agentManager: AgentManager;
    protected readonly logger: Logger;
    process(rawItem: AgentInputItem, session: Session): Promise<void>;
    /**
     * Marks successful legacy /compact assistant output as an explicit compact boundary.
     */
    private markSuccessfulCompactAssistantSummary;
}
export declare class ParentIdLinkageProcessor implements AgentInputItemProcessor {
    priority: AgentInputItemProcessorPriority;
    process(rawItem: AgentInputItem, session: Session): Promise<void>;
    private resolveParentId;
    private hasHistoryItem;
    private parentChainReaches;
}
export declare class FunctionCallResultAgentInputItemProcessor implements AgentInputItemProcessor {
    priority: AgentInputItemProcessorPriority;
    /** output 对象 → 首次归一的结果；见 process 中的复用说明。 */
    private readonly normalizedOutputs;
    /**
     * Check if an item is a ToolCallStructuredOutput (InputText | InputImage | InputFile).
     * These are the types that OpenAI agents SDK's convertStructuredToolOutputToInputItem produces.
     *
     * @param item - The item to check
     * @returns true if the item is a ToolCallStructuredOutput
     */
    private isToolCallStructuredOutput;
    /**
     * Reverse the convertStructuredToolOutputToInputItem transformation from OpenAI agents SDK.
     * This converts OpenAI agents protocol types back to MCP content types.
     *
     * In OpenAI agents SDK:
     * - convertStructuredToolOutputToInputItem: StructuredToolOutput → ToolCallStructuredOutput
     * - ToolCallStructuredOutput = InputText | InputImage | InputFile
     *
     * This method does the reverse:
     * - reverseInputItemToMcpContent: ToolCallStructuredOutput → StructuredToolOutput
     *
     * Transformations:
     * - {type: 'input_text', text: '...'}    → {type: 'text', text: '...'}
     * - {type: 'input_image', image: '...'}  → {type: 'image', image: '...'}
     * - {type: 'input_file', file: {...}}    → {type: 'file', file: {...}}
     *
     * @param item - ToolCallStructuredOutput from OpenAI agents SDK (input_text, input_image, input_file)
     * @returns MCP StructuredToolOutput (text, image, file)
     */
    private reverseInputItemToMcpContent;
    process(rawItem: AgentInputItem, _session: Session): Promise<void>;
    private normalizeTextOutput;
    private stripSensitiveProtectionSideband;
}
export declare class UsageAgentInputItemProcessor implements AgentInputItemProcessor {
    priority: AgentInputItemProcessorPriority;
    process(rawItem: AgentInputItem, session: Session): Promise<void>;
}
//# sourceMappingURL=input-item-processors.d.ts.map