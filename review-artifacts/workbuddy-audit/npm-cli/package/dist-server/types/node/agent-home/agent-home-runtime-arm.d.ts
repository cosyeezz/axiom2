import { type AgentHomeSettingsSource } from './agent-home-settings';
export { isAgentHomeRuntimeArmed } from './agent-home-runtime-arm-state';
/**
 * 消费者注册启动回调：armed 时立刻启动，否则等 arm 时统一启动。
 * 注册本身零副作用（内存表，不碰盘、不起定时器）。
 */
export declare function registerAgentHomeStarter(start: () => void): () => void;
/**
 * 按用户开关决定是否 arm（幂等；并发调用合并成一次设置读）。
 * 开关关闭 = 运行时保持休眠：**不建目录、不起 watch / 定时器**。
 */
export declare function ensureAgentHomeRuntimeArmed(settingsManager?: AgentHomeSettingsSource): Promise<boolean>;
/** 测试用：复位 arm 状态与已注册的消费者。 */
export declare function __resetAgentHomeRuntimeArmForTests(): void;
