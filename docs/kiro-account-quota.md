# Kiro 账号卡片：套餐与额度

协议依据官方 kiro-cli 2.37.0。查询用 AWS JSON 1.0：`POST https://q.{region}.amazonaws.com/`，`x-amz-target: AmazonCodeWhispererService.GetUsageLimits`，请求体为 `{origin:"KIRO_CLI", resourceType:"AGENTIC_REQUEST", isEmailRequired:true, profileArn}`。region 取自 profileArn，默认 us-east-1。Identity Center 账号如果没有 profileArn，先调用只读的 `ListAvailableProfiles`，只有恰好一个 profile 时才继续，否则报错，不猜测。

## 实现

- [quota.ts](../app/src/native-providers/kiro/quota.ts)：发请求，按白名单解析响应。
- [kiro-quota.ts](../app/src/server/providers/kiro-quota.ts)：转换为卡片 DTO，生成安全的错误文案。
- [provider-usage.ts](../app/src/server/provider-usage.ts)：注册 `kiro` adapter。

## 卡片显示

- 表头显示 `subscriptionTitle`，例如 "KIRO PRO+"。
- 额度使用新增的 `quota` 指标，credits 保留小数，显示为 `used / limit Credits`。
- 额度分为套餐额度、试用额度（ACTIVE）、奖励额度（ACTIVE），以及超额用量。超额用量只在已启用超额或已产生超额时显示。
- `nextDateReset` 显示为重置时间，试用和奖励的到期时间显示为到期。

## 只读约束

- 不刷新令牌，不发推理请求。响应上限 256 KiB，禁止重定向。
- `userId`、`__type` 和上游错误原文不进入 DTO，也不写入日志。
- 401 标记为授权失效。403、429、5xx 和网络错误标记为状态未确认，卡片隐藏额度。

## 真实查询

经用户同意，用一个 Identity Center 账号（套餐 KIRO PRO+）查询了一次：

- `ListAvailableProfiles` 和 `GetUsageLimits` 都返回 200，说明 origin 和 resourceType 的取值被接受。
- 时间戳是 epoch 秒。`nextDateReset: 1793491200` 对应 2026-11-01 UTC。
- 返回一个 `resourceType: "CREDIT"` 桶，`currentUsageWithPrecision` 带两位小数。`bonuses`、`limits` 和 `overageCredits` 为空。
- 响应还包含 `unit: "INVOCATIONS"`、`currency`、`overageCharges`、`subscriptionManagementTarget` 等成员，解析时忽略。单位取 `displayNamePlural`，即 "Credits"。
- 适配器不需要修改。脱敏后的响应形态已作为回归用例加入 [kiro-quota.test.ts](../app/tests/kiro-quota.test.ts)。

## 验证

- `kiro-quota.test.ts` 6/6 通过。
- `provider-usage`、`kiro-profile`、`kiro-catalog` 和 `openai-account-*` 测试通过。
- 类型检查和 `npm run build` 通过。
- 未运行 `model-accounts.check.ts`，需要先执行 `npx playwright install`。
- 后台未重启，实际卡片显示未验证。
- `session-account-rpc.test.ts` 有 1 项失败，`model-account-presentation.test.ts` 有 4 项失败。撤下本次改动后它们依然失败，与本功能无关。
