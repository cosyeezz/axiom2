import { Command } from 'commander';
export declare const CliDispatcher: unique symbol;
export declare const CliProvider: unique symbol;
export declare const DispatchStrategy: unique symbol;
/** Request-local controller/view handoff; never part of a wire message or Session. */
export declare const STREAM_JSON_RUN_RESULT = "codebuddy.streamJsonRunResult";
export declare const STREAM_JSON_COMPLETED_REQUEST = "codebuddy.streamJsonCompletedRequest";
export interface CliDispatcher {
    dispatch(): Promise<void>;
}
export interface CliProvider {
    get(): Promise<Command>;
    parseOpts(): {
        arg: string[];
        opts: Record<string, any>;
    };
}
/**
 * 运行时上下文 - 只包含运行时数据，不包含依赖
 */
export interface DispatchRuntimeContext {
    cli: Command;
    pipeInput: string;
    headers?: Record<string, string>;
}
/**
 * 分发策略接口 - 依赖通过 @Autowired 注入
 * 策略之间互斥，第一个 canHandle 返回 true 的策略执行后即结束
 * 除非策略返回 false 表示继续执行链
 */
export interface DispatchStrategy {
    /**
     * 判断策略是否适用
     */
    canHandle(context: DispatchRuntimeContext): boolean;
    /**
     * 执行策略
     * @returns true 表示终止策略链，false 表示继续执行下一个策略
     */
    execute(context: DispatchRuntimeContext): Promise<void | boolean>;
    /**
     * 策略优先级(数字越小优先级越高)
     */
    priority: number;
}
export interface RequestOptions {
    interactive: boolean;
    url: string;
    path: string;
    body: Record<string, any>;
    outputFormat?: string;
    errorContext?: string;
    headers?: Record<string, string>;
}
