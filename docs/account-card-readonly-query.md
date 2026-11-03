# 账号卡片：只读查询与费用估算

本文描述当前工作区实现；[sub2api 调研](sub2api-account-query-research.md)保留的是修复前基线和上游证据，不代表本实现已经获得线上接口权限。所有验证使用临时合成凭据、fixture 或 mock；未读取真实凭据查询上游。

## 卡片边界

- 保留身份、套餐、订阅有效期、额度窗口、点数、重置券和费用估算，不重复展示逐条调用记录。
- 邮箱可来自授权元数据或只读额度响应，来源分别标明；解析 token 中的邮箱不是独立身份验证。
- 订阅到期、OAuth 令牌到期、窗口重置是三种不同时间，不互相替代。
- 当前只为 OpenAI / OpenAI Codex OAuth 实现该查询适配器。API Key、其他平台不假装具备此能力。

## 先检查目标账号，再查询额度

[适配器](../app/src/server/providers/openai-usage.ts)按下列顺序执行，所有上游请求均为 GET、禁止重定向，共用有界取消信号：

1. `/backend-api/accounts/check/v4-2023-04-27`。
2. **仅目标身份可唯一匹配、检查通过**后，请求 `/backend-api/wham/usage`。
3. 额度请求成功且身份一致后，请求 `/backend-api/wham/rate-limit-reset-credits`。
4. 同一账号、同一套餐缺订阅到期信息时，才请求 `/backend-api/subscriptions?account_id=...`。

未知授权通道（包括 direct scope）不再被本地“不可查询”标签拦截，而是实际尝试第一步。没有保存账号 ID 时，首个请求不带可选路由头；只有返回唯一身份后，后续请求才绑定该身份。**实际尝试不等于官方承诺支持 direct，也不保证线上成功。**

检查通过的依据是唯一匹配且结构完整的账号及套餐，或明确的 active/enabled/normal 字段；HTTP 200、空对象和 token 尚未过期本身都不够。停用标志仅取有源码依据的字段和结构化错误码，不使用任意错误消息识别“封号”。状态含义：

| 状态 | 卡片含义与操作 |
| --- | --- |
| `active` | 检查通过，允许继续只读查询；不保证推理一定成功。 |
| `disabled` | 上游明确标记账号或工作区停用/异常，停止后续查询，不宣称一定是违规封号。 |
| `unauthorized` | 本地凭据已过期或上游返回明确失效、撤销码，停止后续查询；不自动刷新 token。 |
| `unknown` | 身份不明确、状态矛盾、响应异常或访问失败，停止后续查询，保留手动重试。 |

普通 HTTP 401/403、429、访问质询、HTML、网络失败不能证明账号被停用。权益到期不等于账号停用。目标账号异常时，不回退到另一个健康工作区；别名资料或状态冲突、明确提供但畸形的账号 ID 不能被静默修复。

成功响应最多读取 1 MB，错误响应最多读取 64 KB。诊断只返回安全分类，不把原始响应、任意 message、token 或重置券 ID 发送到前端。卡片状态非 active 或 RPC 失败时，清除额度及估算，停止自动轮询；仍可手动重试。旧无状态 DTO 不能绕过卡片 gate。

## 缓存不能绕过状态检查

[服务](../app/src/server/provider-usage.ts)和[私有磁盘缓存](../app/src/server/provider-usage-cache.ts)遵循以下规则：

- 缓存身份包含 gate 版本、凭据、供应商配置与代理配置，旧版无 gate 缓存不复用。
- 缓存中保留状态和检查时间，拒绝未来检查时间；非 active 结果不保留额度、旧余额或 stale 标志。
- 新一轮明确 active、仅额度读取失败时，才允许保留**同身份**旧额度，并标记旧数据；无法确认状态时不允许回退。
- 只读快捷入口 `peekCached()` 仅接受 active 且有有效额度记录的缓存，不发请求、不刷新凭据、不写文件。
- 读取缓存时比较同身份内存与磁盘快照，既有实例不能用自己的旧 active 内存遮蔽另一实例的新异常；同时间冲突保守采用非 active。

这仍是带检查时间的快照，不是对上游账号状态的持续实时监控。卡片读取不改变模型执行授权、账号调度或当前任务绑定。

## 费用估算不是官方美元余额

[卡片估算组件](../app/src/client/models/ProviderQuotaEstimate.tsx)通过只读 `usage.ledger` 获取同供应商、同窗口汇总，`pageSize: 1`，不渲染逐条记录。计算由[共享规则](../app/src/shared/quota-estimate.ts)完成：

```text
窗口范围 = [重置时间 − 窗口时长, 本次额度更新时间]
估算总金额 = 样本 knownCost ÷ (上游已用百分比 ÷ 100)
估算剩余金额 = 估算总金额 × (100 − 已用百分比) ÷ 100
```

`estimatedCost` 已包含于 `knownCost`，不重复相加。样本条数是账务条数，不宣称等于 HTTP 请求次数。只有窗口有效、快照新鲜、状态检查通过、使用比例和已计价样本均为正且有限时才计算；未知、零消耗、空样本、未完成或不完整统计不会编造金额。

**当前历史账本没有账号维度，采用同供应商合计参考样本，不按当前启用账号回填历史归属。** 卡片明确提示尚未按账号拆分，多账号混用、其他设备调用、不同模型权重、价格估算和采样时间差均可造成较大误差。点数、重置券和 Spark 窗口不混入主/次窗口金额。估算不是官方余额，也不是精确可消费金额。

## 不引入的副作用

不消费重置券、不发模型推理探针、不 PATCH 隐私设置、不自动刷新凭据、不修改 Pi OAuth 或 `node_modules`，不新增持久请求账本。只借鉴 sub2api 的必要 GET、状态字段及结构化错误判据，不复制可能刷新 token、关闭训练共享或触发自动重置的整条 enrich/quota/probe 链。

## 验证入口

- [状态 gate 回归](../app/tests/openai-account-status.test.ts)：请求先后、停用与未知、结构化错误、身份与别名、各阶段取消、缓存与跨实例保护。
- [账号资料回归](../app/tests/openai-account-query.test.ts)：账号/套餐匹配、订阅日期与只读回退。
- [卡片离线设计检查](../app/tests/model-accounts-design.check.ts)：状态失败或旧 DTO 缺状态时不展示额度、不请求样本/价格、不自动轮询；异常清除旧额度、手动恢复、金额公式与详情来源。已通过 56 组视口/主题/字号组合及 8 组单账号场景，包括 320px、200% 字号的完整信息换行、断线重连与选择确认。
- [真实内部链路 fixture](../app/tests/model-accounts-codex.check.ts)：RPC → cache → worker → adapter，但上游网络和凭据均为合成 fixture，不能证明真实账号权限。
- [完整账号界面检查](../app/tests/model-accounts.check.ts)：认证添加/取消/恢复、首账号实际可用、切换竞态、离屏按需查询与凭据隔离。测试隔离父任务的冻结执行绑定，保留空模型列表和实际 `getAuth()` 断言，不改变业务认证路由。

本次实现的离线验证结果：

| 检查 | 结果 |
| --- | --- |
| gate、缓存、账号资料、会话快捷入口及估算规则 | 8 个测试文件，56/56 通过 |
| 多账号存储、认证与执行绑定 | 11/11 通过 |
| 设计矩阵 | 56 组视口/主题/字号 + 8 组单账号场景通过 |
| 完整账号、Codex 链路、普通额度仪表盘、费用估算界面 | 4 项检查全部通过 |
| `app` 生产构建 | 类型检查、Vite 打包、服务端编译通过 |
| 最后一次纯测试 fixture 修改后的类型检查 | 通过 |

以上结果不替代后台部署后的生效检查，也不证明真实账号具备这些端点的权限。所有上游响应与授权均来自合成 fixture，未以真实凭据发起请求。

## Kiro：套餐与额度

协议依据官方 kiro-cli 2.37.0：AWS JSON 1.0 `POST https://q.{region}.amazonaws.com/`，`x-amz-target: AmazonCodeWhispererService.GetUsageLimits`，请求体 `{origin:"KIRO_CLI", resourceType:"AGENTIC_REQUEST", isEmailRequired:true, profileArn}`。region 取自 profileArn（默认 us-east-1）。Identity Center 账号缺 profileArn 时先调用只读 `ListAvailableProfiles`，恰好一个 profile 才继续，否则报错不猜测。

- 实现：[quota.ts](../app/src/native-providers/kiro/quota.ts)（请求与白名单解析）、[kiro-quota.ts](../app/src/server/providers/kiro-quota.ts)（卡片 DTO 与安全错误文案），在 [provider-usage.ts](../app/src/server/provider-usage.ts) 注册。
- 卡片：表头显示 `subscriptionTitle`（如 "KIRO PRO+"）；额度用新的 `quota` 指标（小数 credits，`used / limit Credits`），分套餐额度、试用额度（ACTIVE）、奖励额度（ACTIVE）、超额用量（仅当已启用超额或有超额用量）。`nextDateReset` 显示为重置时间，试用/奖励到期显示为到期时间。
- 只读：不刷新令牌，不发推理请求，响应上限 256 KiB，禁止重定向。`userId`、`__type`、上游错误原文都不进入 DTO 或日志；401 标记授权失效，其余错误（403/429/5xx/网络）标记状态未确认。

真实查询（经用户同意，一次，Identity Center 账号，KIRO PRO+）：`ListAvailableProfiles` 和 `GetUsageLimits` 都返回 200，上述 origin/resourceType 被接受。时间戳是 epoch 秒（`nextDateReset: 1793491200`，即 2026-11-01 UTC）。返回一个 `resourceType: "CREDIT"` 桶，`currentUsageWithPrecision` 带两位小数，`bonuses`、`limits`、`overageCredits` 为空。另有 `unit: "INVOCATIONS"`、`currency`、`overageCharges`、`subscriptionManagementTarget` 等成员，解析时忽略；单位取 `displayNamePlural`（"Credits"）。脱敏后的响应形态已固化为 [kiro-quota.test.ts](../app/tests/kiro-quota.test.ts) 的回归用例。

验证：`kiro-quota.test.ts` 6/6 通过；`provider-usage`、`kiro-profile`、`kiro-catalog`、`openai-account-*` 测试通过；`npm run build` 通过。`model-accounts.check.ts` 需要先 `npx playwright install`，未运行。仓库中 `session-account-rpc.test.ts`（1 项）和 `model-account-presentation.test.ts`（4 项）的失败在撤下本次改动后依然存在，与本功能无关。
