import type { ToolIdentity } from './protocol';
/**
 * WorkBuddy 自动化工具创建、启用或改写处于启用状态的定时执行时返回 true。
 * 定时任务会在用户不在场时按提示词自动运行，属于持久化执行；是否由用户本人明确要求交给审查判断。
 */
export declare function establishesScheduledExecution(identity: ToolIdentity, input: unknown): boolean;
/**
 * 模型通过 WorkBuddy 自动化工具把定时任务权限设为 `default` 以外的取值时返回 true，任务状态不影响判断：
 * 暂停任务带上的权限会在之后启用时生效。该字段未向模型开放、应从可信会话继承，但自动化工具仍会采用调用参数；
 * 完全访问的任务运行时不经 AI 审查。完全访问会话本身继承 `fullAccess`，只有原权限需询问的会话中才构成提权，
 * 调用方据此限定使用范围。
 */
export declare function escalatesExecutionPermission(identity: ToolIdentity, input: unknown): boolean;
