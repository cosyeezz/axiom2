import { Logger } from '@genie/telemetry';
import { ChannelEventService, ChannelManager } from '../../channel';
import { AgentRunInterceptor, AgentRunRequest } from '../../../vendor/cbc-core/node/index.js';
/**
 * Channel Event Injection Interceptor
 *
 * 在 Agent 执行前从 session 的待处理 channel 事件队列消费事件
 * 并将其格式化为 `<channel>` 标签注入到请求的 input 末尾（作为系统提醒）
 *
 * 优先级：1170 - 在 SystemReminderContext (1200) 之后，MessageReorganize (1300) 之前
 * 这样做的好处：
 * 1. SystemReminder 在非收窄模式注入 channel instructions（指导说明）。
 *    极简没有 channel 发送工具，只保留本拦截器的事件正文。
 * 2. 本拦截器注入具体的 channel 事件（实际推送）
 * 3. MessageReorganize 最后再做消息整理
 */
export declare class ChannelEventAgentRunInterceptor implements AgentRunInterceptor {
    protected readonly logger: Logger;
    protected readonly channelManager: ChannelManager;
    protected readonly channelEventService: ChannelEventService;
    priority: number;
    intercept(request: AgentRunRequest): Promise<void>;
    /**
     * 将多个 channel 事件格式化为 XML 格式的系统提醒
     * 格式: <system-reminder>
     *   <channel source="...">...</channel>
     *   <channel source="...">...</channel>
     * </system-reminder>
     */
    private formatChannelEvents;
    /**
     * 格式化单个 channel 事件为 XML 格式
     * 格式: <channel source="server-name" key="value">content</channel>
     */
    private formatChannelEvent;
    /**
     * 转义 XML 属性值中的特殊字符
     */
    private escapeXmlAttr;
    /**
     * 转义 XML 内容中的特殊字符
     */
    private escapeXmlContent;
}
