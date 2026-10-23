# CodeBuddy CN 协议核验：官方 CLI 2.173.0

本次对官方发布产物进行了 REA 静态分析与人工调用路径复核，确认当前接入的基本端点和消息协议一致，并修复了认证与目录中的若干差异。这不是腾讯公开接口规范，也不能证明真实账号已可用或接口未来不会变化。

## 证据与方法

- npm 包：`@tencent-ai/codebuddy-code@2.173.0`，来源 `https://registry.npmjs.org/@tencent-ai/codebuddy-code/-/codebuddy-code-2.173.0.tgz`。
- 归档大小 62,337,681 字节，3372 个条目。SHA-1 `132d7766636d1a4fec410dd5ac48df67f56df941`，SHA-512 与 registry 的 `dist.integrity` 完全匹配。未安装或启动官方 CLI。
- 主分析文件 `dist/codebuddy-headless.js` 的 SHA-256：`7b52a139585e4141292026702ebf1cd098a4620a823bc65e715ea56f18dfcc9e`。
- 通过 TypeScript AST 提取原始 Webpack 模块方法，保留 UTF-16 起止偏移和片段摘要；外加 `({ ... });` 语法包装，仅用于静态解析。格式化副本只用于阅读，不作为原始字节证据。
- REA 对整个约 25 MB 的 bundle 分析超时，改为分析相关模块。8 个认证、能力和域名模块均解析成功；聊天模块 `29526` 解析成功，访问 182662 个 AST 节点。静态关系覆盖为 partial，未知关系保留触及容量限制，不能据此证明完整调用链或真实网络行为。
- REA 认证切片父证据：`ev_ad95b1bd4815f0e88a6d4fdc3d9694ef24bd474374a001f2f005ae59f7cc82b6`；聊天切片父证据：`ev_ec7e98ca05a52d69e96377a97bac9b8a46dc8cf158ad0ebc949a1d05d8be5e37`。关键分支另经源码片段人工复核。

本次临时证据目录为 `/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/axiom-codebuddy-cli-adpoyp_w`，包含 registry 元数据、校验结果、原包、`module-ranges.json`、切片及 `rea-*.json`。未将官方大体积发布包加入项目。

## 认证协议与修复

路径先由 `product.internal.json` 的 `endpoint=https://copilot.tencent.com` 和 `product.json` 的 `platform=CLI`、`prefixPath=/plugin`、`cli-external-link` 绑定。模块 `94055` 的 CLI 认证类继承模块 `47262` 的 `ExternalLinkAuthenticationProvider`。没有把 AccountScoped、微信、国际版或 MCP OAuth 路径混入结论。

| 项目 | 官方产物证据 | Axiom 处理 |
|---|---|---|
| 获取授权状态 | `47262.fetchAuthState`：POST `/v2/plugin/auth/state?platform=CLI`，体 `{}` | 保持端点与方法，补齐四个 `X-No-*` 匿名头 |
| 等待授权 | `47262.loopGetToken`：GET `/v2/plugin/auth/token?state=…`；11217 为 pending，包括 HTTP 异常信封 | 保留编码 state；只在轮询中允许 HTTP 错误响应携带 11217 时继续，其余失败仍终止 |
| 时间参数 | 1 秒轮询、300 秒总期限 | 默认调整为 1 秒／5 分钟，保留取消和可注入测试时限 |
| 刷新 | `47262.refreshSession`：POST token/refresh、体 `{}`、两个 refresh 头；`23502` 全局认证拦截器注入当前 Bearer | 补充当前 access token 的 Authorization；静态证据证明官方发送，尚不能证明服务端必需 |
| 到期时间 | `47262.calculateExpiresAt`：优先已有毫秒级 expiresAt，缺失/空值时从秒级 expiresIn 推导 | 修复以前忽略 expiresAt 的行为；无效时间拒绝，空绝对值可退回有效相对值 |
| 无期限信息 | 官方此函数没有一天默认 TTL | Axiom 使用一小时本地刷新计划并明确标注；这不代表令牌保证有效一小时 |
| 客户端标识 | 官方包版本 2.173.0；UA 由平台、产品、版本等动态拼接 | 统一本地认证/chat 的版本至 2.173.0，补充 X-IDE-Version；不宣称复制了所有运行场景的最终 UA |

官方 token 到手后还会查询登录账号与账号列表。本实现仍只消费 token，不收集账号详情；这些查询是否是服务端激活会话的必要步骤尚无证据。当前 OAuth 登录要求 refresh token；官方部分 token-only 会话可以没有它，用户也可用 Axiom 的 API key 方式配置访问令牌。

提前失效方面，官方有 HTTP/业务码 401 触发刷新逻辑，但此拦截器本身不自动重放原请求。Axiom 仍依据到期时间刷新，401/403 提示重新登录，未新增自动重放。

## 聊天请求

官方 `29526.resolveModelBaseURL` 绑定产品 endpoint 加 `/v2`，SDK 调用 `/chat/completions`，支持 Bearer、system messages、tools、tool results、`max_tokens`、流式 `stream_options.include_usage`。这些与 Axiom 的 pi 适配基本一致。Axiom 保留自身完整系统提示和工具约束。

官方 `injectReasoningSummaryIfNeeded` 会在启用思考或存在字符串 effort 时补 `reasoning_summary: auto`。但显式 `none/off` 的最终 CN 出站行为未闭环：`configureThinkingSettings` 会改写入口参数，产品网关又跳过通用兼容转换。不能从标题生成传入 `none` 或第三方模型转换器推断 CN 要求。本轮保持原有省略 none/off 的行为，关闭选项不保证上游默认关闭思考。

官方还发送请求/会话标识、客户端遥测及有条件的用户、企业和部门信息；未证实这些均是个人 CN 请求的必需字段，本次未捏造这些数据。官方源码中的域名故障切换常量包含 workbuddy.cn、copilot.tencent.com 和备站，但国内产品默认 endpoint 仍是 copilot.tencent.com，本次不切换域名，不宣称 WorkBuddy 账号互通。

## 模型目录差异

官方随包配置与原 9Router 快照存在差异，并且官方运行时会读取产品配置。随包值不等同账号实时能力。

本次采用匹配 ID 的保守默认值：

- GLM-5.2、GLM-5.3、Kimi-K2.8-Preview 的输出上限改为 64000；DeepSeek-V4-Pro 和 V4.1-Flash 改为 128000，避免默认请求携带明显高于随包配置的输出值。
- GLM-5.2、GLM-5.1 不再声明图像输入能力。
- Kimi-K2.8-Preview 按明确的 `supportedEfforts` 改为 low/high/max；上下文仍保持原保守的 300000，不据此自动扩容。
- 保留其余 9Router ID 和未获新证据的能力。随包配置未找到 `minimax-m3`、`kimi-k3-1`，不据此判定线上下架，也不把相似 ID 自动替换成付费变体。

## 验证边界

单元测试验证具体请求头、pending HTTP 响应、绝对/相对期限及无期限策略、模型输出参数、流解析与工具调用。登录集成测试在真实 model-network worker 中预载模拟 fetch，并阻止真实 socket 连接；网络配置重装 fetch 也不能绕过该模拟。

在隔离修复前，旧测试因工作区登录流程改为 worker 而失去进程内替身，曾意外请求官方授权 state 接口；未打开授权页、未完成登录、未请求模型。这不作为真实账号验证证据。

最终验证：三个 CodeBuddy 测试文件共 15 项全部通过；全量 `tsc --noEmit` 与服务端 `tsc -p tsconfig.server.json --noEmit` 均退出 0。核验期间工作区模型模板合并出现只读数组／可选 methods 的类型错误，已保持其现有行为做类型修正，随后重跑 runtime 集成测试通过。没有使用真实账号调用模型。

真实授权、账号权限、最终服务端提示处理、计费、动态模型目录以及未来接口兼容仍需实际联调。此次核验能消除已知差异，不能提供永久有效保证。
