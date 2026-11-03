# 原生 Responses 重试接入设计

**设计已定稿，尚未实现或启用。生产仍单次发送 `1;max=1`。** 仅覆盖 `kiro / deepseek-3.2 / off` 的原生 Responses；其他模型的 AWS 路径不变。没有新增真实模型请求、部署、依赖或锁文件修改。

## 1. 证据和交付边界

- 官方依据：macOS CLI2.36.0 / KAS0.66.70；[static01](evidence/kiro-macos-native-02/responses-metadata-retry-01/REPORT.md)、[static02](evidence/kiro-macos-native-02/responses-metadata-retry-02/REPORT.md)、[static03](evidence/kiro-macos-native-02/responses-metadata-retry-03/REPORT.md)、[static04](evidence/kiro-macos-native-02/responses-retry-ownership-04/REPORT.md)。四个调查均已关闭，不再扩取窗口。
- [离线设计验证05](evidence/kiro-macos-native-02/responses-retry-design-05/REPORT.md)：实际 Pi1.4.0 会话事件、已装 Smithy3.35.2 的构造器/内部等待/退款、模拟迟到 acquisition 的所有权验证。**不是已实现重试器或官方运行差分，更不是 wire/server parity。**
- 当前链为 `onPayload → prepare → 单次 send → onResponse → 有界 HTTP 错误读取 → SSE`。新控制器只替换中间的 pre-response 单次发送，不包住整个 assistant stream。
- 保留单次原生 sender、observer、真实认证/profile、caller system/history/tools/security、取消、严格终态和工具校验。不改 UA、隐私 optout、不切模型、不复制 CLI 凭据、不借 CLI/ACP 代发、不引入反代或用户 APIKey/baseURL。

## 2. 分离三种身份

| 身份 | 归属与寿命 | 不可替代为 |
|---|---|---|
| client/retry state | Provider 内的账号 epoch + model/mode/origin/effective profile | runId 或每次 HTTP 新建 |
| continuation | 已实现的新普通 host run UUID；同轮工具调用稳定 | session UUID、服务端 response ID |
| callPosition | 新普通 run 的主模型 invocation 进度；首次1 | 物理 requestId、历史条数、简单 stream 调用次数、Pi 私有 turnIndex |

官方 Gx 的 key 是 modelId/agentMode/origin，Hgr 每新 client 建一个 Qne；默认 factory 会跨普通 run 复用 adaptive 状态。Axiom affinity worker 复用 session/ModelRuntime，`kiroProvider` 每实例创建一个 `kiroChat`，因此可以保存 client 状态。**这不是账号隔离的证明，也不等价于官方跨所有 session/进程的缓存范围。** 不建立全局跨账号共享 Map。

### 账号 epoch：选定保守方案

1. Provider 创建私有 account-scope owner；native 核心只见不透明 owner/epoch 引用，不见账号路径、refresh token 或敏感 hash。外部 metadata 不得提供或替换 owner。
2. 在现有 `toAuth` 的凭据验证边界，以现有 `kiroCatalogScope` 的同账号判定绑定 owner，复用其既有语义，不新增凭据散列算法。scope 只用于进程内判等，不写入新诊断/日志/证据。票据额外携带 owner/epoch 引用，仍60秒、单次，仍不携带 refresh/registration secret。
3. scope 缺失/改变、logout、显式 reset、Provider retirement：先 retire 旧 epoch 并取消其全部操作，再建立新的 state。旧票据不能用于新 epoch；旧异步结果不得更新新 state 或发送。同一 Provider 并发使用不同账号将被拒绝/取消旧 epoch，调用方须按账号分 Provider，不能把它做成多账号共享队列。
4. **access-only 轮转且现有 catalog scope 不变时保留状态；refresh token 轮转、auth mode/region/profile 变化时保守重置。** 官方默认 cache 不按这些字段分区，其跨账号/refresh 实际行为未证；这里是明确的安全差异，不宣称完全相同。以后只有稳定账号标识和登录代际已验证时才可放宽 reset，不能用相同 profile 或 worker 复用猜同账号。
5. profile discovery 后，effective profile 纳入内部 client key，避免把不同 profile 的 throttle 状态混用。创建请求时验证 ticket epoch，排队结束及每个异步边界后再验证；不得用旧 body/auth 配上新账号 owner。
6. Map/队列均有固定上限，满时 fail-closed，不逐出有活动 acquisition 的 client；idle eviction 必须是显式 reset。具体上限可按单 DeepSeek client 的最小需求实现，不能静默创建无限 owner。

独立 native SDK 的低层 `sendKiroNativeRequest` 继续单次发送。需要重试的嵌入方显式创建 credential-bound client/owner 并提供调用进度；不能因缺 metadata 自动猜会话。Axiom Provider 负责正常凭据交接，不要求用户配置任何额外密钥。

## 3. 主轮进度与 purpose

使用公开 `session.subscribe`，不读取 `_turnIndex`。tracker 由现有 `freshKiroRunIdentity` 对应的新普通 host run 创建/重置，不在 `agent_start` 重置：Pi retry 会再次触发该事件。

- `turn_start`：正常新主调用加1；若前面有 `auto_retry_start`，复用当前 position，再清除 retry-pending。
- `turn_end`/`agent_settled`：关闭主请求窗口。`auto_retry_end` 失败或取消时清除 pending；不能把 agent_end 当整个 host run 已结束。
- 主 metadata 只在正确 sessionId、原生 DeepSeek、有效普通 run、主请求窗口内注入；保留现有 hooks/fetch/metadata，不修改 caller 对象。带 parentToolCallId 的子调用不计入主进度。
- `compaction_start` 后，本 run 的自动 progress 对齐失效；summary 及恢复后主请求暂退回显式单次策略，直到新普通 run。官方压缩/reset/恢复计数边界未证，不能继续装作已知。manual/threshold/overflow 都适用。summary 的重试不是主轮 retry。
- resume、memoryContinuation、notification、reload、compressionPreparation 等沿用现有排除，不自行恢复计数。未知调用默认单次，不根据 tools=0、缺 continuation 或输入长度推断 title。
- 标题已有可信入口：`session-titles.ts` → `MemoryExecution.kind="title"` → `memory-worker.ts`。后者直接 `completeSimple` 且 `maxRetries:0`，无主 AgentSession；未来由此显式标记 session-title 并禁 pre-response retry。此次不改标题的 body/continuation/attempt 头，也不宣称标题请求已与官方一致。

实际 Pi 夹具验证：首请求失败、SDK retry 成功调用工具、工具后续请求的位置是 **1,1,2**，不是1,2,3；新普通 host run 重置为1。同 session 的 split-turn compaction 有 history summary + turn-prefix summary，加一次 summary retry 共3次 stream，全部不标记 main。此验证证明接点可用，不证明官方 graph 恢复边界。

## 4. 重试层所有权：不能乘上 Pi 九档重试

当前 Axiom `session-retry-policy.ts` 默认9次 session retry；Pi `isRetryableAssistantError` 只看 stopReason/errorMessage 正则，没有公开的结构化 `retryable:false` hook。若直接添加3～6次 native attempts，最坏可放大为30～60次真实请求。**不得未经协调直接开启。**

选择互斥的策略所有权：

- `session-managed`：现有默认行为，native 单次，Pi 管会话重试。AWS、其他模型、未映射的恢复/summary/辅助调用保持不变。
- `native-pre-response`：仅明确映射的新普通 DeepSeek main invocation；native 控制器负责该次 pre-response episode。终结时提供固定、白名单 `retryOwner/nativeFinal/phase` 诊断；禁止服务端正文决定这些字段。
- Axiom 现有 Pi1.4.0 version-bound retry bridge 扩展两处统一判定：`_willRetryAfterAgentEnd` 和 `_prepareRetry` 对已由 native owner 终结的 DeepSeek episode 不再自动重试。必须同时处理 willRetry 展示与执行，不能只改其中之一；不读/改 SDK 私有计数，不修改 node_modules。
- 同一 native-owned invocation 成功取得 Response 后的 SSE/终态/工具校验失败也终结该 episode，不能通过 Pi 再包一层重放。其他模型和 session-managed 路径保留现有分类/次数/显式用户设置。
- 不通过改写错误文案骗过 Pi 正则；不全局禁重试。未来 Pi 有公开结构化判定时替换此版本绑定桥接；升级不兼容应明确拒绝启用 native-owned 模式。
- 读取当前显式 retry disable/zero 配置，不能以启用 native 为由恢复用户已禁用的自动重试。Provider `options.maxRetries` 若存在，作为 native retry 次数上限；undefined 才用官方进度预算。`maxRetries:0` 必须最多一次发送。保持超时/最大等待约束，不偷偷改设置文件。

这属于后续启用的**必需实现门槛**，本次未更改任一重试策略。旧 AWS `kiro-failure.test.ts` 的“一次 provider send 对应一次 Pi attempt”验收继续有效。

## 5. 选用 Smithy 与取消所有权

选用当前已装 `@smithy/core/retry` 的 AdaptiveRetryStrategy；实现时再声明直接、固定版本依赖并核锁文件，本次不安装/改依赖。不复制整套 rate limiter，不更改全局 timer 或 Retry flags。

- 构造器只传函数式 `maxAttemptsProvider`，**不传 options 对象**。3.35.2 传 options（包括仅自定义 rateLimiter）会把函数预算替换成固定3；离线测试已复现4→6仍返回3的陷阱。
- 每 client 一个 strategy，一次 pre-response transaction 独占一个 lease。lease 固定本次 budget/position；函数 provider 读取该 lease，不读可能被其他调用改变的 run 全局值。串行化持续到成功 Response 返回或全部 SDK acquisition 真正 settle；SSE 消费不持有 retry 锁。
- SDK acquisition 不接收 AbortSignal。采用**调用方可立即取消、未完成 acquisition 保留所有权**的双生命周期。不能仅 `Promise.race` 后放锁，也不能在原 SDK 仍运行时修改其共享预算或重置同一对象。

示意（不是生产代码）：

```text
operation = predecessor.then(async () => {
  assert(signal, epoch)
  lease = freeze(position, budget)
  token = await sdk.acquire/refresh(...)
  assert(signal, epoch)             // late completion cannot send
  await cancellableQneDelay(...)
  assert(signal, epoch)
  return actualNativeSend(...)
})
owner.tail = operation.settleToVoid() // retained even if caller stops waiting
return waitForCallerOrAbort(operation, signal)
```

真实实现中的 operation 必须覆盖整个 episode、所有失败 cleanup 和重试，而非仅一次 acquisition。所有实际 send 前，以及 send 返回后均检查 signal/epoch；已晚到的 Response 必须 cancel body，不发布成功。队列中取消的任务留下顺序屏障但不能执行；它仍等待 predecessor settle 才释放后继。

- abort 调用方立即得到终态；旧 SDK 的迟到 capacity/rate 修改仍可发生，但只影响其被隔离/独占的旧 state；pending 未完成时不让后继使用它。新账号 epoch 使用全新 strategy，不共享这些字段。
- 若 SDK 永不 settle，不能偷偷放锁；后续等待受自身 deadline 约束，owner 保持隔离直至 retirement。队列必须有上限。不得为了重用而手动篡改 SDK state。
- owner retire 使用独立 signal 合并请求 signal，禁止迟到 send。仅 Promise handler 消费拒绝，不吞并当前调用错误。无活动请求的 Provider 释放 owner；进程结束自然销毁内存，不持久化 adaptive 状态。
- 串行化和账号 reset 是安全设计选择；官方并发时的时序未证，不把它们包装成完全等价。

离线延迟 acquisition/排队取消 probe 已验证“不提前放锁、不迟到 send、不绕过 predecessor”。它不是完整 native transport 取消验收；真实控制器仍须覆盖 abort→HTTP返回的竞态。

## 6. pre-response 算法与 HTTP 边界

### 预算与等待

- 官方预算 `3 + bonus(position)`：≤2为0、≤6为1、≤11为2、否则3；host position 必须是安全正整数。显式 caller cap 再取小值；头中的 max 必须是实际采用预算。
- 初始 acquire → 第一次 send；失败先检查 abort，再按官方 name/reason/network 分类调用 refresh；仅允许 THROTTLING/TRANSIENT，遵守 capacity/count gate。
- 保留两层等待：SDK refresh 内部 backoff + adaptive bucket，然后 Qne 返回的额外 delay。Qne token wrapper 不传 getRetryCost 的有效值，成功 refund1；不能直接把 Smithy token recordSuccess 导致退回原cost。
- hint 先特殊毫秒头，再 body.retryAfterMilliseconds，再标准 Retry-After；按冻结解析规则，非负有限、上限300000ms。Qne 无 hint 时 transient250/throttle1000、指数、先cap20000再±20% jitter，因此结果可能超过20000。SDK内部算法、capacity500和两套2026/default参数见static03。
- `maxRetryDelayMs`、caller deadline 仍是安全约束；超限终止而非提前重发。SDK不可取消等待期间可立即终结 caller，保留隔离 owner。多层总等待也计入 deadline。
- 已装 SDK 不等于官方 resolved 版本。测试进程走 default 分支，第一次 TRANSIENT 内部50ms（random=.5）、capacity500→490、Qne式成功退款→491、返回 token delay0。**没有运行2026分支验证；官方实际 flags 未证。** 不改全局 flag 强行制造匹配。

### 每个物理 attempt

1. onPayload/prepare 仅一次；固定序列化 body、auth/profile、model、continuation、caller 内容。排队后过期凭据应终止，不能在 episode 内隐式刷新或换账号。
2. 为本 attempt 新建 headers，更新真实 `x-kiro-attempt`；保护头过滤不能允许扩展覆盖 attempt/认证/长度/UA。不修改共享 Headers。
3. 通过现有 observer 包装的 native transport 实发。observer 已按 fetch wrapper 每次调用 start，并在非ok响应/backoff之前 end；不能用物理计数反向驱动主 callPosition。
4. status<400 在官方 callback 中视为 pre-response 成功；在交给 caller hook/SSE 前仅 recordSuccess 一次，保留此 success/refund 边界。HTTP重定向仍不跟随。
5. 每个实际 Response 的 onResponse hook 按当前语义执行；hook throw/abort 单独视为 terminal，不进入服务错误重试分类。失败 Response 的 body 必须有界读取/取消后才能下次发送。成功 Response 后的 hook/content-type/SSE/终态/工具失败不得重进 controller，也不撤销已记录的 transport success。

### 分类和隐私

现有 `kiro-failure.ts` 是本地诊断策略，不直接复用为 retry classifier。实现独立的 RAM-only Responses envelope→modeled name/reason→Kce分类适配，使用static03/04已保存的映射和六enum union：

- context/model/schema/json/opt-in/overload/rate-limit 的七别名及413强制长度原因按static04；未知reason不因uppercase或模糊包含词变成已知值。
- usage/period/overage/new-user pause、validation、auth、certificate等 terminal；429不一律重试，unknown5xx不自动TRANSIENT。
- 网络分类只检查当前 transport错误的固定已知结构；hook、配置、auth/profile准备、解析和工具错误不假装网络错误。
- 当前错误reader16KiB/1s保留。超限/超时/非JSON/无法确认的body不被当作有完整官方错误证据，采取保守单次终止。官方 qOo 边界更宽，不能称大/慢body等价。
- raw token/Authorization、原始请求响应/上下文、未知error仅RAM；新日志仅固定分类、阶段、attempt/budget、计时和布尔结果，不新增敏感hash。正常应用认证/会话存储语义不变。

## 7. 后续实现验收清单（此次未执行）

| 范围 | 必须验证 |
|---|---|
| 原生 episode | 真实头序列1..budget，request body/auth/profile/continuation不变；禁redirect/fallback |
| classifier | 已知重试与terminal各类、七alias/六enum、429quota、unknown5xx、hint优先级/非法值/大慢body |
| SDK状态 | 两层等待、容量耗尽/refund1、adaptive桶跨普通run复用、动态bonus阈值；2026单独进程 |
| 所有权 | access-only轮转保留、refresh/account/profile改变重置；并发/排队上限/retirement/旧ticket/迟到结果隔离 |
| Pi接点 | main工具轮、新host run、SDK retry不加进度；native耗尽不叠乘Pi；AWS与显式disable/zero不回归 |
| 辅助与恢复 | title显式禁重试；summary/压缩/恢复不误标main；不能从缺continuation推断purpose |
| hooks/transport | actual ModelRuntime + observer + native HTTP；每attempt hooks/统计；hook拒绝和HTTP晚返回清理 |
| stream/tool安全 | 成功Response后不重放，截断/空delta/缓冲tool均保守；不重复工具副作用 |

先离线控制器及本地HTTP测试，再必要回归/typecheck/build；新真实 wire case 必须独立合同、目录和exclusive claim，live01～06绝不重用。完整retry、跨恢复计数、辅助continuation、optout、OAuth/direct TLS等仍未验收；本设计完成不关闭整体 parity 目标。
