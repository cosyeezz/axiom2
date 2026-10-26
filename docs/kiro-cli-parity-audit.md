# Axiom 与 Kiro CLI 的请求等效性审计

## 结论与范围

**当前已补齐原生文本、图片与工具输入链路，但没有达到“从 Axiom 发一次，与官方 CLI 发一次具有相同请求与恢复行为”的完整等效。** 错误分类与 Pi 上层重试之间仍存在接线差异；这不能成为禁用图片等模型能力的替代方案。

本页原审计阶段只写差异和证据，未改业务代码；随后按用户明确要求补齐[原生图片能力](kiro-images.md)：用户图、工具图、历史回传、目录声明和缓存恢复。工具多文本块也已改为分别保留。原先拒图的特征结果另行归档，当前探针重新绑定源码；新业务验证见[图片验收](evidence/kiro-images/README.md)，不挪用原验收数。上述原审计和图片离线验收阶段没有读取真实账号、执行官方 CLI/第三方参考程序、请求受保护服务、部署、重启或提交。后续用户授权的 Axiom Sonnet 4.5 文本 high/off [真实调用](evidence/kiro-live/README.md)已成功，但未做同账号官方 CLI 对照，不能据此声称本页的请求等效缺口已消除。

“等效”应固定：账号及 profile、服务区域、模型、系统提示、历史内容及顺序、工具定义与结果、实际支持的控制选项，然后比较规范化请求、流事件、失败及恢复行为。不同会话 ID、请求 ID、诚实客户端 UA 不要求字节一致；**不保证随机生成结果逐字相同**。只在两个客户端输入相同一句话，而系统提示、工作目录、工具和已加载文件不同，不是相同模型输入。

## 证据分层

- **O：官方历史真实源码**：[aws/amazon-q-developer-cli，commit `15cc8f3cd18c4272925ce1c7053268eedff1ea0a`](https://github.com/aws/amazon-q-developer-cli/tree/15cc8f3cd18c4272925ce1c7053268eedff1ea0a)。本轮本机 `git rev-parse HEAD` 再次核对相同。重点区分真实 caller 与生成的 SDK 可选 schema。
- **B：本机官方 Windows CLI 2.12.0 产物**：528,630,968 字节，SHA-256 `0ff1d24eea11aa2e244524d635e1cfc8f9820522f4c5bc192fb99590d909320a`。不是最新版本完整源码；本轮仅 PE 静态分析及定向 dumpbin，不是新完成的 Ghidra 反编译。沿用的操作/端点链见[原协议审计](kiro-inference-audit.md)，补充原始指令见[本轮证据](evidence/kiro-cli-parity/README.md)。
- **D：当前公开设置文档基线**：[官方设置](https://kiro.dev/docs/reference/settings/)。本轮沿用前一步保存并核读的页面，不声称重新在线验证；总响应默认 3600 秒、流静默 soft 60 秒/hard 300 秒，不是 TCP/HTTP 池保活。
- **A：当前 Axiom + 本机 Pi 1.1.0**：[请求转换](../app/src/server/providers/kiro-chat-protocol.ts)、[流适配器](../app/src/server/providers/kiro-chat.ts)、[worker](../app/src/server/agent-worker.ts)。本轮离线特征探针固定了相关源文件哈希。

O 不是 B 的完整对应源码，D 也不能自动归属于 B 的实现常量。本页审计未验证真实服务接受性；后续实调仅补充指定账号/模型的 high/off 文本成功记录，企业权限、费用、完整端到端报文及同条件官方 CLI 等效仍未验证。

## 已有的对齐基础

| 项目 | 已实现及证据边界 |
| --- | --- |
| 原生操作骨架 | `GenerateAssistantResponse`、`conversationState.currentMessage/history/conversationId/chatTriggerType=MANUAL`，当前用户附所选模型与工具，顶层可选真实 `profileArn`。O [实际 caller:399–420][o-api] 与 A [请求组装](../app/src/server/providers/kiro-chat-protocol.ts#L125) 基本相同；不等于所有默认值相同。 |
| 文本及工具往返 | 正式 `toolSpecification/toolUses/toolResults`，保留调用 ID 和成功/错误状态，工具名安全映射，AWS event-stream 双 CRC、本地 schema 校验、取消。仍有下面列出的内容保真和恢复差异。 |
| 会话关联 | A [会话关联](../app/src/server/providers/kiro-chat-protocol.ts#L133) 从 `options.sessionId` 生成稳定 ID；Pi [sdk:277](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.js#L277) 注入 SessionManager ID，worker 的 [观测包装:864–871](../app/src/server/agent-worker.ts#L864) 和 [model-latency:40–94](../app/src/server/model-latency.ts#L40) 保留 options。不能把 adapter 在缺省 ID 时随机，误报为普通 Axiom 续聊每次换会话。 |
| 工作目录与压缩 | 默认 Pi [system-prompt:109](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js#L109) 已把 cwd 写入系统提示，A 会发送完整提示。Axiom 自身也有[宿主自动压缩](../app/src/server/compressions.ts#L224)，不是全局没有压缩。 |
| 当前工具集变更 | Pi [agent-loop:210–244](../app/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js#L210) 生成 toolsAdded/toolsRemoved；A 转换时取得当前工具表。不是完全没有工具变更管理。 |
| 区域路由基础 | A 使用固定美/欧 runtime 聊天端点，目录独立 q 域；本机 B 的 streaming client 构造链已关联 runtime 映射。不能为了模仿 O 的旧 q 端点而倒退路由，也未证明任意端点可互换。 |

## 确认差异及影响

P0 表示先修正确性/恢复边界；P1 表示影响目标场景的主要语义或功能；P2 表示完善展示、计量和兼容。优先级是建议，不表示本轮已经实施。

| 优先级 / 事项 | A 当前行为 | 官方证据与实际影响 |
| --- | --- | --- |
| **P0 错误分类与重试接线** | [chat:95](../app/src/server/providers/kiro-chat.ts#L95) 不解析 HTTP 错误体；[错误映射](../app/src/server/providers/kiro-chat-protocol.ts#L139) 把限流/额度大体合并，丢失超限、月额度、模型容量等分类。**adapter 自身一次 fetch，但 Pi 上层仍可能重试。** | O [mod:533–559][o-api] 区分 `Input is too long.`、`MONTHLY_REQUEST_COUNT`、`INSUFFICIENT_MODEL_CAPACITY`；[retry_classifier:64][o-retry] 阻止月额度重试。A 的 HTTP429 / ServiceQuotaExceeded 文案带 429，Pi 规则判为可重试。月额度若走该分支，可能被当瞬时限流；不能说所有月额度都会重试。需脱敏解析允许的错误码并接入恢复分类，而非回显服务正文。 |
| **P0 已输出后的重试边界** | Pi [agent-session:2978、3028](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js#L2978) 按错误分类及预算重启；该判断没有“已经输出文本/生成工具则禁止”的检查。默认最多额外 3 次，2/4/8 秒退避；可被实际设置覆盖。流中 `InternalServerException` 映为 HTTP500 后也可能命中。[models:454–459](../app/node_modules/@earendil-works/pi-ai/dist/models.js#L454) 每次重新获取认证并派生新票据，单用票据不会阻断上层重试。 | O 的 SDK 重试配置不能证明它会重放已经消费的流；不能照搬“3 次”这个数字。应先统一 provider 与 agent 预算，规定输出后停止透明重放，审计每次调用、计费及工具副作用边界。这是静态可达风险，不是本轮真实发生过重复执行/扣费。 |
| **P1 图片与多模态结果（已补实现）** | 审计基线拒图；现[请求转换](../app/src/server/providers/kiro-chat-protocol.ts#L28) 已把用户/工具图片映射到原生 images/source.bytes，保留历史及合并顺序，校验四格式与 base64。目录 IMAGE 声明和 V2 缓存也已接通；未知声明展示待确认。 | O [message:158–215][o-message] 实际保存/回放图片，[chat:2778][o-chat] 由工具结果图片路径调用；[model:900–906][o-model] 真正 `.set_images(...)`。这是 caller 级能力，不只是 schema 存在。上述缺口已按该结构补齐，详见[实现与边界](kiro-images.md)。旧 UI 直接用户附件入口未证实，当前 2.12.0 填值 caller 和真实接受性仍未知；不能把离线实现称线上全等效。 |
| **P1 思考历史不原生往返** | [原生响应分支](../app/src/server/providers/kiro-chat.ts) 能接收 text/signature/redactedContent，但 [历史思考转换](../app/src/server/providers/kiro-chat-protocol.ts#L75) 将可见思考包装成普通 assistant 文本，丢签名及 opaque。 | O SDK 的 assistant 请求 schema 已有 `reasoningContent`；B 本轮还确认请求 assistant serializer → reasoning serializer 的直接调用链。**但 O 的实际 CLI 转换未保存它，B 的填值 caller 尚未知。** 因此是原生回放/保真限制，不是已证明“历史 CLI 曾完整续接而 A 没有”。需核实 B 的启用条件与回传规则，不能把请求字段不存在当原因。 |
| **P1 系统提示及环境布局** | A 把完整系统提示置于首条用户消息 `<axiom_system>`；已有 cwd 文本，**没有结构化 envState**。默认提示未核实含 OS/当前时间。 | O [conversation:577、811、1005][o-conversation] 把 agent prompt、收集上下文、摘要等作为独立 user/assistant 确认对放在历史前；[message:181、209、542–557][o-message] 传 OS/cwd 的 envState，并可加时间/消息分隔。这会改变模型实际输入。环境必须来自真实工具执行宿主；不能拿 provider 服务进程 cwd 冒充工作区。不要复制官方身份或自动执行 hooks 来追求表面一致。 |
| **P1 取消后的历史与结果保真** | A 严格拒绝未配对调用、孤立结果；跳过 error/aborted 助手。工具结果多文本块现已分别保留（审计基线曾合并），真正空结果仍改成 `(empty tool result)`；纯图结果用历史 caller 的占位并另附原图。 | O [conversation:1162–1210][o-conversation] 修复取消/孤立历史，[message:387–416][o-message] 保留 JSON/text 结果形态。A 的 [resume-session:29–51](../app/src/server/resume-session.ts#L29) **已有显式恢复修复**，但 [worker:1060](../app/src/server/agent-worker.ts#L1060) 仅在 input.resume 入口调用，不保证普通新输入/任意损坏历史同样修复。应统一已知取消状态的修复入口、保留错误与未知副作用，不放松 schema/ID 校验、不伪造成功或重执行工具。 |
| **P1 profile 获取/选择覆盖** | [kiro-auth:62](../app/src/server/providers/kiro-auth.ts#L62) 保留令牌响应里的 profileArn；所审链路没有 CLI 式 profile 枚举与选择。 | O [api_client/profile:15][o-profile] 枚举美/欧 profile，[cli/user:372、400][o-user] 保存选择。如果账号需要 profile 而令牌不返回，A 缺少同样发现能力，影响权限和服务区。不是每个个人账号请求的必填项，不能制造 profile 或去掉它重试。 |
| **P1 总期限及流静默策略** | [chat:47](../app/src/server/providers/kiro-chat.ts#L47) 默认 600 秒、上限 3600 秒；无 CLI 语义的可配置 soft/hard stream-idle 预警/取消。Undici 默认 headers/body timeout 300 秒是底层机制，不等于完全没有静默保护。 | D 默认总 3600、soft 60/hard 300。O 历史配置为 300 秒及 stalled-stream grace 300；历史 `api.timeout` 文档/毫秒实现存在单位矛盾，不用于推荐现行设置。应把总 deadline、流静默、HTTP 池 idle 分开实现与验收。 |
| **P2 引用及附加事件** | 正文事件立即入历史；未专门处理 citation/codeReference/followup 等，原始事件 hook 仍可见。 | O [parser:393–408][o-parser] 会丢弃紧邻 CodeReferenceEvent 前的文本片段，A 不同；这影响后续历史。其余许多 SDK 事件 O 同样忽略，不能全部说成 CLI 已有功能。先做可复核事件对照，再确定哪些应改正文、UI 或仅诊断。当前 B 解码链仍未知。 |
| **P2 用量、context 与停止原因** | 完整四分项快照才更新 usage；缺项保留旧值/诊断，credit/百分比不冒充 token 或美元。最终 stop 主要由有无工具推导，除了内容拦截没有完整结束分类。 | 历史 SDK [serde_util:146–158][o-serde] 对部分计数补零，策略不同；真实当前字段覆盖及 stop 契约未知。Axiom [compression:224–240](../app/src/server/compressions.ts#L224) 需要 context 测量，Pi 也有估算回退；不能说 usage 缺失就完全不压缩，但精度会下降。应保留已知分项与可信来源，不能为凑齐数字猜 cache/费用。 |

### 重试与压缩的关键更正

此前[原协议文档](kiro-inference-audit.md)的“不透明重放”描述范围过大：本轮核对的是 **adapter 单次**，不能扩成整条 Axiom/Pi 链均无重试。Pi [settings-manager:672–689](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js#L672) 默认启用 agent 重试，初始调用加最多 3 次重试，与 O SDK “总尝试最多 3 次”也不是同一预算。

Axiom 有宿主自动压缩，默认阈值见[compression:9](../app/src/shared/compression.ts#L9)：`min(100000, ceil(contextWindow × 80%))`，可配置。worker [742–749](../app/src/server/agent-worker.ts#L742) 取消 Pi 原生 threshold 压缩，是为了走宿主提醒/快照流程，不是关闭全部压缩；存在 memoryPath 时还取消其他原生压缩。因此后续修复 overflow 分类也必须接通宿主恢复流程，不能仅改错误文案就期待原生自动压缩生效。泛化后的 HTTP400/ValidationException 目前不能触发 Pi 错误驱动的 overflow 识别。**即使直接保留 O 的 `Input is too long.` 原文，当前 Pi 正则也不识别；需要明确归一化错误类别，而不是只把正文透传。** 本轮探针核实了这一点。

## 已证实字段存在，但还不能猜测其实际使用

本轮 [PE 字段记录](evidence/kiro-cli-parity/serializer-fields.json) 与 [assistant 指令](evidence/kiro-cli-parity/assistant.asm.txt)、[reasoning 指令](evidence/kiro-cli-parity/reasoning.asm.txt) 补充：

| 字段/能力 | 已有事实 | 还缺什么；处理原则 |
| --- | --- | --- |
| `agentMode` / `additionalModelRequestFields` | B 原有操作序列化链包含二者；O 真实 Generate caller 没设置 agentMode。A 后续按 kiro.rs 的明确兼容策略发送思考 `additionalModelRequestFields`，仍不发 agentMode。 | B 的填值 caller、默认值与触发条件仍未知。第三方已有 `output_config.effort` / `reasoning.effort` 的实际序列化来源，详见[思考配置](kiro-thinking.md)；不能据此冒充 B 或线上验证，也不猜 temperature/maxTokens。 |
| 用户 `cachePoint/clientCacheConfig`、助手 `cachePoint` | B 指令确认可选字段序列化；O SDK 也有，但所审真实 CLI 转换未设置。A 不发送。 | 没证明 CLI 默认启用 prompt cache；缓存的作用范围、触发及费用契约未知。不能仅 schema 存在就列为必须默认补发。 |
| `images/documents` | B 用户 serializer 分别在 `0x140b96abb/0x140b96bbf` 进入数组序列化；images 有 O 的真实 caller 佐证。 | documents 的真实 CLI 填值 caller 未恢复；不能把“SDK 支持”写成“CLI 每次都发文档”。 |
| `reasoningContent.reasoningText.{text,signature}` / `redactedContent` | B `ChatMessage` 在 `0x140ba16dc` 调 assistant，后者在 `0x140baeafc` 调 `0x140b80040` reasoning serializer；同一请求历史分支可达。O SDK 明确存在相同结构。 | B 何时保留/回传、跨模型重放约束、真实当前服务接受性未知；字段存在不证明签名每次必填。 |
| 服务能力元数据 | O 模型 schema 有可选 `supportedInputTypes`、`supportsPromptCache`；A [catalog](../app/src/server/providers/kiro-catalog.ts#L49) 现已保留 `supportedInputTypes` 来源，IMAGE 映射到图片能力；缺失或仅未知值在目录展示待确认。仍未接入 supportsPromptCache；可配置思考另按[kiro.rs 兼容策略](kiro-thinking.md)实现，不将其当作目录声明。 | 应区分“上游声明”“本 adapter 已实现”“未知”。缺字段不是 false；工具/reasoning 不能按模型名猜。 |
| 生成 controls | A [chat](../app/src/server/providers/kiro-chat.ts) 现将 reasoning/thinkingBudgets 接入明确兼容请求，并校验支持等级；temperature/maxTokens/samplingParams 仍仅诊断，非 auto toolChoice 明确拒绝。 | 思考控制的字段来源及离线请求已可核验，但真实服务接受和 B caller 未验证。温度/输出长度仍不生效；不是把通用 OpenAI 字段直接塞入 Kiro 就能等效。 |

## 不应为模仿 CLI 而删除的边界

- 保留固定官方端点、凭据单次票据、脱敏错误、禁止凭据重定向；不跟随自定义 Base URL、跨区试探或去 profile 重试。
- 使用诚实 Axiom UA，不伪装官方机号、CLI 版本或遥测身份。A 固定内容 optout=true，与 O 可配置/默认 false 不同；内容 optout 与遥测上报不是一回事，不为一致性降低隐私默认。
- 保留 CRC、完整 stop、JSON 对象、声明白名单和 schema 校验，不模仿官方/第三方的猜工具名、参数强制转换或半截工具宽松完成。
- A 的本地请求/帧/工具大小限额、60/120 秒连接池策略是有意策略差异，不能宣称复制 CLI 的数值。详见[保活说明](kiro-connection-pooling.md)。
- O 还包含 SigV4/QDeveloper 分支、AWS 凭据链；B 另有 API Key/GetProfile 相关证据。当前 A 覆盖的是已接入 OAuth 原生链，不代表全 CLI 登录模式等效。新增其他认证模式不是修好现有 OAuth 请求的前置条件。

## 建议对齐顺序与验收

1. **先修请求恢复契约**：脱敏错误分类、月额度不重试、上下文溢出归一化；统一 agent/provider 重试预算，防止已输出后透明重放；补普通输入和显式 resume 的取消历史对照。不通过错误字符串偶然匹配来维持语义。
2. **补已证实的输入缺口**：图片与工具文本块保真已补实现并独立验收；继续核对宿主结构化 envState、必要的 profile 发现；保留 Axiom 身份/安全策略，明确系统/上下文布局不同会影响模型结果。
3. **恢复当前 CLI 的未知 caller 后再对齐**：reasoning 原生历史、agentMode、官方 additionalModelRequestFields 默认策略、prompt cache、documents。第三方思考控制已独立实现，不等待官方全 caller 恢复，也不将二者混为同一证明。字段级静态证据已经足够说明“支持序列化”，但还不足以决定默认填值。
4. **补运行与响应语义**：总期限/soft-hard idle、引用处理、可见附加事件、可信用量与结束原因。建立规范化请求快照及流事件 fixtures，而不是只测最终一句文本。

最低验收矩阵应覆盖：普通文本/多轮/工具并行及返回、图片及历史图、thinking+signature/opaque、模型/工具集变更、空/多块工具结果、取消后普通新输入和 resume、相同 session ID 重开、上下文超限、月额度/限流/容量不足、流前与流后错误、总时长和流静默、部分 usage/credit、引用事件；确认失败工具绝不执行、不重放副作用。

最后需要经另行授权的真实同账号/模型/profile 对照，核实服务接受性与当前 CLI 条件请求；**本轮静态审计和离线探针不能替代它，也不能据此宣布 100% 等效。**

## 本轮验证结果

- 离线[特征探针](evidence/kiro-cli-parity/adapter-probe.ts) **8/8 通过，进程 exit 0**，结果见[JSON](evidence/kiro-cli-parity/adapter-probe.json)。它证明当前 adapter 的确定行为及 Pi 错误分类，不是官方请求黄金样本。
- 当前 PE 的 SHA-256 再核对一致；新增两段 dumpbin **均 exit 0**，命令和 stderr 见[执行记录](evidence/kiro-cli-parity/dumpbin-run.json)。没有执行目标 exe。
- 原审计阶段未改业务源码，未重跑全量回归/build；随后补图的业务修改、失败修正和新回归/build 单独记录在[图片验收](evidence/kiro-images/README.md)。此前结果仍归属于[原验收](evidence/kiro-inference/validation/README.md)及[保活验收](evidence/kiro-pooling/README.md)。
- 最终文档链接、证据文件哈希及 scoped 空白检查记录在[本轮 README](evidence/kiro-cli-parity/README.md)。

[o-api]: https://github.com/aws/amazon-q-developer-cli/blob/15cc8f3cd18c4272925ce1c7053268eedff1ea0a/crates/chat-cli/src/api_client/mod.rs
[o-model]: https://github.com/aws/amazon-q-developer-cli/blob/15cc8f3cd18c4272925ce1c7053268eedff1ea0a/crates/chat-cli/src/api_client/model.rs
[o-message]: https://github.com/aws/amazon-q-developer-cli/blob/15cc8f3cd18c4272925ce1c7053268eedff1ea0a/crates/chat-cli/src/cli/chat/message.rs
[o-conversation]: https://github.com/aws/amazon-q-developer-cli/blob/15cc8f3cd18c4272925ce1c7053268eedff1ea0a/crates/chat-cli/src/cli/chat/conversation.rs
[o-chat]: https://github.com/aws/amazon-q-developer-cli/blob/15cc8f3cd18c4272925ce1c7053268eedff1ea0a/crates/chat-cli/src/cli/chat/mod.rs
[o-parser]: https://github.com/aws/amazon-q-developer-cli/blob/15cc8f3cd18c4272925ce1c7053268eedff1ea0a/crates/chat-cli/src/cli/chat/parser.rs
[o-retry]: https://github.com/aws/amazon-q-developer-cli/blob/15cc8f3cd18c4272925ce1c7053268eedff1ea0a/crates/chat-cli/src/api_client/retry_classifier.rs
[o-profile]: https://github.com/aws/amazon-q-developer-cli/blob/15cc8f3cd18c4272925ce1c7053268eedff1ea0a/crates/chat-cli/src/api_client/profile.rs
[o-user]: https://github.com/aws/amazon-q-developer-cli/blob/15cc8f3cd18c4272925ce1c7053268eedff1ea0a/crates/chat-cli/src/cli/user.rs
[o-serde]: https://github.com/aws/amazon-q-developer-cli/blob/15cc8f3cd18c4272925ce1c7053268eedff1ea0a/crates/amzn-codewhisperer-streaming-client/src/serde_util.rs
