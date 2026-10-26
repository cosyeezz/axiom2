import { type ResolvedSecurityCenterPolicy } from '@genie/product';
/**
 * 从子进程 env 读取产品配置顶层 clientSecurity 并翻译为规范化策略。
 * 顺序：ACC_PRODUCT_CONFIG_V3 → V2 → ACC_PRODUCT_CONFIG_PATH 落盘文件。全部失败返回 managed:false。
 */
export declare function readManagedSecurityPolicyFromEnv(env?: NodeJS.ProcessEnv): ResolvedSecurityCenterPolicy;
/**
 * 读取本次执行生效的企业托管策略。
 *
 * 查询带 Product 时以它的 clientSecurity 为准：同一进程里的会话可能属于不同企业，
 * 进程 env 只代表宿主启动时的那一份。Product 已叠加进程的产品配置，缺 clientSecurity
 * 即未托管，不再回落 env，以免已撤销的策略继续生效。没有查询 Product 时读 env。
 */
export declare function readManagedSecurityPolicy(env?: NodeJS.ProcessEnv): ResolvedSecurityCenterPolicy;
/**
 * 企业托管是否显式把沙箱关掉了。
 *
 * 返回 `true` 时端上必须强制本地执行，**不管调用方（renderer / daemon）传下来的
 * `sandbox.enabled` 是什么** —— 那条链有多个环节可能传错、漏传或传晚：renderer 侧
 * 多个建会话入口各自读 localStorage 镜像、镜像在首屏解析返回前是旧值、daemon 断连
 * 期间的策略变更也追不上。本函数直读本次查询的 Product 或进程 env 里的产品配置，是这条链的 fail-closed 兜底闸。
 */
export declare function isSandboxDisabledByManagedPolicy(env?: NodeJS.ProcessEnv): boolean;
/**
 * 企业托管是否**强制开启**沙箱（显式下发 `sandbox.enabled === true`）。
 *
 * 产品口径（issue #129503）：企业「开启沙箱」是强制使用而非「允许使用」，故端上即使收到
 * `sandbox.enabled=false`（会话选了本地环境、或旧会话残留）也要按开启处理。
 * 与 {@link isSandboxDisabledByManagedPolicy} 构成一对，两者不会同时为真。
 *
 * 注意「强制开」与「强制关」不对称：关是纯判定、立即生效；开只能提升到「尝试启用」——
 * 沙箱仍要过 `ensureSandboxReady`，起不来时调用方按既有策略回落本地执行（普通会话）
 * 或直接抛错（隔离执行域）。本函数只表达意图，不保证沙箱一定拉起成功。
 *
 * 异常回落 `false`：读不到策略不能凭空把用户选的本地环境改成沙箱。
 */
export declare function isSandboxForcedByManagedPolicy(env?: NodeJS.ProcessEnv): boolean;
