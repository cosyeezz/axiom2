# Kiro 原生聊天协议及防御对照

## 当前交付及验证边界

`kiro` 实现原生 `kiro-chat` 文本流、图片输入、正式工具调用与多轮结果回传，接入 Pi 的认证刷新、`stream`/`streamSimple` 和 Axiom 保存、重开、快照模型路径。不是放开令牌护栏后改走 OpenAI。账号实时目录、凭据作用域隔离和无静态名单机制保持独立。

本次没有读取真实账号、执行 kiro.rs、请求受保护服务、部署、重启或提交。**隔离模拟成功不等于线上已经聊通**；真实账号权限、订阅、企业 profile、实际服务接受性、计费及其他平台仍待联调。当前 CLI 的完整异步分发、所有默认字段与当前服务器契约没有全部恢复。后续[请求等效性审计](kiro-cli-parity-audit.md)进一步区分了已接通能力、真实缺口、SDK 可选字段与上层恢复策略；本页的原验收不代表全 CLI 行为等效。

## 固定来源

| 来源 | 固定版本及用途 |
| --- | --- |
| 官方当前产物 | 本机 Windows Kiro CLI **2.12.0**，528,630,968 字节，AWS Authenticode `Valid`；SHA-256 `0ff1d24eea11aa2e244524d635e1cfc8f9820522f4c5bc192fb99590d909320a`。身份沿用[目录证据](kiro-catalog-audit.md)，本次新增只读 PE/定向 dumpbin 反汇编。不是最新 stable 2.34.0 的分析。 |
| 官方历史源码 | [aws/amazon-q-developer-cli](https://github.com/aws/amazon-q-developer-cli/tree/15cc8f3cd18c4272925ce1c7053268eedff1ea0a)，用于请求/事件 schema、HTTP 目标、历史转换和错误处理；不是当前闭源产物对应源码。 |
| 参考 H | [hank9999/kiro.rs](https://github.com/hank9999/kiro.rs/tree/22f36e692ad387c46581a84daf0d563347e330a3)；请求转换、帧处理、错误与工具流作为对照，不照搬宽松降级。 |
| 参考 Z | [ZyphrZero/kiro.rs](https://github.com/ZyphrZero/kiro.rs/tree/4cac2a8b887eacf4c8119558d3c1906e43f8cbd4)；CLI endpoint、原生 reasoning、流完整性和防御对照。 |

两份参考采用 MIT（Copyright 2026 hank9999）。适配代码独立编写，不运行参考项目，不要求安装或启动官方 CLI/第三方代理。认证的 macOS 2.33.1 旧证据仍在[认证对照](kiro-protocol-audit.md)，不得与本轮 Windows 证据混淆。

## 当前 CLI 的操作与端点证据

完整反汇编、脚本、执行记录、字符串原始偏移及摘要保存在[推理证据目录](evidence/kiro-inference/README.md)。聊天新增分析是 **dumpbin/PE 字节静态对照，不是本轮新跑的 REA 反编译**。先前目录阶段确实使用 REA 6.7.0/Ghidra 12.1.4 成功反编译四函数；这些结果不能当作聊天操作证据。

### GenerateAssistantResponse 请求序列化

- `0x140bdacc0–0x140bdbae2` 的操作引用 target `AmazonCodeWhispererStreamingService.GenerateAssistantResponse`、`x-amz-target` 与 `application/x-amz-json-1.0`。目标字符串文件偏移 `0x5d7ddb6`。
- 已核实静态调用链：`0x140bdacc0 → 0x145acddf0 → 0x140b83e60 → 0x140b82340 → 0x140ba15c0 → 0x140b95c80`；对应 JSON wrapper、顶层、conversationState、currentMessage、userInputMessage。
- 顶层字段 `conversationState/profileArn/agentMode/additionalModelRequestFields`，会话字段 `conversationId/history/currentMessage/chatTriggerType`，用户字段 `content/modelId/origin/userInputMessageContext`，context 的 `tools/toolResults` 有原始指令及字符串关联。
- POST `/`、Bearer、流式响应等还依据官方历史 SDK 的 `operation/generate_assistant_response.rs` 与 `protocol_serde/shape_chat_response_stream.rs`；不能声称这些运行细节已从当前产物完整恢复。`KIRO_CLI` 聊天 origin 与当前 Z 的 CLI adapter 一致，当前目录已独立证明该枚举；**本次没有闭合聊天 caller 到该枚举的全部链**。

### 推理不是目录端点

[端点后续报告](evidence/kiro-inference/endpoint/endpoint-followup.md)核实了数据流，而非仅搜索到域名：

1. `0x1435add80` 区域映射对 `us-east-1/eu-central-1` 分别复制 `https://runtime.us-east-1.kiro.dev` / `https://runtime.eu-central-1.kiro.dev` 记录。字符串文件偏移 `0x1b8ec098/0x1b8ec0f0`。
2. `0x1415b55db` 调用映射，结果进入构造状态 `+0xd8`，URL 经 `0x1415b6939` 交给 resolver setter `0x141c69e40`。
3. `0x1415b6ac8/0x1415b6ae5` 进入明确关联 `amzn_codewhisperer_streaming_client::config::Config` / `AmazonCodeWhispererStreamingService` 的构造函数。
4. 存在 `api.krs.service` 显式覆盖优先分支，也存在未识别地区的 q 美国回退；另一个 q 域分支属于 API Key 的 GetProfile 探测。**不能宣称所有官方请求无条件走 runtime，也不能据目录 q 域证明旧 q 域现在能聊天。**

Axiom 只支持已经限定的美/欧服务区域，采用上述 runtime 映射和 Z `src/kiro/endpoint/cli.rs` 一致的路由；目录仍用独立 q 域。显式合法 profile 决定服务区，无 profile 默认美国，不从 SSO 区域猜测、不跟随 CLI 自定义设置、不跨区试探。目录模型的 q `baseUrl` 仅作为可信目录元数据保留，聊天绝不把它或覆盖地址作为发送目标。

## 请求转换与 SDK 接线

- 基础顶层使用真实可选 `profileArn` 和 `conversationState`；后续[思考配置](kiro-thinking.md)按明确兼容模式增加 `additionalModelRequestFields`，来源是 kiro.rs，不冒充已恢复的官方 caller；`MANUAL`、稳定会话 UUID、选定模型 ID、用户 origin 与正式工具定义。保持原始工具 ID，名称仅在超过线格式时映射为可逆安全别名并拒绝冲突。
- 无 system role：使用 Pi 当前完整系统提示（包含 section 更新）作为首条用户消息的 `<axiom_system>` 前缀。不替换 Axiom 身份、不虚构助手确认、不植入参考项目提示词。
- 历史用户不附 `modelId/tools`，保留工具结果；当前用户附所选模型与当前工具表。合并连续同角色文本，不删除尾部 assistant 冒充可处理 prefill。孤立/重复/未配对结果显式失败；错误/取消的助手输出不重放为成功历史。
- 图片后续已接入原生 `images/source.bytes`，覆盖当前/历史用户图及工具图，目录声明和缓存来源也已保留；详见[原生图片实现及新验收](kiro-images.md)。不支持的内容或畸形图明确失败，不静默丢弃。思考事件可独立接收原生 text/signature/redactedContent，不伪造签名；后续[思考等级实现](kiro-thinking.md)还在主动请求思考时分离回复起始的 thinking 控制标签，正文引用保持原样。后续审计已确认官方历史 SDK 及本机 2.12.0 请求序列化链存在 `reasoningContent`；原先“没有已核实回传字段”的表述已过时。思考启用现按 kiro.rs 的预算/adaptive-effort 兼容策略接入，但官方当前回传 caller 仍未知；仍将可见历史思考明确标记为普通 assistant 上下文，opaque/redacted 与签名不出网，记录转换/省略计数诊断；这是降级行为，不是原生思考续接等效，不把新增可配置思考等同于签名续接。
- 不删 schema 的 oneOf/anyOf/allOf、数值约束或 $ref。工具结束时要求完整 JSON 对象、声明白名单及 Pi schema 校验；另外拒绝 Pi 自动转换后的值，避免把模型不合规参数修复成可执行参数。
- 裸 OAuth `toAuth` 不导出 access/refresh；原生包装仅交给 Pi 60 秒有效、单次、适配器实例隔离的不透明能力票据（最多 256 项），真实 access 仅在固定端点请求时读取。票据表不保留 refresh/clientSecret。
- Axiom 在 `ModelRuntime.getAuth` 的模型入口再次拒绝旧占位、通用 API 与恶意 Base URL 覆盖，覆盖 Pi composer 可能绕过 native stream 的路径。目录缓存可把旧 `kiro-auth-only` 归一化为新协议，显式保存的旧 API 应重新拉取添加。没有持有网络凭证的通用 OpenAI fallback。

## 防御措施对照与取舍

详细源文件/行号见[防御研究笔记](evidence/kiro-inference/defense-notes.md)，帧与事件依据见[流研究笔记](evidence/kiro-inference/stream-notes.md)。笔记中的参考项目路径是研究环境定位，不是运行依赖。

| 事项 | 参考/官方历史对照 | Axiom 采用策略 |
| --- | --- | --- |
| 输入修复 | H converter 尾部 assistant/未知块/孤立结果会被过滤；Z Generate 仍有宽松路径，压缩验证才严格；官方会把取消结果显式保留 | 不靠静默删除获得“成功”；严格 seen/pending 状态，原生保留用户/工具/历史图；畸形图片/prefill/未配对记录明确错误，不新增执行授权 |
| 工具名与 schema | 参考使用 63，官方检查允许 64；Z 会删除组合/数值约束，其 Draft-07 exclusiveMinimum 注释有误 | 线名称限 64 ASCII，冲突拒绝、原名还原；不照搬破坏性 schema 修剪。ID 256 是**本地限额**，不是宣称上游契约 |
| 帧损坏 | H 可能吞解码错误；Z 检查空流/残帧和 CRC；AWS 双 CRC | 严格 prelude/message CRC32、长度/UTF-8/header/JSON 检查；单帧线性分配、损坏即失败，不恢复后伪装完整 |
| 工具结束 | H 坏 JSON 可回退 `{}`；Z 存在任意 JSON 类型、空输入未 stop 的宽松完成；官方要求对象 | 必须 stop、完整对象、声明 schema；拒绝名称变化/重复结束/数组/残缺、无 stop EOF，不从 `<invoke>` 文本恢复执行 |
| 未知或空流 | 参考忽略未知事件可能导致无内容成功 | 未知事件可经观察钩子兼容忽略，但没有有效正文或完成工具则失败，metadata-only 不当作成功 |
| 异常/重试 | 官方月额度不重试，参考有多次重试/轮换 | HTTP/exception 脱敏映射，不回显服务正文；**adapter 自身仅一次 fetch，但 Pi agent 上层仍可能重试**，尚不能宣称整链已禁止输出后透明重放。月额度/溢出分类及跨层重试边界见后续[等效审计](kiro-cli-parity-audit.md)。取消/总期限覆盖读取 |
| 用量 | tokenUsage 与 credits/context 占比不同；旧快照可重复 | 完整四分项 token 快照覆盖，不累加；空/缺项快照仅标记 incomplete，不清空前份完整计数，不用未知 cache 零值误校 total。credits/占比单独诊断；无完整快照记 unavailable，不从费用/字符猜 token，零价格非免费 |
| 身份与路由 | 参考可制造 profile、派生/随机机器号、403 后跨区或去 profile 重试 | 不制造 profile、不伪装官方机号/UA、不换账号、不去 profile 或跨区试探；诚实 Axiom UA，禁止携带凭据重定向 |

请求 10 MiB、单帧 16 MiB、全流 64 MiB、100,000 事件、1,024 工具/调用、单工具参数 1 MiB 为 Axiom 的本地资源策略，不是当前 CLI 完整限额声明。默认总期限 10 分钟，可配置至 1 小时。思考等级/预算现通过[独立兼容映射](kiro-thinking.md)发送，不支持的档位或非法预算明确报错；温度/生成长度等其余未知参数仍记录 unsupported-controls 诊断，不猜字段。非 auto 工具选择明确失败，不忽略调用者的禁用/强制工具要求。取消可终止适配器等待挂起的受信钩子或 transport，不能强行终止其自行启动的后台工作。

## 原文本与工具版本的隔离验证

新增 `kiro-chat.test.ts` 以及独立 bitwise CRC mock frame encoder；不依赖真实服务器，生产 CRC 使用不同的 table 实现，并核对标准 `123456789 → cbf43926` 向量。

验证覆盖原生 SDK dispatch、系统提示、所选模型、固定 Bearer/target/optout/redirect/UA、覆盖头过滤、钩子、UTF-8 每字节拆帧、完整工具往返与交错、坏 JSON/schema/名称/stop/ID、CRC/残帧/空流/未知-only、原生思考/credits/usage、HTTP/流异常脱敏、不重试、超时/取消及迟到响应释放、票据实例隔离与单次使用、当时图片拒绝、孤立结果/payload 身份替换失败（图片拒绝现已由原生支持和畸形图校验替代）。Axiom runtime 测试覆盖登录 worker、实时目录、保存、重开、快照及两个完成入口的原生请求，恶意 API 覆盖零请求。

原文本/工具版本源代码冻结后的结果（不代表后续补图版本重跑）：

| 验证 | 结果 |
| --- | --- |
| Kiro 认证、回调、目录、聊天、Axiom runtime 五文件 | **42/42 通过，exit 0** |
| 通用模型 runtime/catalog/network/OAuth/auth-preparation + Qoder/CodeBuddy 八文件 | **25/25 通过，exit 0** |
| 全量 `tsc --noEmit`、server `tsc --noEmit -p tsconfig.server.json` | **exit 0** |
| `npm run build`（类型检查 + Vite 客户端 + server emit） | **exit 0**；有现有的大 chunk 体积警告，无构建错误 |

执行目录为 `app`；测试命令均使用 `node --import tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1`，分别传入上述 Kiro 五文件和通用八文件。可复用的完整命令、原始日志、退出码与范围见[验证记录](evidence/kiro-inference/validation/README.md)。最终补充复核覆盖 79 个静态证据文件的大小/SHA-256、文档本地链接、本任务文件空白及生成的原生聊天模块。

这些结果属于当前新增聊天版本，不沿用旧目录基线；没有执行清单外的全仓测试或真实 UI/账户端到端。**真实账户和上游端到端仍为明确未验证项**。
