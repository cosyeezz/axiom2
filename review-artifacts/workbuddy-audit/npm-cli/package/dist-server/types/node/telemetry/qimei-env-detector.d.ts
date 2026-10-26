import { Logger } from '@celljs/core';
import { QimeiDetector } from '@genie/telemetry';
/**
 * agent-cli 侧 QIMEI36 探测器。
 *
 * WorkBuddy Desktop/app-server 负责 native SDK 探测，agent-cli 子进程只从环境变量
 * 动态读取已探测到的值，避免在 CLI 进程里再次加载 native SDK。
 */
export declare class EnvQimeiDetector implements QimeiDetector {
    protected readonly logger: Logger;
    /** env 缺失只 warn 一次，避免每次遥测上报都刷日志。 */
    private missingWarned;
    getSync(): string | undefined;
    getAsync(): Promise<string | undefined>;
    protected readEnv(): string | undefined;
}
