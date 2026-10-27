# CodeBuddy 国内版

Axiom 内置 `codebuddy-cn` 供应商，直接调用 `https://copilot.tencent.com/v2/chat/completions`，不需要运行 9Router。

## 使用

1. 更新并重启 Axiom 后，打开模型设置，选择“添加供应商 → OAuth 登录”，再选择 **CodeBuddy 国内版**。
2. 启动登录，在打开的浏览器页面完成腾讯 CodeBuddy 国内版授权。Axiom 每 1 秒查询授权结果，5 分钟后超时；可随时取消。
3. 登录完成后，在会话中选择该供应商的模型。模型设置中的“拉取模型列表”会展示内置目录，可选择导入并修改模型配置。

凭据由现有 pi 认证机制保存到应用模型目录的 `auth.json`。访问令牌接近到期时，pi 在跨进程凭据锁内刷新并保存轮换后的令牌；退出登录沿用现有流程。访问令牌也可通过供应商的 API key 方式配置，或供服务进程使用 `CODEBUDDY_CN_API_KEY`，此方式不具备 OAuth 自动刷新能力。环境变量方式不会自动创建设置页的供应商条目，仍需配置 `codebuddy-cn`。

## 模型与调用

目录保留 9Router 的 11 个模型条目，并以官方 CLI 2.173.0 随包配置校正部分能力与保守输出上限：GLM-5.2、GLM-5.1、MiniMax-M3、Hy3、Hy4-Preview、GLM-5.3、GLM-5.3-Flash、Kimi-K3、Kimi-K2.8-Preview、DeepSeek-V4-Pro、DeepSeek-V4.1-Flash。当前未实现官方动态产品配置的目录读取，不调用猜测的 `/models`，也不保证每个账号都可访问全部条目。Kimi-K2.8 保留保守的 300000 上下文。GLM-5.2/5.1 不声明图像能力；GLM-5.2/5.3、Kimi-K2.8 默认输出上限为 64000，两个 DeepSeek 为 128000。

目录按模型声明可用的思考等级，例如 GLM-5.2 使用 high/xhigh，DeepSeek-V4-Pro 使用 low/high/xhigh，DeepSeek-V4.1-Flash 使用 low/high/max。

调用复用 pi 的 OpenAI Completions 流解析，支持文本、思考内容、工具调用、工具结果和 usage。请求强制流式；开启思考时附加 `reasoning_summary: auto`。可关闭模型的 off 经 pi 映射为显式 `reasoning_effort: "none"` 并省略 summary，不再删除关闭信号；若上游仍返回 thinking，会如实保留而不是隐藏。此修复源于真实 GLM/off 仍出现 thinking 的反例，已验范围与失败记录见[真实长会话验证报告](codebuddy-e2e-validation.md)，不保证所有模型或后续所有请求一致。目录标注不能关闭的模型不提供关闭选项。

Axiom 完整保留系统提示和工具约束。参考实现有替换 agent 系统提示的兼容策略，本实现未采用。若上游拒绝某类提示，会报告错误，不会悄悄删改提示重试。提前撤销的令牌导致 401/403 时会提示重新登录；自动刷新以令牌到期时间为依据。

目录没有已核验的单价，运行时初始价格字段为 0，不能据此理解为免费。可在模型设置中填写自己的单价；额度与收费以 CodeBuddy 账号为准。WorkBuddy 和 CodeBuddy 国内版不是同一个接入入口，本实现未验证 WorkBuddy 账号或额度互通。

## 维护与验证

- `app/src/server/model-runtime.ts` 按配置中的供应商 ID、已保存凭据或明确的添加/登录操作加载供应商实现；未配置且未登录时不会注册 CodeBuddy。添加菜单使用独立静态模板，不为显示选项初始化供应商。注册时抑制 SDK 隐式后台刷新，调用方按原有流程显式刷新。
- 已配置的 CodeBuddy 模型可能依赖内置 URL、API 和模型能力，读取这些配置时仍需恢复本地供应商定义；本地注册不等于认证或请求远端服务。
- `app/src/server/providers/codebuddy-auth.ts` 负责授权状态、token 轮询和刷新协议。
- `app/src/server/providers/codebuddy-cn.ts` 负责请求适配；`codebuddy-response.ts` 在 SDK 解析前归一化 HTTP/SSE 错误，脱敏上游回显、保留上下文溢出机器语义，并区分认证、模型权限和额度错误。正常流仍交给 pi 解析。
- `app/src/server/providers/codebuddy-models.ts` 保存模型快照与能力。
- `app/tests/codebuddy-*.test.ts` 使用模拟网络验证登录、取消、刷新、流式工具调用和持久化集成，不使用真实凭据。

协议与目录参考 [9Router](https://github.com/decolua/9router/tree/87a74e1bda3677193c6f71a7e2100c90311f0689) 的 `registry/codebuddy-cn.js`、`capabilities.js`、`thinkingLevels.js`、OAuth handler 和 token refresh。版权为 Copyright (c) 2024-2026 decolua and contributors；完整 MIT 声明保存在 `codebuddy-cn.ts` 文件头，并随服务端编译结果分发。

凭据的到期时间优先读取上游毫秒级 `expiresAt`，否则由秒级 `expiresIn` 换算；两者都缺失时使用一小时的本地刷新计划，这不是上游有效期承诺。登录与刷新协议已对照官方 CLI 2.173.0 发布产物，证据、修复与未验证项见 [协议核验报告](codebuddy-protocol-audit.md)。

2026-10-26 已使用现有 OAuth，在 AXIOM 同一真实会话中对 GLM-5.3 与 DeepSeek-V4.1-Flash 验收文本、思考、工具副作用、两张独立新图、较长上下文、流式停止及刷新恢复。第 29 轮输出契约失败、第 31 轮 off 返回非空 thinking 均保留；修复后新场景不覆盖旧失败。设置名称可自定义，本次“Workbuddy”的实际 ID 为 `codebuddy-cn`，不代表验证了另一套 WorkBuddy 接口。准确轮次、运行版本证据、22 项专项/构建、完整自动测试的两处 FIFO 失败及未覆盖项，见[真实长会话验证报告](codebuddy-e2e-validation.md)。新登录交互、全部账号权限、计费、极限上下文及真实异常恢复仍不能据此视为已验证。
