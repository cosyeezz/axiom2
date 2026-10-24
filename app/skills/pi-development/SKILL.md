---
name: pi-development
description: Axiom is built on Pi. Use this skill when developing, configuring, or troubleshooting Axiom's underlying tools, sessions, resource loading, models and providers, extensions, or MCP capabilities, or when modifying Pi itself. It explains how to consult the installed version's SDK, skill, theme, and TUI documentation and examples.
---

# Pi 开发与配置

Axiom 基于 Pi 构建，使用 Pi SDK 提供底层工具、会话、资源加载、模型与提供商、扩展和 MCP 等能力。修改或排查这些 Axiom 能力时，先使用本技能定位当前依赖的 Pi 文档及示例，再核对 Axiom 中对应的集成代码。本技能也适用于 Pi 本身及其他基于 Pi 的应用开发、配置与排障。普通聊天和无关项目开发无需查阅 Pi 文档。

## 定位当前版本

运行本技能目录下的 `scripts/documentation-paths.mjs`（使用 `node`），取得当前应用实际依赖的 Pi 版本，以及 README、docs、examples 的绝对路径。脚本通过应用依赖解析，不依赖用户项目的工作目录，也不假定全局安装位置。

先完整阅读返回路径中的 README.md。按任务阅读下表中的文档和相关示例，实施前继续阅读相关 Markdown 交叉引用。Pi Markdown 文件需要完整读取；遇到工具输出截断，继续读取剩余部分。

`docs/...` 相对于脚本返回的 docs 目录；`examples/...` 相对于返回的 examples 目录。不要相对于当前工作目录解析。API 和示例以当前安装版本为准，必要时核对包中导出的类型声明和实现。

## 文档索引

| 任务 | 文档及示例 |
| --- | --- |
| SDK 嵌入、会话与资源加载 | docs/sdk.md；examples/sdk/ |
| 扩展、自定义工具和生命周期钩子 | docs/extensions.md；examples/extensions/ |
| 技能创建、发现与按需加载 | docs/skills.md |
| 提示词模板 | docs/prompt-templates.md |
| 配置、系统提示词及资源路径 | docs/configuration.md；docs/settings.md |
| 主题 | docs/themes.md |
| TUI 组件与交互界面 | docs/tui.md |
| 快捷键 | docs/keybindings.md |
| 自定义提供商 | docs/custom-provider.md |
| 添加模型 | docs/models.md |
| Pi 包与资源分发 | docs/packages.md |
| 环境变量 | docs/environment-variables.md |
| MCP 服务器 | docs/mcp.md |
| Codemode 脚本、分类器及图像等非语言模型 | docs/codemode.md |

SDK 集成优先使用公开 API。修改系统提示词时，核对自定义提示词、追加指令、项目上下文、技能目录及扩展钩子的组合方式；涉及预览或重载时，验证其与真实会话一致。不要直接修改 node_modules 中的安装文件作为持久方案。
