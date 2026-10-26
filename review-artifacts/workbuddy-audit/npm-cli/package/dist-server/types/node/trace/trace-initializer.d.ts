import { Application, ApplicationLifecycle } from '@celljs/core';
import { AuthenticationManager } from '@genie/authentication';
import { ClientInfoProvider, ProductManager } from '@genie/product';
import { InitOptions, Logger, TraceService } from '@genie/telemetry';
import { type IPrewarmStateService } from '../prewarm/prewarm-protocol';
import { TraceCollectorProcessor } from './trace-collector-processor';
export declare class TraceServiceLifecycle implements ApplicationLifecycle<Application> {
    private reinitializeSubscription?;
    private stopped;
    private activationDeferred;
    protected readonly logger: Logger;
    protected readonly traceService: TraceService;
    protected readonly productManager: ProductManager;
    protected readonly clientInfoProvider: ClientInfoProvider;
    protected readonly authenticationManager: AuthenticationManager;
    protected readonly traceCollectorProcessor: TraceCollectorProcessor;
    protected readonly prewarmState?: IPrewarmStateService;
    initialize(): void;
    /**
     * 启动 tracing —— 不阻塞 CellJS 串行启动链路。
     *
     * TracerProvider.init() 内部 await productManager.waitConfiguration()，
     * 在 sidecar（--serve）环境下 product config 可能延迟就绪，如果阻塞
     * 会导致 HTTP server listen 被推迟 30s+，SidecarManager 判定不可达后
     * kill 进程，最终表现为"暂无对话记录"。
     *
     * 改为 fire-and-forget：后台初始化，首批请求若在 tracer ready 前到达
     * 会得到 EmptySpan（可接受的降级），不影响功能正确性。
     */
    onStart(): void;
    protected doInitialize(): void;
    onStop(): void;
    private initTimestamp?;
    protected buildInitOptions(): Promise<InitOptions>;
    protected initTracing(): Promise<void>;
}
