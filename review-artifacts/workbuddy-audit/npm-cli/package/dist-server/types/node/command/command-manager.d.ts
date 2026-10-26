import { Deferred } from '@celljs/core';
import { Session, SessionManager } from '../../vendor/cbc-core/node/index.js';
import { type WorkflowRegistry } from '@genie/cbc-workflow';
import { Command, ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import { CommandExecuteContext, CommandExecutor, CommandManager } from './command-protocol';
export declare const FUNCTION_HOOK_COMMAND_TAG = "function-hook-command";
/** The host owns live commands and tombstones; refresh must not resurrect withdrawn entries. */
export interface ModsCommandManager extends CommandManager {
    register(command: Command, executor?: CommandExecutor): Promise<void>;
    isUnregistered(name: string): boolean;
}
export declare class CommandManagerImpl implements CommandManager {
    protected readonly productManager: ProductManager;
    protected readonly sessionManager: SessionManager;
    protected readonly commandExecutors: CommandExecutor[];
    protected readonly workflowRegistry?: WorkflowRegistry;
    protected readonly logger?: Logger;
    protected readyDeferred: Deferred<void>;
    protected commands: Map<string, Command>;
    protected commandExecutorMap: Map<string, CommandExecutor>;
    private readonly registrations;
    executingCommand: CommandExecuteContext;
    protected init(): void;
    private scopedCommands;
    get(name: string): Promise<Command | undefined>;
    register(command: Command, executor?: CommandExecutor): Promise<void>;
    unregister(name: string): Promise<void>;
    isUnregistered(name: string): boolean;
    private registeredNonModelCommands;
    /**
     * 强制重扫命令源(目前主要是 saved workflow registry)。
     * `saveAs` 写完文件后调一下,让新工作流的 `/<name>` 立刻可被识别 + 出现在补全里。
     *
     * 不重读 ProductManager(那有自己的 subscribe);仅刷"动态可变"的部分。
     */
    refresh(): Promise<void>;
    getAll(): Promise<Command[]>;
    protected rebuildCommands(): Promise<void>;
    private injectSavedWorkflowCommands;
    getNonModelCommands(): Command[];
    getAllNonModelCommands(): Command[];
    getEnabledNonModelCommands(): Promise<Command[]>;
    getCustomCommands(): Promise<Command[]>;
    getMcpCommands(): Promise<Command[]>;
    isOverriddenByCustom(name: string): boolean;
    isLocalCommand(command: string): boolean;
    parseCommand(input: string): {
        name: string;
        args: any[];
    } | undefined;
    executeLocalCommand(ctx?: CommandExecuteContext): Promise<void>;
    finalizeCommandExecution(session: Session, stdout?: string): Promise<void>;
}
