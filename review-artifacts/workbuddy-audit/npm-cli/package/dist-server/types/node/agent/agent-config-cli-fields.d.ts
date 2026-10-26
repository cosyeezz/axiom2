/**
 * CLI-only extensions to the product `Agent` definition, declared via TypeScript
 * module augmentation so `@genie/product` (owned by another team) stays untouched.
 *
 * These fields are parsed from `.codebuddy/agents/*.md` frontmatter (and plugin
 * agent frontmatter) by agent-cli's own loaders, and consumed only inside
 * agent-cli. Runtime-wise they are plain optional properties on the agent
 * config object; this file only teaches the type system about them.
 *
 * If the product team later adopts any of these fields into
 * `packages/product/src/common/types/agent.ts`, the corresponding line here
 * must be removed (duplicate declarations with different types fail to compile).
 */
import '@genie/product';
declare module '@genie/product' {
    interface Agent {
        /**
         * 原始 Agent 定义中显式声明的 model。
         *
         * Product 模型关系层会把 custom/chat 模型自动追加到 `models`，仅看最终
         * 数组无法区分“定义明确选择了 custom 模型”和“定义没有 model、仅被自动
         * 追加”。保留该字段供运行时恢复真正的定义默认值。
         */
        readonly declaredModel?: string;
        /**
         * 子代理最大轮次（对齐 Claude subagent 的 maxTurns frontmatter）。
         * 生效优先级：env CODEBUDDY_CODE_SUBAGENT_MAX_TURNS > Agent 工具 max_turns 入参 > 本字段。
         */
        readonly maxTurns?: number;
        /**
         * 定义层强制后台运行（对齐 Claude subagent 的 background frontmatter）。
         * true = 该 agent 被 Agent 工具 spawn 时总是走后台，等同调用方传 run_in_background=true；
         * 受 CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS 门控（禁用时降级为同步执行）。
         */
        readonly background?: boolean;
        /**
         * 主 agent 模式（--agent / settings.agent）下自动前置到首条用户消息的提示词
         * （对齐 Claude subagent 的 initialPrompt frontmatter）。
         * 仅主会话首轮生效；子代理 spawn / teammate / 恢复会话不注入。
         */
        readonly initialPrompt?: string;
        /**
         * agent 级持久记忆 scope（对齐 Claude subagent 的 memory frontmatter）。
         * - 'user': <configDir>/agent-memory/<name>/，跨项目共享
         * - 'project': <cwd>/.codebuddy/agent-memory/<name>/，随仓库提交
         * - 'local': <cwd>/.codebuddy/agent-memory-local/<name>/，项目内私有
         * 启用后子代理系统提示注入 MEMORY.md（截断 200 行/25KB），
         * 且显式 tools 白名单自动补 Read/Write/Edit。
         */
        readonly memory?: 'user' | 'project' | 'local';
        /**
         * 选择器展示名（可含空格 / 中文）。缺省回退 `name`。
         * 内置模式用它把稳定 id（cli/ptc/minimal/create）显示成「标准模式」等。
         */
        readonly displayName?: string;
        /**
         * 为 true 时不进入模型的 Agent 候选清单（Agent 工具描述，含 multitask 目录），
         * 避免被模型自动选用；注册、按名称委派和执行配置不变。只控制可见性，不是调用权限。
         * CodeBuddy 扩展字段（frontmatter `disable-model-invocation`），Claude subagent 无对应字段。
         */
        readonly disableModelInvocation?: boolean;
    }
}
