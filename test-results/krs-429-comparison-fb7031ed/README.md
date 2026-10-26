# Kiro.rs 限流与客户端协议对照

## 结论

有措施，但两个 kiro.rs 版本差异明显。较丰富的 ZyphrZero 版本具备账号级/普通 429 分流、账号冷却、可选 RPM、Retry-After 透传、带抖动退避，以及客户端格式错误停止重试等机制。AXIOM 当前 Kiro 适配器在错误分类和恢复接线上确有缺口，不能把此前失败直接定性为“只剩外部额度问题”。

但 **429 本身不能证明少了某个客户端字段、UA 模拟不到位，或请求协议错误**。当前能证实的是诊断/恢复不充分，不能证实这些缺口就是原 Sonnet 失败的根因，也不能证实照搬 KRS 请求头即可解决。

本轮仅分析、离线模拟及一次本机只读诊断查询；没有修改生产源码、账号、默认模型、重试设置或已发布证据，没有新增真实模型请求，没有运行 KRS/官方客户端，没有切号、伪造设备指纹或提交/push。

## 固定范围

“KRS”按此前已存在的两份 kiro.rs 参考源码比较；这不是在线核验最新版本，也不是把两个 fork 当成同一个实现。

| 对象 | 本地固定版本 |
| --- | --- |
| hank9999/kiro.rs（H） | `22f36e692ad387c46581a84daf0d563347e330a3` |
| ZyphrZero/kiro.rs（Z，Cargo 0.9.2） | `4cac2a8b887eacf4c8119558d3c1906e43f8cbd4` |
| 历史官方 amazon-q-developer-cli | `15cc8f3cd18c4272925ce1c7053268eedff1ea0a`，不是当前闭源 CLI 2.12 的源码 |
| AXIOM 交付树 | `d5d90322661d5d434872de024e014534c9a58c64` |
| 当前安装的 Pi | pi-coding-agent 1.1.0；SDK 文件 SHA 见 [离线结果](probe-v1.json) 和本目录指纹记录 |

## 措施对照

| 项目 | H | Z | AXIOM / Pi 当前链路 |
| --- | --- | --- | --- |
| 账号级限流分类 | 所有 429 与 408/5xx 合并为瞬态错误 | 精确识别 `USER_REQUEST_RATE_EXCEEDED`、`CREDIT_CONSUMPTION_RATE_EXCEEDED`、`SERVICE_REQUEST_RATE_EXCEEDED` 等账号级 reason | HTTP 429、流内 ThrottlingException、ServiceQuotaExceededException 合并成同一中文“HTTP 429”错误 |
| 月额度 | 仅 402 + 月额度标记禁用并换号；429 中该标记仍会普通重试 | 402 月额度/overage 分支禁用并换号 | 非成功 HTTP 不解析 body；429 中月额度无法识别；402 仅显示通用 HTTP 402 |
| 账号冷却 | 未在实际 chat 调用链找到 429 cooldown | 账号级 429 默认冷却 1800 秒并故障转移；关闭 failover 则直接返回 | Kiro chat 链未找到按账号共享的 429 cooldown；Pi 延迟只作用于当前失败链 |
| 主动 RPM | 未找到实际 chat 链的共享限额 | 可选滑窗预留；默认关闭，开启时默认 60 次/60 秒；不是平滑间隔 | Kiro 适配器没有对应账号级滑窗/RPM 实现 |
| 推理并发上限 | 未定位到 | 未定位到；Semaphore(4) 属模型刷新，不能当成推理并发限制 | 不把通用任务调度当成 Kiro 账号级 HTTP 在途控制；本轮未重建原账号全部并发负载 |
| 普通 429 退避 | 200ms 指数增长，基础封顶 2s，再加 0–25% jitter，实际最高 2.5s | 无有效 Retry-After 时 1s 指数增长，基础封顶 8s，加 0–25% jitter，实际最高 10s；可单独关闭 | 会话层默认 2/4/8s，无 jitter；Kiro adapter 每次只发一次 HTTP，没有接 provider 级重试工具 |
| Retry-After | 该分支未读取 | 支持秒数/HTTP 日期；有效值交回调用方，而不是本地等待该值；账号切换不必等待，原账号冷却使用配置值 | onResponse 可看见头，但 Kiro 错误转换与会话退避没有消费该值；不能说整个 Pi 都不支持，其他 provider 工具有实现 |
| 客户端格式错误 | 本轮未发现对应专门分流 | 精确识别 TOOL_USE_RESULT_MISMATCH / TOOL_SCHEMA_INVALID / 特定 toolResult 文案，通常在瞬态 5xx 重试之前退出；源码分支存在，不等于本轮复现过该上游行为 | 本地有严格工具历史/参数校验，流内 ValidationException 不重试；但非成功 HTTP body 被丢弃，不能识别隐藏在 5xx body 中的此类原因 |

关键源码：H [调用/退避][H1] L284–295、361–456、509–517；Z [状态处理][Z1] L947–1257、[分类器][Z2] L132–180、229–271、[默认配置][Z3] L450–468、[RPM 预留][Z4] L1923、2007、2259；AXIOM [HTTP/流处理][A1] L127–151、[错误归一化][A2] L157–170；Pi [重试工具][P1] L4–97、188–195。

**数字与切号不能混读：**

- H 外层总轮数 `min(凭据总数×3, 9)`，包含首次；只有 1 个凭据时是总计 3 轮。没有逐账号 3 次计数器；多凭据时不能称“每账号最多 3 次”。获取 token 失败也会消耗外层轮次，外层轮次不等于实际 HTTP 请求数。
- Z 外层总轮数 `min(max(分组账号数,1)×3, 4)`，包含首次；同样不能把因子 3 当作独立的逐账号上限。实际循环每轮重新选号，未设置本请求内的逐账号尝试计数；当前分组只有 1 个账号时，外层最多 3 轮；至少 2 个账号时，外层最多 4 轮，均包含首次且可能提前退出。源码注释仍写“硬上限 9”，应以常量 `MAX_TOTAL_RETRIES=4` 和循环为准。[Z1] L31–38、743–808。
- Z 普通 429 分支不主动惩罚/切号，但每轮重新选号，受会话粘性、balanced、RPM、冷却及并发状态影响，不能保证仍为同一账号。
- **换账号后成功不证明原账号通过更准确的协议模拟恢复了。** 本次没有执行任何账号轮换。
- 1800 秒、60 RPM 是该 fork 的配置默认值，不是已核实的官方限制，也不是建议直接写进 AXIOM 的参数。

## 协议层到底有哪些差别

1. Z 代码注册 CLI endpoint，但全局默认仍是 IDE；H 实际 main 只注册 IDE。因此不能拿默认 IDE 行为证明“完整模拟了官方 CLI”。Z CLI 的具体请求头/体转换见 [CLI endpoint][Z5] L29–143，默认 endpoint 见 [配置][Z3] L502。
2. Z CLI 和 AXIOM 都使用 GenerateAssistantResponse target、AWS JSON 1.0、KIRO_CLI origin。Z 会移除 continuationId 和历史 modelId；AXIOM 自己构建历史，只在 currentMessage 放 modelId，也没有该 continuation 字段。[Z5] L108–143；[AXIOM payload][A2] L121–152。不能把这些已一致的字段再列为已证实的遗漏。
3. UA 确实不同：Z CLI 使用 SDK/Rust/AmazonQ 风格 UA 和 x-amz-user-agent；AXIOM 明示 `Axiom KiroChat/1.0`。Z optout=false，AXIOM optout=true，后者是隐私行为差异，不能为了“模拟”无依据地改成上传。二者不同不等于已经证明该差异引发限流。[Z5] L60–80；[A1] L127–134。
4. H/Z 每次请求也重新生成 invocation-id，且 attempt 头恒为 `attempt=1; max=3`；H 实际外层最多 9 轮，头本身并不反映真实预算。AXIOM adapter 每次 `attempt=1; max=1`，会话层另有重试。因此单看这两个头值无法判断 HTTP 总次数或协议正确性。[H2] L73–82；[Z5] L73–79；[A1] L133。
5. Endpoint/region/profile 策略不完全一样：Z 默认 q 域名且可选 runtime 域名，API region 优先凭据显式值、真实 profile 区域、凭据 region、全局配置，与 auth region 分离；CLI OAuth 注入 profile，API Key 不注入，不是遇 429 就删除 profile。AXIOM 使用 runtime 域名，按合法 profile 区域，否则 us-east-1；本轮没有读取真实账号，**未核实原失败账号的实际路由，也没有证明 region/profile 错配**。[Z6] L849–856；[Z5] L108–115；[Z3] L27、404；[A3] L30–34；[A2] L156。

这些差异适合保留为后续验证假设，不适合直接当成根因，更不应靠改头或删 profile 盲试。

## 历史官方 CLI 给出的另一条证据

历史官方 CLI 读取可用响应体，出现 `MONTHLY_REQUEST_COUNT` 即禁止重试，而不限于 HTTP 402；对指定 500 高负载错误标为 throttling，其余交给 SDK 分类链。最终 UI 展示分类和重试分类是两套逻辑，429+月额度也可能展示为 throttling，不能只凭展示文案倒推根因。[O1] L28–76；[O2] L532–559。

配置是 adaptive、max_attempts(3)，即含首次最多 3 次；最大 backoff 10s，不是每次固定睡 10s。对应 Smithy runtime 未在本地找到，因此精确初始退避、jitter 和 Retry-After 处理未验证，不能冒充当前闭源 CLI 2.12 的行为。[O2] L81、584–587。

Pi 默认则是**额外** 3 次会话重试，故一个连续失败链最多首次+3；成功后重置，不是整个长会话只有 3 次。AXIOM worker 继承项目/全局 retry 设置，只额外覆盖了 cacheWarming，没有在此硬设重试预算；本轮未读真实 settings，不能拿默认值断言历史每次 HTTP 数。其他 Pi provider 的 provider-retry 工具支持 Retry-After，但 Kiro 自定义 adapter 没有接入。[P2] L683–688、712–716；[P3] L775–807、3028–3050；[P4] L29–44、76–77；[A4] L654–668、773–780。

## 本轮离线验证：9 项观察通过

最终 v2 命令、时间和真实退出码见 [runner](probe-v2-runner.json)；结果见 [probe-v2.json](probe-v2.json)，脚本见 [probe-v2.mjs](probe-v2.mjs)，最终指纹见 [fingerprint-v2.json](fingerprint-v2.json)。

版本记录：v1 已通过相同结构的 9 项观察，但 user-rate/credit-rate 的 synthetic reason 使用了缩写。终审核源码后补齐 `_EXCEEDED`，同时修正报告对分组账号数的措辞，另存 v2 重跑；v1 原件/结果/指纹均保留。v1/v2 是重叠观察，不合计为 18 项。

- 最终 v2 release HEAD 绑定 `d5d9032…`，node --import tsx，**exit 0**。脚本全局 fetch 与 Socket.connect 设置了 tripwire，实际网络/Socket 尝试均为 **0**；v2 的 12 次调用全部是注入的 synthetic stub。此前 v1 另有 12 次 stub，亦未发真实网络请求。
- 8 个 adapter 场景：正常成功；HTTP 429 的 user-rate、credit-rate、monthly；HTTP 402 monthly；HTTP 200 内流 throttle/quota；已输出文本后流 throttle。
- 3 种 HTTP 429 body 原因、2 种流异常和部分文本后异常得到**完全相同错误消息 SHA**。HTTP 200 流异常也被标成“HTTP 429”，说明历史文案并不能作为网络层状态证据。
- 429 中的 MONTHLY_REQUEST_COUNT 仍被 Pi 字符串分类器视为可重试；所给 Retry-After 120/1800/600 秒在 onResponse 可见，但不参与此 Kiro 错误分类/adapter 等待。
- 第 9 项用 SDK 导出的 retryAssistantCall，**只在探针局部**设置额外 3 次、零延迟，模拟上述 monthly 归一化错误，最终 stub 调用 4 次。没有改变全局设置，也不等于跑了完整 AgentSession/worker 或真实付费链路。
- 已输出 22 字符的流错误仍被分类为可重试；这是缺少“已有输出”门槛的观察，不是证明旧工具已经重放、也不是本轮重放工具。
- 报告中的 synthetic reason/header 是人为构造的反例，不是捕获的真实 Kiro 响应。源码与原 state 前后 SHA 一致；没有补分、重算矩阵或改历史发布文件。

## 原 Sonnet 错误现在能追到什么程度

[既有脱敏 post429 证据](F:/Axiom/axiom2/docs/evidence/kiro-long-session/sonnet-post429.json)仍保留：1 条持久输入，最终 failed，重试 attempt=3 / maxAttempts=3 / exhausted。私有原 state 仅提取安全计数/时序，未复制正文、思考、账号或工具参数；SHA 为 `07150ce3a90b9fd47f7b0d33e85f74544e989da3f76d72e94dc2a1506ce2b197`，前后未变。

等待快照每阶段的最大剩余时长为 1981/3980/7986ms，与约 2/4/8 秒一致；这是进度轮询快照，不是精确完整等待时间，也不足以证明实际发了 4 个 HTTP 请求。

为避免仅靠文案判断，又在现有本机服务上做了 **1 次 diagnostics.latency 只读查询**，只按已公开 run 过滤，没有发 prompt/新建任务/重载/请求模型。[查询结果](latency-readonly-v1.json)：receipt 成功、ring capacity=2000，但该历史 run 的 retained records=0，真实 HTTP 状态目前无法从这个缓存恢复。缓存无记录**不等于**之前没有请求；可能已被覆盖或生命周期已结束，原因未进一步确认。

[ModelLatency][A5] L40–43 原本可以记实际 HTTP status，但不存 body/headers；[内存 buffer][A6] L29–50 和 [WeakMap 持有][A7] L3–10 不持久化。旧 runner state 也没保存这些状态/错误 reason，因此当前仍不能确认原错误到底是 HTTP 429 还是 200 内流异常，更不能区分账号速率、credit 速率、月额度或模型容量。

## 建议优先级（本轮未实施）

1. **先补安全错误分类和最小元信息**：区分 http_status / stream_exception / allowlisted reason / 解析后的 Retry-After / 已有输出 / provider 尝试计数；对异常体做有界解析，但不保存或回显 raw body、prompt、凭据和任意服务端字符串。月额度、格式错误和容量暂不可用不能继续混在“HTTP 429”。
2. **同账号的共享节流/冷却和统一预算**：账号范围协调在途、RPM/credit 类恢复与 Retry-After；共享范围要覆盖工具续轮和其他任务，取消应中止等待。协议错误直接停止；短暂错误采用有抖动的有界退避。不要把单条输入等同单次 HTTP，也不要让 session/provider 多层预算相乘失控。具体阈值需服务端证据，不能照抄 fork 默认值。
3. **只在诊断证据充分后验证协议假设**：保持同账号、同模型、明确尝试预算，绑定 run/每次响应分类，才能判断某项策略是否改善。不要用切号成功代替同账号恢复，也不要无依据删 profile、伪造设备或修改隐私 optout。

最终判断：**AXIOM 确有值得修正的分类/恢复缺口；原 429 的精确原因仍未证实。“纯外部不可修复”和“客户端模拟错误已坐实”都超出了现有证据。** 此次对照交付不代表完成原 8 模型真实长会话矩阵，历史计分与已推送提交保持不变。

## 源码定位

[A1]: F:/Axiom/axiom-kiro-long-session-fb7031ed/app/src/server/providers/kiro-chat.ts
[A2]: F:/Axiom/axiom-kiro-long-session-fb7031ed/app/src/server/providers/kiro-chat-protocol.ts
[A3]: F:/Axiom/axiom-kiro-long-session-fb7031ed/app/src/server/providers/kiro-catalog.ts
[A4]: F:/Axiom/axiom-kiro-long-session-fb7031ed/app/src/server/agent-worker.ts
[A5]: F:/Axiom/axiom-kiro-long-session-fb7031ed/app/src/server/model-latency.ts
[A6]: F:/Axiom/axiom-kiro-long-session-fb7031ed/app/src/shared/latency.ts
[A7]: F:/Axiom/axiom-kiro-long-session-fb7031ed/app/src/server/latency.ts
[H1]: C:/Users/dane/AppData/Local/Temp/axiom-kiro-rs-research-551521254d8c430680481850c604da97/hank9999/src/kiro/provider.rs
[H2]: C:/Users/dane/AppData/Local/Temp/axiom-kiro-rs-research-551521254d8c430680481850c604da97/hank9999/src/kiro/endpoint/ide.rs
[Z1]: C:/Users/dane/AppData/Local/Temp/axiom-kiro-rs-research-551521254d8c430680481850c604da97/ZyphrZero/src/kiro/provider.rs
[Z2]: C:/Users/dane/AppData/Local/Temp/axiom-kiro-rs-research-551521254d8c430680481850c604da97/ZyphrZero/src/kiro/endpoint/mod.rs
[Z3]: C:/Users/dane/AppData/Local/Temp/axiom-kiro-rs-research-551521254d8c430680481850c604da97/ZyphrZero/src/model/config.rs
[Z4]: C:/Users/dane/AppData/Local/Temp/axiom-kiro-rs-research-551521254d8c430680481850c604da97/ZyphrZero/src/kiro/token_manager.rs
[Z5]: C:/Users/dane/AppData/Local/Temp/axiom-kiro-rs-research-551521254d8c430680481850c604da97/ZyphrZero/src/kiro/endpoint/cli.rs
[Z6]: C:/Users/dane/AppData/Local/Temp/axiom-kiro-rs-research-551521254d8c430680481850c604da97/ZyphrZero/src/kiro/model/credentials.rs
[O1]: C:/Users/dane/AppData/Local/Temp/axiom-kiro-catalog-research/amazon-q-developer-cli/crates/chat-cli/src/api_client/retry_classifier.rs
[O2]: C:/Users/dane/AppData/Local/Temp/axiom-kiro-catalog-research/amazon-q-developer-cli/crates/chat-cli/src/api_client/mod.rs
[P1]: F:/Axiom/axiom2/app/node_modules/@earendil-works/pi-ai/dist/utils/retry.js
[P2]: F:/Axiom/axiom2/app/node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js
[P3]: F:/Axiom/axiom2/app/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js
[P4]: F:/Axiom/axiom2/app/node_modules/@earendil-works/pi-ai/dist/utils/provider-retry.js
