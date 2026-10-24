# 会话系统提示词与 Pi 开发技能

Axiom 基于 Pi 构建。默认常驻提示词继续由 Pi 原生构建器生成，保留原生英文工具描述（tools）和调用规则（rules），包括当前可用工具及扩展提供的动态内容。`app/src/server/axiom-prompt.ts` 仅将默认身份段改为 Axiom 助手，并移除默认 Pi 开发文档段。文档索引与查阅规则迁入 `app/skills/pi-development/SKILL.md`，在修改或排查 Axiom 底层能力、Pi 本身时按需读取。

## 启动与加载

1. 后台启动时创建工作空间、会话和能力管理服务。此时不因启动程序而调用模型。
2. 打开未执行会话时，能力发现读取项目、用户及已安装包的资源，加入随应用分发的 `pi-development` 技能。环境预览使用相同的资源选项和 Pi 提示词构建器；不创建 AgentSession、运行模型、执行扩展或连接 MCP。
3. 首次发送消息时，worker 加载资源并创建 Pi AgentSession，在绑定扩展和发起请求前安装提示词适配。`environmentResourceOptions` 为预览与运行统一提供技能和追加规则，不设置整体 `systemPromptOverride`。
4. 用户的 `SYSTEM.md` 优先于 Axiom 默认提示词；`APPEND_SYSTEM.md`、项目上下文、会话记忆维护规则及子代理策略继续按原有规则组合。

   Axiom 自带的主/子会话追加规则、模型可见的任务与记忆工具说明、内置 `pi-development` 技能目录简介均使用英文。用户自定义指令和外部资源保持原文。记忆解析器支持英文六状态与既有中文状态，任务树维护机制保持完整；详情由程序按稳定的标题层级关联独立文件，主记忆仅含带状态的嵌套标题。完整提示词及实现边界见[标题路径详情系统提示词](memory-title-details-system-prompt.md)；参见[记忆提示词接入](memory-refactor/00-system-prompt.md)。
5. 启动提示词只包含自动发现已启用技能的名称、描述和路径。涉及 Pi 的任务读取 `pi-development` 正文后，再按任务读取当前安装版本的文档和示例。
6. 技能开关只控制自动发现，取消勾选后仍支持显式 `/skill:pi-development` 或技能引用。全量会话重载重新加载提示词与资源；仅切换技能不会重载项目指令或重连 MCP。

## 技能分发与文档路径

`app/skills/` 纳入应用包。开发态和编译后的服务端通过同一相对层级定位技能，无需复制到用户目录。用户已有同名技能按原有发现顺序优先，应用技能作为兜底。

技能内的 `scripts/documentation-paths.mjs` 从应用安装的 `@earendil-works/pi-coding-agent` 获取版本、README、docs、examples 路径，不固定机器绝对路径，也不从用户工作空间解析另一份 Pi。

Pi 1.1.0 的 `systemPromptOverride` 会跳过默认 tools/rules，公开接口也不允许单独覆盖 preamble。因此适配集中在 `axiom-prompt.ts`：调用原生构建器后，仅替换原生默认 preamble、移除完全匹配的默认 docs，其余段逐字保留，不静态复制工具规则。预览与 `session.systemPrompt` 使用同一构建函数。

运行时对 Pi 1.1.0 的 `_preparePromptAndToolLoadout` 做版本绑定适配：先执行原生方法解析实际及隐藏工具，再对适配后的完整段落与历史状态做差异比较。这样旧会话的结构化 docs 段只删除一次，工具切换、隐藏声明和资源重载继续动态更新。更早版本写入 system.content 的纯文本历史遵循 Pi 原生重放机制，本适配不重写这些历史文本。升级 Pi 时需复核此内部接口并运行回归测试；不修改安装目录中的 SDK 文件。

用户 `SYSTEM.md` 保持原生优先级。扩展明确提供的 docs 段和独立强制提示词保持原样；扩展从默认 Pi 提示词追加内容生成的强制提示词仅调整默认身份和文档段，保留追加内容。扩展 `before_agent_start` 事件中的中间 `systemPrompt` 仍由 Pi 原生生成，适配作用于最终请求和环境快照。

## 生效与验证

源码变更需重新构建并重启后台后生效。新会话按新配置构建提示词；已运行的会话需要全量重载。历史实际环境快照保留原样，不用当前预览覆盖。

`axiom-prompt.test.ts` 覆盖原生英文 tools/rules 逐字保留、动态及隐藏工具、旧文档段一次性清理、中文历史到英文 addendum/skills 的一次性更新、无变化重载不重复更新、强制提示词、中文自定义指令优先级、技能按需加载与文档路径定位。`session-environment.test.ts` 验证静态资源下预览与实际会话提示词逐字一致；`session-reload.test.ts` 检查重载前后实际模型请求中保留 tools/rules 并移除默认 docs。
