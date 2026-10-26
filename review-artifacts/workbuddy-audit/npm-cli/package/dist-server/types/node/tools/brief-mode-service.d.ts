import { CliProvider } from '../cli/cli-protocol';
export declare const BriefModeService: unique symbol;
/**
 * Brief 模式（issue #82025，对齐 claude-code `--brief`）的运行时开关读取入口。
 *
 * 开启后启用 `SendUserMessage` 工具作为 Agent 面向用户的主要可见输出通道，
 * 并在系统提示中注入 brief 引导。开关只控制工具是否**可见/可调用**，
 * 工具本身常驻工具列表，运行时由本服务的 opt-in 状态决定启用。
 */
export interface BriefModeService {
    /**
     * 是否已开启 Brief 模式。
     *
     * 由 `--brief` CLI flag 或 `CODEBUDDY_BRIEF` 环境变量任一激活。
     */
    isBriefEnabled(): boolean;
}
export declare class BriefModeServiceImpl implements BriefModeService {
    protected readonly cliProvider: CliProvider;
    /**
     * 运行时 live 读 flag / env —— 绝不在 constructor / @PostConstruct 固化，
     * 以兼容 prewarm：activate 时 `applyPrewarmArgs` 会重写 process.argv，
     * 之后本方法首次被消费才读，天然拿到透传后的真实值。
     */
    isBriefEnabled(): boolean;
}
