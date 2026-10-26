/**
 * 把会话 history 转成交接层需要的最小消息形状。
 *
 * 单独成文件是为了让 ← hook 与 `/bg`、`/fork-bg` 三个入口共用同一份转换，
 * 否则「seed 从哪条消息派生」会在三处各写一遍，很快就会漂移。
 */
import { type AgentInputItem } from '../../vendor/cbc-shared/node/index.js';
import { type HandoffSeedMessage } from '../agent-view/session-handoff';
export declare function historyToHandoffMessages(history: readonly AgentInputItem[]): HandoffSeedMessage[];
