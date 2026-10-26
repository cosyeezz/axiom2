import type { Session } from '../../../vendor/cbc-core/node/index.js';
/**
 * 宿主提供的信任目录。专家市场只豁免 plugins 子目录，市场配置与管理文件不在范围内。
 */
export interface TrustedRoot {
    path: string;
    plugin?: string;
    collection?: 'skills' | 'experts';
}
export interface TrustedBuiltinCodeAction {
    toolName: string;
    toolInput: unknown;
    cwd?: string;
    session?: Session;
    queries?: Map<string, Promise<string>>;
    /** 这次调用的合并环境：Agent 环境上叠宿主 shell 环境策略的 set。缺省为进程环境。 */
    env?: NodeJS.ProcessEnv;
}
/**
 * 只豁免整条命令中来源可确认的内置脚本及受限配套操作；文件只豁免 Read 的真实目标。
 * 查询失败回到正常审查。判定只在本次调用内复用，避免 PATH、快照或插件更新后继续使用旧来源。
 */
export declare function isTrustedBuiltinCodeAction(action: TrustedBuiltinCodeAction, resolveRoots?: () => Promise<readonly TrustedRoot[]>): Promise<boolean>;
/**
 * 企业微信 CLI 的返回整体信任，免于防注入检测；调用前审查不受影响，不得复用于动作豁免。
 * 整条命令只能调用宿主 CODEBUDDY_SHELL_PREPEND_PATH 提供的 wecom-cli，其余仅限纯输出与标准输入过滤，
 * 防止同一条命令夹带其他来源的内容。
 * ponytail: 沙箱与凭据文件环境无法向 shell 查询解析结果，按宿主目录前置于 PATH 认定裸命令命中宿主版本；
 * 用户 shell 配置中的同名函数、别名及被覆盖的过滤命令不在判定范围内，需要时改为执行期回报实际可执行文件。
 */
export declare function isWecomCliCommand(toolName: string, toolInput: unknown, cwd?: string, env?: NodeJS.ProcessEnv): Promise<boolean>;
/**
 * 信任根：内置 Skill 目录、宿主托管专家市场目录，以及当前已加载插件中来自内置市场或该专家市场的安装目录。
 * `experts` 需同时匹配宿主注册的目录源，同名的用户市场与 `my-experts` 不属于信任根。
 */
export declare function resolveTrustedBuiltinCodeRoots(): Promise<TrustedRoot[]>;
