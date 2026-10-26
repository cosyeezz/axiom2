/**
 * /effort <level> —— 切换 effort 档位。
 *
 * 两类档位：
 *   - `low` / `medium` / `high` / `xhigh` / `max`:模型 reasoning effort,写会话级
 *     override(与 ACP thought_level 同一通道),并按当前模型能力校验
 *   - `ultracode`:开启 workflow 自动编排;后续每轮注入持续提醒
 *     (由 UltracodeEffortReminderInterceptor 驱动)
 *
 * 未识别的 level 直接拒绝,不写入任何状态。
 *
 * Reminder 文本通过 PromptManager 从 prompt template 加载:
 *   - workflow-ultra-effort-enter
 *   - workflow-ultra-effort-exit ({{previous}}, {{current}})
 */
import { PromptManager } from '@genie/prompts';
import { Logger } from '@genie/telemetry';
import { AcpBroadcastService } from '../acp/acp-protocol';
import { Session, SessionManager } from '../../vendor/cbc-core/node/index.js';
import { SettingsManager } from '../settings';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class EffortCommandExecutor implements CommandExecutor {
    name: string;
    autoGenerateHistory: boolean;
    protected readonly logger: Logger;
    protected readonly sessionManager: SessionManager;
    protected readonly settingsManager: SettingsManager;
    protected readonly promptManager: PromptManager;
    protected readonly acpBroadcastService?: AcpBroadcastService;
    execute(ctx: CommandExecuteContext): Promise<void>;
    /** Visible-for-testing:argv → level 字符串 */
    static parseLevel(args: unknown[]): string;
    /** Visible-for-testing:把 (session, level) → stdout 字符串 + 副作用更新 meta */
    run(session: Session, level: string): Promise<string>;
    /**
     * 把新的 thought_level 同步给正在看该会话的 Web UI 连接。
     *
     * TUI 侧改档位只写 session override，不经过 ACP setSessionConfigOption，因此不会
     * 触发 configChangeEvent，Web UI 的选择器会一直停在旧值（"CLI 里改了、Web UI 还是
     * 默认思考强度"）。这里主动推一次完整 configOptions 补上这条链路。
     *
     * 最佳努力：没有 Web UI 连接时是 no-op；推送失败只告警，不影响命令本身的成功语义
     * （override 已经生效），所以不 await，避免慢连接拖住命令回显。
     */
    private notifyConfigOptionsChanged;
    /**
     * 持久化 reasoning effort 到用户全局 settings。写入失败不阻断命令（override 已生效），仅告警。
     */
    private persistReasoningEffort;
    /**
     * Issue #87437: 解析当前模型支持的档位集合。
     *
     * 返回 `levels === undefined` 有两种含义，用 `resolutionFailed` 区分，避免把
     * "解析失败" 静默当成 "模型不限制档位"：
     *   - 模型未建模能力（预期）→ resolutionFailed=false
     *   - 解析异常（容器未装配 / 模型解析回归）→ resolutionFailed=true，usage 会提示
     */
    private resolveCurrentModelEfforts;
    /**
     * Issue #58743: 解析当前"用户会看到的" effort 档位。
     *   ultracode > session override.reasoningEffort > merged settings.reasoningEffort
     * 保持与 EffortPanel 的初始高亮同源，避免同一状态两处出现不同答案。
     */
    private resolveEffectiveLevel;
    private loadTemplate;
    private fallbackExit;
    private appendHistory;
}
