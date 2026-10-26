/** 用户消息上附隐藏房间花名册（system-reminder）。 */
import { AgentRunInterceptor, AgentRunRequest } from '../../vendor/cbc-core/node/index.js';
import { SettingsManager } from '../settings/settings-protocol';
export declare class AgentHomeRoomContextInterceptor implements AgentRunInterceptor {
    priority: number;
    protected readonly settingsManager?: SettingsManager;
    intercept(request: AgentRunRequest): Promise<void>;
    /**
     * 信封带了 mention_ids 且没有自己：这封是点别人的，不要回。
     * sessionId 与工具路径同源：已登记、无 jobId 的同事会话只有靠它才认得出自己
     * （漏传会按默认 Agent 判 @ 命中，把点别人的信当自己的回，见 #125667 F6）。
     */
    private channelMailIsForSomeoneElse;
    private lastUserMessageText;
    private attachRoomRoster;
    private lastUserMessageHasReminder;
    /**
     * 频道叫醒：只教 SpeakInChannel，不挂房间花名册（否则模型会去 MessageColleague）。
     * 入站是 function_call_result 时挂不上 last user，所以在回执后补一条 isMeta reminder。
     */
    private attachChannelReminder;
    /**
     * 看板注入：lead 拿完整快照、成员拿一行概览（详略由 copy 层决定）。
     * 挂进同一条 reminder，避免 inputHasChannelReminder 去重导致二次注入失效。
     */
    private boardBrief;
    private inputHasChannelReminder;
    private incomingFromReceipt;
    /**
     * History 拦截器已经把 request.input 换成了 session.history 的同一引用。
     * 提醒必须写在副本上，否则会改脏落盘历史，回放时同一封信再画一张卡片。
     */
    private detachLastUserMessage;
}
