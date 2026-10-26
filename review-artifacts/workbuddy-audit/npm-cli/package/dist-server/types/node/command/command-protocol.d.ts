import { InputText, Session } from '../../vendor/cbc-core/node/index.js';
import { Command } from '@genie/product';
export declare const CommandManager: unique symbol;
export declare const CommandExecutor: unique symbol;
export declare const CustomCommandRenderer: unique symbol;
export declare const McpPromptRenderer: unique symbol;
/**
 * XML 标签枚举，用于命令序列化和反序列化
 */
export { CommandXmlTags } from '../../vendor/cbc-shared/node/index.js';
export interface CommandManager {
    get(name: string): Promise<Command | undefined>;
    register(name: Command): Promise<void>;
    unregister(name: string): Promise<void>;
    getAll(): Promise<Command[]>;
    /**
     * 重扫命令源(包括 saved workflow registry)。
     * saveAs 完成 / 用户手动同步 workflows 目录后调用,让 `/<name>` 立刻可用且出现在补全里。
     */
    refresh(): Promise<void>;
    getNonModelCommands(): Command[];
    /** 获取所有内置命令（包括条件命令，同步），用于命令解析和路由 */
    getAllNonModelCommands(): Command[];
    /** 获取所有启用的内置命令（包括条件命令，异步） */
    getEnabledNonModelCommands(): Promise<Command[]>;
    getCustomCommands(): Promise<Command[]>;
    getMcpCommands(): Promise<Command[]>;
    /** 判断内置命令是否被自定义命令或 Skill 覆盖（同步） */
    isOverriddenByCustom(name: string): boolean;
    /** 判断命令是否为内置命令（本地执行的命令） */
    isLocalCommand(command: string): boolean;
    parseCommand(input: string): {
        name: string;
        args: any[];
    } | undefined;
    executeLocalCommand(ctx?: CommandExecuteContext): Promise<void>;
    finalizeCommandExecution(session: Session, stdout?: string): Promise<void>;
}
export interface CommandExecutor {
    name: string;
    message?: string;
    autoGenerateHistory?: boolean;
    execute(ctx: CommandExecuteContext): Promise<void>;
}
export interface CustomCommandRenderer {
    render(command: Command, input: string): Promise<string>;
    /**
     * Process markdown content with inline bash execution, argument replacement, and file references.
     * Pipeline: $ARGUMENTS replacement → !`command` execution → @file reference processing
     * @param content The markdown content to process
     * @param args Optional arguments to replace $ARGUMENTS placeholder
     * @returns The processed content with all substitutions applied
     */
    processContent(content: string, args?: string): Promise<string>;
}
export interface McpPromptRenderer {
    render(command: Command, input: string): Promise<string>;
}
export interface CommandAction {
    type: 'start' | 'input' | 'end' | 'cancel';
    input?: any;
}
export interface CommandExecuteContext {
    name: string;
    session: Session;
    args: any[];
    history?: InputText[];
    signal?: AbortSignal;
    /** Timestamp of the originating user message when supplied by an ACP client. */
    timestamp?: number;
}
export interface CommandExecuteResult {
    stdout?: string;
    skipRun?: boolean;
    done: boolean;
}
export interface CommandSourceInfo {
    name: string;
    message?: string;
    args: any[];
}
export declare const NON_MODEL_COMMANDS: Command[];
export declare enum LocalCommandNames {
    Bash = "/bash",
    Memory = "/memory",
    Add = "/memory"
}
export declare enum CommandNames {
    Agent = "Agent"
}
export declare const CUSTOM_COMMAND_TAG = "custom";
export declare const MCP_PROMPT_COMMAND_TAG = "mcp-prompt";
export declare const PLUGIN_TAG = "plugin";
export declare const SKILL_COMMAND_TAG = "skill";
/** Saved Dynamic Workflow 注册成 `/<name>` 命令时打的 tag(对齐 CC v2.1 行为)。 */
export declare const WORKFLOW_COMMAND_TAG = "dynamic-workflow";
/** Dynamic Workflow 命令描述统一前缀,UI 列表/补全里一眼可识别。 */
export declare const WORKFLOW_COMMAND_DESC_PREFIX = "[dynamic workflow]";
/** 带条件启用的内置命令定义 */
export interface ConditionalCommand {
    command: Command;
    /** 异步判断命令是否启用 */
    isEnabled: () => Promise<boolean>;
}
/** 需要条件判断的内置命令 */
export declare const CONDITIONAL_COMMANDS: ConditionalCommand[];
