# Kiro 思考等级配置

本轮将 Axiom 已有的等级选择、保存及 Agent 传递链真正接入 Kiro 原生请求，不是只把 `reasoning` 改为 `true`。实现仍使用 `kiro-chat`，不运行官方 CLI 或 kiro.rs，不把 OAuth 令牌交给通用接口。

**离线实现及验证不等于服务已遵从预算或 effort。** 没有读取真实凭据、请求受保护接口、部署、重启或提交。下述模型配置是基于固定版本 kiro.rs 的**适配器兼容政策**，不是 Kiro 目录返回的思考能力声明，也不是已恢复的官方当前 caller。验证结果见[本轮证据](evidence/kiro-thinking/README.md)。

## 选择和保存

1. 登录 Kiro，在模型设置中拉取账号目录，添加并保存所需模型。
2. 在会话模型选择器中选择该模型及支持的思考等级，确认后应用。
3. 当前会话保存模型和等级；主会话确认也更新应用默认，新会话继承，旧会话不被改写；子任务选择不覆盖主应用默认。**不是每个模型分别保存一套最近等级。**
4. 模型编辑器中的允许等级仍可收窄，并随配置保存、离线重开恢复。已有用户能力覆盖优先，不会被刷新目录无条件覆盖。

已知兼容 ID 在实时目录和同账号 V1/V2 离线目录恢复时得到新适配器元数据，不需要为修改适配器能力强制联网。旧配置如果显式保存了 `reasoning:false` 或禁用等级的覆盖，仍尊重它；需在模型编辑器中重新确认允许等级。未知 ID 不根据名称包含 `thinking`、`opus` 或 `gpt` 自动启用。可在确认支持后手动启用预算模式；要使用新 ID 的原生 effort，需要扩充明确兼容配置，不能仅靠勾选泛用能力猜字段。

## 两条 Claude 路径与 GPT 路径

| 兼容配置 | 默认可选等级 | 实际发送 |
| --- | --- | --- |
| 预算模式：精确 `claude-sonnet-3.7`、`claude-sonnet-4`、`claude-opus-4`、`claude-opus-4.1`、`claude-sonnet-4.5`、`claude-haiku-4.5`、`claude-opus-4.5`、`claude-sonnet-4.8` | off / minimal / low / medium / high | 首条 wire 用户消息文本增加 enabled 及 token 预算标签；不发原生 effort |
| `claude-sonnet-4.6` | off / low / medium / high | adaptive 标签及 `additionalModelRequestFields.output_config.effort` |
| `claude-opus-4.6` | off / low / medium / high / max | 同上；不把 xhigh 静默降成 high |
| 精确 `claude-opus-4.7`、`claude-opus-4.8`、`claude-sonnet-5`、`claude-sonnet-5.5`、`claude-opus-5`、`claude-opus-5.5`、`claude-fable-5`、`claude-mythos-5` | off / low / medium / high / xhigh / max | 同上 |
| 精确 `gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna` | off / low / medium / high / xhigh / max | `additionalModelRequestFields.reasoning.effort`，不注入 Claude 标签 |
| 未识别 ID | 默认仅 off | 不声称上游不支持；用户明确启用后可走预算标签，不猜原生 effort |

不会重写目录返回的真实 `modelId`、剥掉名称后缀、静默换模型，或用静态条目填充账号目录。Sonnet 4.6 不默认开放 max，是本适配器较保守的配置，不是从参考项目推导的上游禁用结论。

### 预算等级

Axiom 自身的默认预算表为 minimal **1024**、low **4000**、medium **16000**、high **20000**。这不是 kiro.rs 自带七档 UI 表；kiro.rs 的基础预算默认 20000、反序列化上限 24576，Z 的预算推导 effort 阈值是 4000/16000/64000。Axiom 采用可区分且不超其兼容上限的值。

预算请求前缀示例：

```xml
<thinking_mode>enabled</thinking_mode><max_thinking_length>20000</max_thinking_length>
```

SDK 的 `thinkingBudgets` 可覆盖预算模式四档，实际发送精确整数；仅接受 1024–24576，这是本地兼容限制，**不是官方最大思考预算保证**。不把尚未支持的 `maxTokens` 误当作已发送的输出限制，也不编造二者联动。

### 原生 effort

Claude 示例：

```json
{"additionalModelRequestFields":{"output_config":{"effort":"high"}}}
```

同时前置：

```xml
<thinking_mode>adaptive</thinking_mode><thinking_effort>high</thinking_effort>
```

GPT 示例：

```json
{"additionalModelRequestFields":{"reasoning":{"effort":"high"}}}
```

外层字段为 camelCase，Claude 内层是 `output_config`，不是顶层 OpenAI `reasoning_effort`。Opus 4.6 使用 adaptive 条件，不只孤立发送 effort。原生 effort 模式拒绝显式 token 预算覆盖，避免把抽象 effort 宣称为精确 token 上限。无效、不支持等级/映射/预算在 fetch 前报错，不当作忽略参数，不静默回退 high。响应的 `providerThinkingLevel` 记录实际发送的 effort 或预算字符串。

### off 的边界

Pi Agent 将 off 传为自有属性 `reasoning:undefined`。Claude off 不新增标签或原生 effort，不从 ID 的 thinking 后缀强制开启，也不删除用户原文中引用的标签；这表示**没有请求额外思考控制**，不保证服务默认永不自行推理。GPT 显式 off 发送原生 `reasoning.effort:"none"`；裸 SDK 请求完全不提供 reasoning 属性时保留服务默认。服务主动发送的原生思考事件仍正常显示。

控制只注入新建 wire payload 的首条 `userInputMessage`：即使系统提示缺失或空也生效。这里指协议结构，不验证消息是否来自真人。保留完整 `<axiom_system>`；按下述思考省略、失败 assistant 跳过及未配对调用清理规则构造 wire 历史，保留其余正文、图片和已配对工具的顺序。不伪造助手确认、不植入第三方身份提示、不修改宿主 transcript；下一轮不会累计注入。

## 响应思考处理

- 继续支持原生 `reasoningContentEvent` 的 text、signature、redactedContent。
- 本次主动请求思考时，兼容 `assistantResponseEvent.content` 回复起始的 `<thinking>…</thinking>` 控制块。标签、换行和 Unicode 可任意跨帧；解析器暂存尾部高代理项，确实不完整的代理项在边界明确失败，不发损坏的标签解析 delta；尾部缓冲有界，不整段等待思考结束。
- 仅解释起始控制块（可有最多 1024 个前导空白 UTF-16 单元）；正文内标签、引号、代码示例不按思考误切。这个保守策略不同于 H 扫描正文的宽松方式，不声称兼容所有任意位置标签。
- 常规闭标签要求双 LF 或双 CRLF，避免把内文结束标记当控制；被紧邻引号/反引号引用的闭标签不生效。工具/流尾允许闭标签后仅为空白；待确认尾白最多 1024 单元，超过本地上限明确报错而非无界缓存或偷偷输出半个标签。
- 未闭合块在工具或正常流尾保留为 thinking 并记诊断，不捏造正文空格、签名或 `max_tokens` 原因。只有思考而无有效正文/完整工具的回复仍按原空回复保护失败。
- 工具仍只来自正式工具事件；XML 文本不能创建或执行工具。CRC、schema、工具结束/ID、完整流校验、固定端点、一次性票据、10 MiB 完整请求预算及取消不变。

**完整签名思考历史续接尚未实现。** 真实多轮测试发现，把历史思考包装成普通 assistant 正文会诱发后续模型将其当作答案模板，导致思考泄漏到正文。现已停止这种降级：本地 transcript 继续保留思考文本及签名，远端历史仅发送正常答案、工具调用和结果，省略所有 thinking 块及其 opaque/signature，并以 `kiro-reasoning-history-omitted` 记录数量。用户或正常答案中引用的同名标签属于普通文字，不被正则清洗。该保守隔离不等于官方 CLI 原生签名回放契约已恢复，也不表示已完全对齐其重试、缓存或计费行为。

## 取消工具后的历史恢复

工具执行阶段发生中断后，本地原生历史可能保留 assistant 工具调用，却没有对应结果。适配器在遇到下一条归一化后的 `role:"user"` 消息时，仅从远端 wire 历史省略仍未配对的调用，并记录 `kiro-interrupted-tools-omitted` 及 `omittedToolCalls`。这个边界可能来自真人、合成输入或上游转换的 custom/摘要消息；适配器不验证来源，也不证明发生了取消。诊断数量仅表示被省略的调用数。

该兼容策略不伪造工具成功或失败结果，不改写本地 transcript。已经配对的调用和实际结果、其余普通正文、用户图片和工具图片仍然保留；已省略调用的 ID 继续受历史去重保护。`stopReason` 为 `error` 或 `aborted` 的 assistant 消息在 pending 检查前整体跳过，不登记其中的调用，也不关闭先前 pending；其他 assistant 跨越未配对调用仍报错。system 消息不构成恢复边界。

没有后续归一化 user 边界的未完成调用、被省略调用的迟到结果、孤立结果及重复调用 ID 仍会明确失败。省略调用不证明工具未执行或没有副作用，不能据此推断可以安全重试。端到端取消、恢复及资源重载的实际验证见[长会话验收](evidence/kiro-long-session/README.md)。

## 可复核来源

- H 固定 [converter.rs](https://github.com/hank9999/kiro.rs/blob/22f36e692ad387c46581a84daf0d563347e330a3/src/anthropic/converter.rs#L672)、[types.rs](https://github.com/hank9999/kiro.rs/blob/22f36e692ad387c46581a84daf0d563347e330a3/src/anthropic/types.rs#L64)、[stream.rs](https://github.com/hank9999/kiro.rs/blob/22f36e692ad387c46581a84daf0d563347e330a3/src/anthropic/stream.rs#L699)：标签、预算和流式提取。
- Z 固定 [converter.rs](https://github.com/ZyphrZero/kiro.rs/blob/4cac2a8b887eacf4c8119558d3c1906e43f8cbd4/src/anthropic/converter.rs#L350)、[wire types](https://github.com/ZyphrZero/kiro.rs/blob/4cac2a8b887eacf4c8119558d3c1906e43f8cbd4/src/kiro/model/requests/kiro.rs#L30)：原生字段、模型兼容、预算推导与 adaptive 条件。其源注释的“已确认”不构成本轮服务实测。
- [Axiom 控制与能力实现](../app/src/server/providers/kiro-thinking.ts)、[有界标签解析](../app/src/server/providers/kiro-thinking-stream.ts)、[原生适配器](../app/src/server/providers/kiro-chat.ts)、[新增测试](../app/tests/kiro-thinking.test.ts)。实现独立编写，未复制或执行第三方代码。
- [请求等效审计](kiro-cli-parity-audit.md)、[原生图片实现](kiro-images.md)记录其余未对齐项与历史基线；79 个官方静态证据文件保持冻结，不能用第三方策略替代官方 caller 或线上证明。
