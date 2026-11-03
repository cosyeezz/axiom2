# sub2api OpenAI / Codex 账号元信息与上游额度：只读源码证据

## 版本与边界
- 仓库 `/tmp/axiom-sub2api-research-7365d9a9/sub2api`，commit **d851a38477597157e78450d30af2d8504764d085**；初始 `git status --short` 空。
- 仅静态阅读源码，未访问网络、用户凭据或运行上游请求；未运行测试。下文“支持”表示此版本有实现，**不表示已验证某个真实 token 被上游接受**。
- 本文路径均相对上述仓库根；引用格式 `路径:行号`。

## 1. OAuth 类型：不能从 Codex 推导 direct scope 权限
- `backend/internal/pkg/openai/oauth.go:16-35,185-212`：默认 Codex CLI client_id `app_EMoamEEZ73f0CkXaXp7hrann`，authorize `https://auth.openai.com/oauth/authorize`，token `https://auth.openai.com/oauth/token`，redirect `http://localhost:1455/auth/callback`；PKCE S256；scope **`openid profile email offline_access`**，refresh scope `openid profile email`；`id_token_add_organizations=true`、`codex_cli_simplified_flow=true`。`OAuthClientConfigByPlatform` 不论 platform 均返回这个 client 和 true。
- `backend/internal/service/openai_oauth_service.go:214-253,334-391`：刷新允许显式 client_id（兼容导入的其他 OAuth 客户端），无 refresh_token 但有 access_token 时可只执行 metadata enrich。不能据此保证任意移动端/第三方 client token 可用所有 ChatGPT 接口。
- `backend/internal/service/openai_quota_service.go:444-511`：quota 要求本地 `platform=openai,type=oauth`，解析 shadow 的父凭据；account id 优先 `chatgpt_account_id`，否则 `organization_id`；一般从共享 token provider 获得有效 access_token。**未检查 token 的 scope/client/audience 是否足够**，本地 OAuth 类型校验不等于上游授权成功。
- `backend/internal/service/openai_token_provider.go:134-169`：PAT 不自动 refresh；其他 OAuth 按 expires_at 和 RT 决定刷新，过期且无 RT 可禁用账号。因此查询路径也可能刷新/保存 token、改变本地账号状态，不是无状态纯 GET。
- 全仓搜索 `chatgpt.tokens.use.direct` **无命中**；同样无 `https://api.openai.com/profile` 命中。本版本没有 direct scope 的权限矩阵、兼容声明或实测。**不能把 Codex CLI OAuth、PAT、移动端 RT 的结论套给 chatgpt.tokens.use.direct；其 wham/accounts/check/subscriptions 可用性均未验证。**

## 2. JWT 本地解析：有套餐和身份，无实时额度
- `backend/internal/pkg/openai/oauth.go:246-278`：IDTokenClaims 顶层 `email,sub,iss,aud,exp,iat,email_verified`；namespace `https://api.openai.com/auth` 内 `chatgpt_account_id,chatgpt_user_id,chatgpt_plan_type,user_id,poid,organizations[{id,role,title,is_default}]`。
- 同文件 `317-373`：DecodeIDToken 仅分段+Base64+JSON；ParseIDToken 再检查 exp（120 秒偏差），**不验签、不校验 audience/issuer**，不可作为授权判断。
- 同文件 `376-413`：GetUserInfo 只读顶层 Email 和 auth namespace；OrganizationID 选默认 org，否则首个 org；**没有 profile namespace email fallback**。`profile` OAuth scope 名称不等于代码实现读取 `https://api.openai.com/profile.email`。
- `backend/internal/service/openai_oauth_service.go:173-208,223-250`：交换/刷新 ID token 后提取以上元信息，AccessToken 的 `poid` 仅在 enrich 中作为组织选择 fallback。JWT `chatgpt_plan_type` 是个人套餐快照，不是实时余额，也不包含此实现可读的订阅到期日。
- 因此若 Axiom 也只有顶层 email，不能说 sub2api 已解决 profile namespace 缺口；两者在此均缺实现。实际 token 是否提供该 namespace 不能从本仓库证明。

## 3. accounts/check 与 subscriptions：不仅 wham
### GET https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27
- `backend/internal/service/openai_privacy_service.go:98-151`：Bearer access token，Origin/Referer 为 chatgpt.com，Accept application/json，15s timeout，指纹客户端工厂；失败/Cloudflare 拦截为 best-effort nil。
- `:153-220`：读响应 `accounts` map；优先匹配 orgID map key（enrich 的 orgID 为 ID token OrganizationID，缺失才从 access JWT auth.poid 补，见 oauth_service.go:265-270）。不匹配时按 **is_default > 非 free > 任意**选择，注意并不直接优先匹配个人 chatgpt_account_id。
- `:315-355`：过滤 deactivated/disabled/deleted/inactive/suspended 标记；可解析 entitlement.expires_at 且已到期的 workspace 被剔除；缺日期/无效日期不因此剔除。
- `:281-313,358-368`：返回 `PlanType` 取 `account.plan_type`，否则 `entitlement.subscription_plan`；`SubscriptionExpiresAt` 取 `entitlement.expires_at`；AccountID 取 `account.account_id`，否则 map key。
- **邮箱注释与实现不符**：ChatGPTAccountInfo 虽定义 `Email`（:101），`fillAccountInfo` 仅给 PlanType/SubscriptionExpiresAt/AccountID 赋值（:283-287），全函数没有 Email 赋值。oauth_service.go:296-298 的 `info.Email` fallback 在此实现中不能补出邮箱。不可照抄 :258 注释称 accounts/check 能补 email。

### 个人套餐与工作区到期一致性
- `backend/internal/service/openai_oauth_service.go:273-332`：`shouldApplyChatGPTAccountInfoPlanType` **仅当前套餐为空才采用 accounts/check 套餐**；非空 JWT 个人套餐不可被 workspace 套餐覆盖。
- 到期时间只有“采用了这条 accounts/check 套餐”或“此条 AccountID 与 token.ChatGPTAccountID 相同”时才采用；否则强制查询个人 subscriptions，防止“个人 Pro + workspace expires_at”。
- 限制：任一侧缺 AccountID，`chatGPTAccountInfoBelongsToTokenAccount` 返回 true（:315-322），仍有无法区分的兼容边界；非空套餐（甚至来自之前缓存）均保持不覆写，不是每次实时更新套餐。

### GET https://chatgpt.com/backend-api/subscriptions?account_id=<id>
- `backend/internal/service/openai_privacy_service.go:227-278`：accounts/check 没到期日期或需纠正 workspace 来源时调用；同样 Bearer、Origin/Referer、15s timeout、best-effort。解码 `plan_type,active_until,will_renew,id`，**只返回 RFC3339 合法的 active_until**，未把 will_renew/id 暴露为账号元信息。
- `backend/internal/service/openai_oauth_service.go:300-304,325-332`：account_id 优先 `ChatGPTAccountID > OrganizationID > orgID`。不支持无 ID 查询，失败保留未知，不应把 token.expires_at 当订阅到期。
- 现有静态测试覆盖点（未运行）：`backend/internal/service/openai_subscription_test.go:15,44,86,122,129,142,176,225,265`，包括已过期/禁用 workspace 过滤、JWT 个人计划保留、不同账号到期回退。

### enrich 有写上游副作用，不可整段用于只读页
- `backend/internal/service/openai_oauth_service.go:306-307` 无条件尝试 disableOpenAITraining；`backend/internal/service/openai_privacy_service.go:18,55-64` 向 **PATCH https://chatgpt.com/backend-api/settings/account_user_setting?feature=training_allowed&value=false** 发请求（改变训练共享偏好）。只读账号统计页应拆分单纯读取函数，不能直接复用整个 enrichTokenInfo。

## 4. 主动 JSON 额度查询 / 余额 / 重置卡
### GET https://chatgpt.com/backend-api/wham/usage
- `backend/internal/service/openai_quota_service.go:26-38,42-107` 字段：`user_id,account_id,email,plan_type`；`rate_limit.{allowed,limit_reached,primary_window,secondary_window}`，窗口 `used_percent,limit_window_seconds,reset_after_seconds,reset_at`；`additional_rate_limits[] {limit_name,metered_feature,rate_limit}`；`rate_limit_reset_credits.available_count`；`credits.{has_credits,unlimited,balance}`；本地追加 `fetched_at`。
- `credits.balance` 是 **可空十进制字符串的 Codex credit balance**，不是已证实美元余额；`has_credits/unlimited` 不是 reset credits。无 credits 时应“未知”，不伪造为零（:257-266）。窗口为 null 表示无数据，不可当 0%。
- `:164-233`：20s timeout，先 GET wham/usage，再 best-effort 取重置卡详情。主接口失败返回错误；详情失败不抹掉主查询。
- `:613-635`：Bearer + `chatgpt-account-id`，`openai-beta:codex-1`，`originator:Codex Desktop`，`oai-language:zh-CN`，sec-fetch 头；FedRAMP 可加 `x-openai-fedramp:true`。Agent Identity 是独立 assertion/task 认证分支（:555-594），不是普通 token 授权证据。
- 可由 wham 响应获得 email，不应与 accounts/check 的空 Email 字段混淆。

### GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits
- `backend/internal/service/openai_quota_service.go:302-338`：读取可用重置卡详情；输出 sanitized `available_count,credits[].expires_at`，不暴露上游卡 ID/token 给卡片（:65-77）。与 Codex spendable credits 分离。
- 同文件 `:235-299`：缓存写入 account.extra 的 `codex_reset_credit_snapshot` 和 `codex_credits_snapshot`；缺失有效过期细节时保留旧 reset cache，且主查询可部分成功。

### POST https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume （禁止只读页调用）
- `backend/internal/service/openai_quota_service.go:340-430`：body `redeem_request_id`，targeted reset 还加 `credit_id`；返回 `code,credit.{id,reset_type,status,granted_at,expires_at,redeem_started_at,redeemed_at},windows_reset`。**消费重置卡并更改上游窗口，不是查询重置时间**；shadow 明确拒绝消费，只允许母账号。

### 内部 UI API 与隐含变更
- `backend/internal/server/routes/admin.go:465-467`：GET `/api/v1/admin/openai/accounts/:id/quota`；POST `.../quota/refresh`；POST `.../reset-quota`。
- `backend/internal/handler/admin/openai_oauth_handler.go:477-546`：GET quota 查询，POST refresh 额外持久化余额/卡片快照，分别回报 `cache_persisted,credits_cache_persisted`。
- **GET quota 不可称端到端绝对只读**：handler :495、refresh :527 会 `NotifyOpenAIAutoResetCredit`；`openai_quota_auto_reset.go:835-846` 转发后台通知，`:291,405-422` 在启用 auto-reset 且条件满足时可最终 `ResetCreditTargeted`。不是同步消费，但需隔离通知/自动重置配置；另有 token refresh 与 Agent Identity task 恢复副作用。

## 5. 响应头快照、主动推理探针与本地统计须区分
- `backend/internal/service/openai_gateway_usage.go:989-1053`：解析 `x-codex-{primary,secondary}-{used-percent,reset-after-seconds,window-minutes}` 与 `x-codex-primary-over-secondary-limit-percent`。这些是上游响应头快照，可来自正常代理请求/429；不提供账单余额或完整绝对速率 RPM/TPM。
- `backend/internal/service/openai_gateway_service.go:147-224`：按 window_minutes 大小归一成 5h/7d；只有一个已知窗口按 <=360min 分类；完全缺窗口长度才 fallback primary=7d、secondary=5h。不能把 primary 永久写死为 5h 或 7d。
- `backend/internal/service/openai_gateway_usage.go:1083-1177`：写入 `account.extra.codex_*` 与快照时间，后续 UI 可以读缓存；本地计算 reset_at/剩余秒数应说明来源。
- `backend/internal/service/account_usage_service.go:708-770,832-940`：普通 OpenAI usage 页从 extra 读窗口；刷新可 POST **https://chatgpt.com/backend-api/codex/responses** 推理探针，再提取响应头。model `codex-auto-review`（`backend/internal/pkg/openai/constants.go:58-59`），15s timeout；cache TTL 10min（account_usage_service.go:113,815-826）。这是实际模型请求，不是 GET quota，可能消耗额度，且 probe 直接读现存 AT，不等同共享 TokenProvider 自动刷新保证。
- `account_usage_service.go:790-810`：普通账号快照陈旧判断有 WSv2 门控；force/缺窗口仍可走 probe；不能把所有账号刷新都描述成 wham。`extractOpenAICodexProbeUpdates :931-941` 有头即取快照（甚至错误 HTTP 状态也可有用），无头且失败才报错。
- `account_usage_service.go:720-740` 与 `openai_quota_service.go:637-709`：Spark shadow 例外走 wham JSON 的 `additional_rate_limits[].metered_feature=codex_bengalfox`，用母账号凭据但回写 shadow 自己的 codex_*；不可用全局响应头污染 Spark 独立窗口。
- `account_usage_service.go:751-767,139-156,1468-1480`：窗口 Requests/Tokens/Cost/StandardCost/UserCost 来自 **本地 UsageLogRepository.GetAccountWindowStats**，仅统计经本系统流量；不是 OpenAI 全账号消费、不是上游总额/剩余额度。无上游窗口时可能创建利用率 0 的统计容器，这个 0 不应误读为上游确认空闲。
- `frontend/src/components/account/AccountUsageCell.vue:125-210` 把 `/usage` 窗口、主动采样按钮、OpenAIQuotaResetCell 放在同一行；同屏不等于同源。`OpenAIQuotaResetCell.vue:11-12,221-232` 余额/重置卡另读缓存，未知显示横线。

## 6. PAT 是另一种身份接口，不是 JWT/direct token
- `backend/internal/service/openai_codex_pat_service.go:15-32,35-95`：Codex **at-** PAT 通过 GET **https://auth.openai.com/api/accounts/v1/user-auth-credential/whoami** 校验，Bearer + canonical Codex identity；字段 `email,chatgpt_user_id,chatgpt_account_id,chatgpt_plan_type,chatgpt_account_is_fedramp` 必需。
- `:88-97,116-133`：构造 `AuthMode=PersonalAccessToken` 元信息并剔除 OAuth 专属 RT/ID token/expires/client_id；**不执行 enrichTokenInfo**，此 whoami 不返回订阅到期/余额。quota 路径在本地允许此类 OAuth 记录并可用 PAT，但仍需实际上游接受，未实测。

## 结论与建议
1. 能借鉴的读取信息不止 wham：JWT 身份/个人套餐；accounts/check 多 workspace 套餐/entitlement 到期；subscriptions 个人 active_until；wham 用量窗口、额外维度、Codex credits；reset-credits 卡数量和过期；PAT whoami 身份。
2. 只读页应分别记录 source/fetched_at/account_id/token kind，缺失显示未知；个人套餐与工作区权益不得混合；token expires_at、subscription active_until、quota reset_at 三者分开。
3. 分离 PATCH 隐私、POST consume、自动重置通知、推理 probe 以及本地持久化。直接复用本系统 GET handler 或 enrich 并不保证绝对只读。
4. 未见 OpenAI dollar billing balance/credit_grants、组织账单总额查询实现；不要把 Codex credit balance 标成美元，也不要把本地计费统计标为上游消耗。
5. 本次无凭据/网络实测、无测试执行；profile namespace email 与 chatgpt.tokens.use.direct 的真实字段/授权边界仍需独立的、明确授权的验证，不能借 Codex 成功路径推定。
