/**
 * 主 Agent 四种模式的唯一政策面。
 *
 * 优先级：环境变量 > settings.json `codebuddy.mainAgent` > 内置默认。
 * 所有入口（Web / TUI / `codebuddy config` / `--settings` / ACP）只读这里。
 */
export declare const ENV_MAIN_AGENT_ENABLED = "CODEBUDDY_MAIN_AGENT_ENABLED";
export declare const ENV_MAIN_AGENT_ALLOW_UNOPTED = "CODEBUDDY_MAIN_AGENT_ALLOW_UNOPTED";
/** ACP 未声明 mainAgentSupport 的宿主（WorkBuddy Desktop / sidecar / 其它 IDE）。 */
export type MainAgentHostKind = 'native' | 'opted-in' | 'unopted';
export interface MainAgentPolicy {
    /** 总闸。关：无 picker、无 standing 解析。缺省开。 */
    readonly enabled: boolean;
    /**
     * 未 opt-in 的 ACP 宿主是否也走 standing 解析。
     * 缺省关：WorkBuddy 始终产品默认 cli。将来要开，只翻这一键。
     */
    readonly allowUnopted: boolean;
    /** 能力生效时，新会话的默认主 agent 名。 */
    readonly defaultName?: string;
    /**
     * 上次 chip / 新建智能体选择。不是「设为默认」。
     * 仅当 `default` 未配置时，空白新会话才回落到这里。
     */
    readonly lastUsedName?: string;
}
export declare const DEFAULT_MAIN_AGENT_POLICY: MainAgentPolicy;
export declare function parseEnvFlag(raw: string | undefined): boolean | undefined;
export declare function trimOptionalName(value: unknown): string | undefined;
export declare function resolveMainAgentPolicy(settings: unknown, env?: NodeJS.Dict<string>): MainAgentPolicy;
/** standing 解析（mainKey / settings default）是否对当前宿主生效。 */
export declare function isStandingMainAgentActive(policy: MainAgentPolicy, hostKind: MainAgentHostKind): boolean;
export declare function hostKindFromClientOptIn(optedIn: boolean): MainAgentHostKind;
