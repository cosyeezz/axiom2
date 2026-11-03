# 多账号页可查询信息：sub2api 对照

研究基准：Wei-Shaw/sub2api commit **d851a38477597157e78450d30af2d8504764d085**（提交日期 2026-10-30）。研究阶段只读分析截图、Axiom 当时的工作区源码和上游源码，未使用用户凭据请求账号接口，也未验证线上账号权限或修改业务代码。

> **修复进展说明**：下文 Axiom 缺字段、direct 本地禁查和卡片估算限制描述的是研究时基线。用户后续要求已实施为实际只读状态检查、检查通过才查询额度及订阅，并保留明确标注的供应商合计参考估算。当前实现及边界见[账号卡片只读查询说明](account-card-readonly-query.md)；不代表 direct 线上权限已获验证。

## 结论（研究时基线）

可参考 sub2api 补充账号身份、套餐、订阅到期、额度窗口、点数与重置券；但必须区分 **Codex OAuth、ChatGPT direct OAuth、API Key**。截图的 direct 授权不能仅因同属 OpenAI 就套用 Codex backend-api 查询。

Axiom 并非完全没有实现：当前源码已经支持 wham 额度、点数、重置券和额外窗口，截图的 direct 提示来自本地授权类型限制，不是已经向上游查询失败。源码存在不等于运行中的后台已部署此版本。

## OpenAI 字段与来源

| 信息 | sub2api 实际来源 | 适用边界与 Axiom 对照 |
| --- | --- | --- |
| 邮箱 | OAuth 返回的 ID token 顶层 `email`、导入元数据，以及额度响应 `email` | 不是所有 access token 都带邮箱；Axiom 已尽力读取保存值、ID token、access token 顶层字段及额度响应。 |
| 账号、用户、组织 ID | token 的 `https://api.openai.com/auth`、额度响应的 `account_id/user_id` | 用于区分个人账号与工作区；显示元数据不等于验签或授权判断。Axiom 已有 accountId。 |
| 套餐 | ID token 的 `chatgpt_plan_type`；`accounts/check` 补全；`wham/usage.plan_type` | JWT 可能过时；个人套餐不能被不相关工作区的内部计费套餐覆盖。Axiom 已解析 token/wham 套餐，未接 accounts/check。 |
| 订阅有效至 | `accounts/check` 的 `entitlement.expires_at`；缺失时 GET `/backend-api/subscriptions?account_id=...` 的 `active_until` | **不是 OAuth 令牌有效期**。个人套餐与到期时间必须来自同一账号；Axiom 当前账号结构没有该字段。 |
| 主、次额度窗口 | GET `/backend-api/wham/usage` → `rate_limit.primary_window/secondary_window` | `used_percent`、`limit_window_seconds`、`reset_after_seconds/reset_at`。界面按真实时长显示，不把主/次硬编码为五小时/周。Axiom 已实现。 |
| 是否达到限额、当前是否可用 | `rate_limit.allowed/limit_reached` | 查询时的上游状态，不是未来调用必成功保证。Axiom 已实现。 |
| 独立功能额度 | `additional_rate_limits[]` | 若上游返回，可显示 Spark 等独立窗口；不能覆盖账号主额度，也不证明对应模型目前可调用。Axiom 已实现通用额外窗口解析。 |
| 剩余点数 | `credits.has_credits/unlimited/balance` | balance 是上游原值，不是美元；`null` 是未知而非零。Axiom 已实现。 |
| 重置券 | 额度响应的 `rate_limit_reset_credits.available_count` 及 GET `/backend-api/wham/rate-limit-reset-credits` | 数量、可用状态、到期明细；与可消费点数不同。Axiom 已实现只读查询。 |
| 最近额度快照 | 正常模型响应头 `x-codex-primary/secondary-used-percent`、窗口长度、重置秒数 | 被动采样，只是最近观测值，必须标记时间与过期状态；额外功能与账号全局额度不能混用。 |
| 自动续费标志 | `/backend-api/subscriptions` 响应模型还声明 `will_renew` | 当前 sub2api 只将到期时间作为函数返回值，不能称已完整提供续费状态展示；可另行研究适配。 |
| PAT 身份信息 | `at-` PAT 专用 GET `https://auth.openai.com/api/accounts/v1/user-auth-credential/whoami` | 返回邮箱、账号/用户 ID、套餐及 FedRAMP 标志；不是任意 OAuth token 通用的 userinfo，更不能套用于 direct。 |

**实际赋值审查**：sub2api 的 `ChatGPTAccountInfo.Email` 虽有定义，`accounts/check` 的 fetch/fill 实现没有给它赋值。因此不能按 `enrichTokenInfo` 注释声称该端点在此项目中已经补全邮箱；实际邮箱来源应看 ID token、wham 响应或特定 PAT 的 whoami。没有发现 profile namespace email fallback。

### 关键源码

- [额度端点与响应字段](https://github.com/Wei-Shaw/sub2api/blob/d851a38477597157e78450d30af2d8504764d085/backend/internal/service/openai_quota_service.go#L25-L133)
- [token 元数据字段](https://github.com/Wei-Shaw/sub2api/blob/d851a38477597157e78450d30af2d8504764d085/backend/internal/pkg/openai/oauth.go#L241-L275)
- [账号与订阅只读查询](https://github.com/Wei-Shaw/sub2api/blob/d851a38477597157e78450d30af2d8504764d085/backend/internal/service/openai_privacy_service.go#L98-L288)
- [个人套餐与工作区到期时间一致性](https://github.com/Wei-Shaw/sub2api/blob/d851a38477597157e78450d30af2d8504764d085/backend/internal/service/openai_oauth_service.go#L257-L335)
- [被动额度响应头](https://github.com/Wei-Shaw/sub2api/blob/d851a38477597157e78450d30af2d8504764d085/backend/internal/service/openai_gateway_usage.go#L989-L1055)
- [PAT 专用身份接口](https://github.com/Wei-Shaw/sub2api/blob/d851a38477597157e78450d30af2d8504764d085/backend/internal/service/openai_codex_pat_service.go#L15-L97)
- 完整静态证据：[OpenAI 取证记录](evidence/sub2api-account-query/openai-evidence.md)。
- Axiom：[额度适配器](../app/src/server/providers/openai-usage.ts)、[账号展示元数据](../app/src/server/providers/openai-account-info.ts)、[账号结构](../app/src/shared/model-accounts.ts)。

## 截图为何没有这些信息

1. **direct 的额度查询被本地明确禁用。** `openAIUsageRestriction()` 只在存储 scopes 显式含 `chatgpt.tokens.use.direct` 时，返回不可刷新状态和官方用量页，不发 wham 请求。sub2api 此版本未找到这类 direct scope 的独立查询实现，不能拿其 Codex 查询成功推导 direct 也可用。
2. **登录拿到的信息不等于已经保存的信息。** 当前 Axiom 依赖 Pi 1.4.0，Codex 流程只保留 access/refresh/expires/accountId，direct 流程只保留 access/refresh/expires/clientId/scopes；两者均未保留 ID token。direct 源码还明确说明不使用 ID token 识别用户或读取 profile。因此本地缺邮箱/套餐存在保存链路原因，不能仅靠 UI 重新排版解决；但未检查用户凭据，不能断言该具体账号从未收到这些字段。
3. **现有费用账本没有账号维度。** [CostRow](../app/src/shared/costs.ts) 有 provider/model/session 等归属，没有 accountId；[ModelAccountUsage](../app/src/client/models/ModelAccountUsage.tsx) 当前直接展示无法估计账号金额的提示。即使补上账号归属，也只能统计本机记录的用量/参考费用，不能由已消费金额推导套餐剩余美元。

公开核对：[OpenAI direct 模型与推理文档](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)明确写明 `do not point it at ChatGPT’s backend-api endpoints`。[direct 多账号与用量文档](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)的 Tracking usage 指引是链接 ChatGPT Settings → Usage；同邮箱的不同注册也须分别保留 issued client ID/身份/凭据，不能按邮箱合并。本次未找到 direct 可直接套用的只读额度端点契约；保留官方用量页是当前有依据的边界。

## 不能冒充上游账号全量的本地统计

sub2api 通过自身用量日志可按账号/时间段查询请求次数、输入输出 Token、缓存创建/读取 Token、费用和平均耗时；今日/额度窗口统计也会把本地 requests/tokens/cost 附在上游利用率旁边。这些不是 OpenAI 返回的账号全量账单，不涵盖官方客户端或其他应用的逐条调用。

[账号聚合统计实现](https://github.com/Wei-Shaw/sub2api/blob/d851a38477597157e78450d30af2d8504764d085/backend/internal/service/usage_service.go#L229-L248)；[窗口统计与费用口径](https://github.com/Wei-Shaw/sub2api/blob/d851a38477597157e78450d30af2d8504764d085/backend/internal/service/account_usage_service.go#L137-L164)。sub2api 的 cost、standard_cost、user_cost 包含不同倍率/平台记账口径，也不天然等于供应商实际扣费。

同理，并发、RPM、失败记录、冷却与调度状态属于平台自身运行观测或配置；除非有具体上游字段，不能标作账号官方限额、封禁结论或真实余额。API Key 并不天然拥有账号余额或组织账单查询权限。

### sub2api 的美元估值不是查到的余额

它确实有一个 [七天窗口总费用估计](https://github.com/Wei-Shaw/sub2api/blob/d851a38477597157e78450d30af2d8504764d085/frontend/src/components/account/AccountUsageCell.vue#L853-L869)：`估计总费用 = 本地该窗口费用 × 100 ÷ 上游已用百分比`，只在两项均为正且有限时返回。这个值混合了本地记账和上游限流快照，隐含同一窗口内的消耗都经过本系统、费用与限流比例可线性换算等未经保证的假设。其他客户端消耗、不同模型权重、本地价格/倍率及采样时差都可能使其明显失真。

因此可以讨论是否提供明确标为“粗估”的辅助值，但**不能将它称为查到的官方美元余额或可靠剩余金额**。当前 Axiom 还缺账号归属，连这一启发式估算的本地分子也不具备。

## 页面建议

- **卡片优先**：邮箱/账号 ID、授权通道、套餐、订阅有效至；额度窗口剩余百分比与重置倒计时；剩余点数；重置券数量及最近到期；最后成功查询时间和数据来源。
- **详情中展示**：令牌有效期、用户/组织 ID、授权来源、查询失败原因与缓存状态；若以后接入本地账号统计，再加本机今日/本月请求、Token、缓存和参考费用。
- **不展示伪余额**：不把百分比、剩余点数或本机历史费用直接换成“官方剩余美元”。订阅卡可以移除无依据的预计可用金额，或单独明确标为不可估；本地费用应另列。
- **保持只读**：不要让刷新额度自动消费重置券。sub2api 的 `enrichTokenInfo()` 除查询外还调用关闭训练共享的 PATCH 设置函数，不能整体复制。其 [GET quota handler](https://github.com/Wei-Shaw/sub2api/blob/d851a38477597157e78450d30af2d8504764d085/backend/internal/handler/admin/openai_oauth_handler.go#L477-L528) 也会通知自动重置服务，启用并满足条件时后台可能消费重置券；普通 OpenAI 用量页的 [主动采样](https://github.com/Wei-Shaw/sub2api/blob/d851a38477597157e78450d30af2d8504764d085/backend/internal/service/account_usage_service.go#L832-L921) 更是 POST 模型推理请求，可能耗额度，不是无成本 GET。应只参考所需的上游 GET 与字段解析，隔离这些副作用。查询失败不代表账号无效，缺字段显示未知而不是零。

## 其他平台

| 平台/授权 | 此版本可参考的能力 | 必须保留的边界 |
| --- | --- | --- |
| Claude OAuth | GET `https://api.anthropic.com/api/oauth/usage`，含五小时、七天、Sonnet 七天等窗口的利用率与重置时间；部分专属窗口可由响应头快照补全。具备 `user:profile` 的 OAuth 还可只读查重置券。 | 缺字段不能当零；Setup Token 不能主动调用这条 usage API，主要依赖响应头快照，缺快照时甚至会按状态粗估 80%/100%，须单独标注。窗口内的请求、Token、费用是本地日志，不是 Anthropic 全账号账单。 |
| Antigravity | `v1internal:fetchAvailableModels` 返回每模型 `quotaInfo.remainingFraction/resetTime`，以及模型显示名、图片/思考能力、Token 上限等可选目录字段；`LoadCodeAssist` 补订阅等级和 AI Credits。 | 配额查询使用 POST，但不是模型推理；剩余额度是模型/配额池维度，credits 不是美元钱包。界面合并模型组时，最高使用率与最早重置可能不来自同一模型。 |
| Gemini | 可按套餐/账号类型展示 Pro、Flash 或共享池的每日/每分钟请求、Token 与费用进度。 | 此路径的消耗来自本地日志，额度上限来自内置/可覆盖策略表；**不是向 Google 实时查询到的官方全账号剩余额度**，分钟窗口也是固定窗口近似。第三方 Key、Vertex 不套用这套模拟规则。 |
| API Key | 可记录本机使用统计及管理员配置的费用限额；具体供应商若另有额度/账单端点，可单独适配。 | 普通推理 Key 不天然具有组织用量/账单/余额权限。兼容中转的 `/v1/sub2api/billing` 探针读的是计费倍率和峰时信息，不是 balance；不能宣称有一套通用查余额接口。 |
| Kiro | 此版本没有专用 usage/quota/billing 适配可借鉴。 | 虽保留 `PlatformKiro` 常量，但注释明确用于不支持平台测试与历史账号行，正式平台注册表也没有 Kiro。 |

源码：[Claude 查询](https://github.com/Wei-Shaw/sub2api/blob/d851a38477597157e78450d30af2d8504764d085/backend/internal/repository/claude_usage_service.go#L16-L61)、[Claude 窗口字段](https://github.com/Wei-Shaw/sub2api/blob/d851a38477597157e78450d30af2d8504764d085/backend/internal/service/account_usage_service.go#L249-L273)、[Antigravity 模型与配额字段](https://github.com/Wei-Shaw/sub2api/blob/d851a38477597157e78450d30af2d8504764d085/backend/internal/pkg/antigravity/client.go#L649-L729)、[Gemini 本地用量](https://github.com/Wei-Shaw/sub2api/blob/d851a38477597157e78450d30af2d8504764d085/backend/internal/service/account_usage_service.go#L971-L1026)、[Gemini 策略表](https://github.com/Wei-Shaw/sub2api/blob/d851a38477597157e78450d30af2d8504764d085/backend/internal/service/gemini_quota.go#L96-L215)。

补充证据：[Claude Setup Token 状态估算](https://github.com/Wei-Shaw/sub2api/blob/d851a38477597157e78450d30af2d8504764d085/backend/internal/service/account_usage_service.go#L1704-L1764)、[Claude 重置券权限](https://github.com/Wei-Shaw/sub2api/blob/d851a38477597157e78450d30af2d8504764d085/backend/internal/service/claude_reset_credits.go#L100-L116)、[Antigravity 订阅与 credits](https://github.com/Wei-Shaw/sub2api/blob/d851a38477597157e78450d30af2d8504764d085/backend/internal/service/antigravity_quota_fetcher.go#L83-L204)、[Kiro 保留常量说明](https://github.com/Wei-Shaw/sub2api/blob/d851a38477597157e78450d30af2d8504764d085/backend/internal/service/domain_constants.go#L56-L58)、[正式平台注册表](https://github.com/Wei-Shaw/sub2api/blob/d851a38477597157e78450d30af2d8504764d085/backend/internal/domain/platforms.go#L36-L52)、[billing probe 字段白名单](https://github.com/Wei-Shaw/sub2api/blob/d851a38477597157e78450d30af2d8504764d085/backend/internal/service/upstream_billing_probe.go#L805-L885)。完整多平台取证记录见 [证据文档](evidence/sub2api-account-query/multi-platform-evidence.md)。

不能从 OpenAI 的 wham 接口推导其他供应商也有同等数据。
