import { Logger } from '@celljs/core';
import { PathResolver } from '@celljs/web';
import { Context, Middleware, RequestMatcher } from '@celljs/web/lib/node';
import { Session, SessionAdmissionService, SessionManager, SessionStartupApplier } from '../../vendor/cbc-core/node/index.js';
import { SessionStartSource } from '../../vendor/cbc-shared/node/index.js';
import { ChannelManager } from '../channel';
import { CliProvider } from '../cli/cli-protocol';
import { type ITuiModeService } from '../cli/tui-mode-service';
import { CommonRequest } from '../loopback';
import { type CapabilityPreparationService as ICapabilityPreparationService } from '../mcp/capability-preparation-protocol';
import { CliSettingsProvider } from '../settings/cli-settings-provider';
import { ToolPermissionService } from '../tools';
/**
 * 把本次 /internal/agent body 摊进 session.options。
 * Web ACP 续接可保留会话自己的权限模式；未 opt-in ACP 维持启动参数语义。
 */
export declare function mergeIncomingSessionOptions(session: Session, body: CommonRequest, source: SessionStartSource, options?: {
    preserveExistingPermissionMode?: boolean;
}): void;
export declare class SessionMiddleWare implements Middleware {
    readonly priority: number;
    protected readonly admission: SessionAdmissionService;
    protected readonly logger: Logger;
    protected readonly requestMatcher: RequestMatcher;
    protected readonly pathResolver: PathResolver;
    protected readonly sessionManager: SessionManager;
    protected readonly toolPermissionService: ToolPermissionService;
    /**
     * SessionStart 预检与权限模式落地。混合模式下 A2A 通道会绕过本中间件直接
     * 建会话，所以这两件事必须由两条路径共用同一份实现，见
     * {@link SessionStartupApplier}。
     */
    protected readonly startupApplier: SessionStartupApplier;
    protected readonly channelManager?: ChannelManager;
    protected readonly cliProvider?: CliProvider;
    protected readonly cliSettingsProvider: CliSettingsProvider;
    protected readonly tuiModeService?: ITuiModeService;
    protected readonly capabilityPreparation?: ICapabilityPreparationService;
    handle(ctx: Context, next: () => Promise<void>): Promise<void>;
    private canHandle;
    /**
     * 新建智能体 / 交互 CLI 的 first POST：只在空白且无站立键的会话上
     * 把 `--agent ptc|minimal|create|cli` 写成站立键。已有模式或历史不覆盖。
     * ACP 请求（`acp:true`）不在这里盖，改由 opt-in 后的 newSession 处理。
     */
    private maybeStampNativeCliStandingAgent;
    private incomingAcpHostKind;
    private seedContextWindow;
    private applyOverrideModel;
    /**
     * 规范化工具规约。该方法会就地修改 body：
     *
     *   - body.tools 字符串：解析 Defer/NoDefer 修饰，把剥离修饰后的纯名 join 回
     *     字符串写回 body.tools；overlay snapshot 写到 body.toolDeferOverlay。
     *     overlay 始终覆写（即便为空快照），避免 resume 场景下旧 overlay 残留——
     *     用户重写 --tools 即视为重新表态。
     *   - body.allowedTools / body.disallowedTools：校验不允许出现 Defer/NoDefer
     *     前缀。这两个字段是权限规则字段，与"暴露策略"语义正交。
     *
     * 仅在 body.tools 字段被 *显式* 提供（非 undefined / 非 'default'）时才动它。
     * tools 为 undefined 时保留 session.options 已有的 toolDeferOverlay（resume 场景）。
     *
     * 任何非法语法（含逗号在 spec 里、嵌套修饰、误用权限语法等）会抛 Error，
     * 调用方原本的请求-响应流程会把错误信息回传给用户。
     */
    private normalizeToolSpecs;
    /**
     * 权限规则字段的 sanitize：扫描 entries 里是否有 `Defer(...)` / `NoDefer(...)`
     * 前缀。命中即抛出清晰错误指引用户改写到 --tools。
     */
    private assertNoDeferModifier;
}
