import { AgentManager, SessionManager, SessionRunStateMachine } from '../../vendor/cbc-core/node/index.js';
import { CliSettingsProvider } from './cli-settings-provider';
import { type CurrentSessionModelTransition as CurrentSessionModelTransitionContract, type CurrentSessionModelTransitionResult } from './current-session-model-transition-protocol';
import { SettingsManager } from './settings-protocol';
/**
 * CLI `/model` 的当前会话切换。切换立即生效，不在这里压缩。
 * 若新模型窗口放不下，下一次预压缩按新模型的阈值触发，并用切换前的模型做摘要。
 */
export declare class CurrentSessionModelTransitionImpl implements CurrentSessionModelTransitionContract {
    protected readonly agentManager: AgentManager;
    protected readonly sessionManager: SessionManager;
    protected readonly stateMachine: SessionRunStateMachine;
    protected readonly settingsManager: SettingsManager;
    protected readonly cliSettingsProvider: CliSettingsProvider;
    transition(input: Parameters<CurrentSessionModelTransitionContract['transition']>[0]): Promise<CurrentSessionModelTransitionResult>;
}
