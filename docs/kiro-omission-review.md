# Kiro 清单漏项复查与官方证据矩阵

复查日期：2026-10-27，承接2026-10-26原核对。对象为[当前校准清单](kiro-calibration-checklist.md)，不是一次新的官方 CLI 逆向、业务测试或在线验收。路线仍是 **Axiom/Pi agent 循环 + 原生 Kiro provider**，不接管到官方 CLI/ACP，不改变其他模型。

## 结论与数量的含义

原清单对主对话路径较细，但没有充分单列认证产品边界、目录内容契约、跨事件关联、跨 provider 续聊和辅助模型/进程生命周期。前轮复查从 **41 项扩展到 48 项**；二审沿完整本地调用链核反证后新增 K49；本轮多轮核查保持 **49 项**，原编号不变：

- **K42 认证产品能力**：区分“当前分支已实现”与“官方全部登录产品已支持”。
- **K43 目录完整性及元数据**：除了缓存 scope，还要核分页、默认项、重复 ID、能力/上限映射及发布原子性。
- **K44 跨事件顺序与消息关联**：除了单帧/单工具正确，还要核多 ID、thinking/tool/text 交错后的最终 Pi 消息。
- **K45 跨 provider 往返续聊**：将 K20 模型/会话边界扩展为明确的跨 provider 宿主验收，而非宣称切换有缺陷。
- **K46 记忆/整理/标题的逻辑请求身份**：不能将主对话 sessionId 契约直接套到辅助 worker 的 transport 槽。
- **K47 压缩多请求与一次性认证票据**：发现有条件的静态不相容，详见下节。
- **K48 断连取消、持久化与任务结算**：把原取消/恢复项中的跨进程部分单列为验收；没有证据证明当前丢消息。

- **K49 缓存预热的实际关闭门禁**：二审确认设置覆盖与实际getter分层不一致，并闭合合法模型覆盖下的条件性自动请求路径，详见专节。

前轮是 **七类新增检查维度，不是七个已复现 bug**。K45/K48是原项相关边界的独立展开，K47也关联K12/K37/K38；二审K49另有独立的禁用意图与后台请求门禁问题，不以K34超时或K12票据项替代。当前处置分类为 **13 保留、16 待修、12 待证、8 待验**，不是通过率。K04/K39本轮改为待修，K47/K49保留；均未据用户运行现场确认，没有运行复现，也不是用户不可用的已确认根因。

## 多轮收敛：目的、实质进展与停止依据

完整记录见[收敛报告](evidence/kiro-calibration/convergence-review.md)。每轮完整覆盖准入、协议状态、消费恢复三分区并交叉K45；并行审阅只提供候选，主会话核源码后裁决，不以编号增加或措辞变化算进展。

- **R1两组进展**：K04存在“已有store离线恢复、scope=current、空native目录但合法显式模型可选”的反例；composer只以raw base判断API支持而落compat，可在HTTP前因缺kiro-chat注册失败。K39同时补出完整计数不补价、未知计数0误known、全历史无正token/DB初null/正window时context被宿主门槛丢掉。两项改待修，不放宽scope/API，也不假造Usage值或账单。
- **R3、R5各一组并行变化**：热切模型新增冻结原文revision、desired/actual区分、串行安全点、网络重绑及失败终止；继而新增小窗口容量保护和no-op池边界。实质改变K45/K07验收，不归本会话修复，不称Kiro已覆盖；直接session context预检也不修K39宿主阈值。
- **零轮规则**：R2、R4是历史零轮，分别因后续实质变化失效；R5轮末exit1曾被误结案，已撤回补核。R6、R7全部分区完成、主裁决无净新增且77源轮末与已审基线一致，才形成连续两完整零轮并停止。停止只在受检静态范围，不保证无遗漏、官方完整链或接入可用。

## K47：保留的条件性静态问题

针对已解析的普通 Kiro 物理模型，当前安装的 Pi 1.1.0 与本地 provider 有以下链路：

1. [AgentSession 压缩入口](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js#L2144)只取得一次摘要认证，将 `request.apiKey` 交给 `compact()`。
2. [compact](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js#L685)在 `isSplitTurn` 且历史段、turn 前缀段均非空时，顺次生成两个摘要，两次均接收同一个 `apiKey`。首段成功后，第二段仍会复用它。
3. 即使不 split，[completeSummarization](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js#L477)也在重试闭包外创建包含 `apiKey` 的 `requestOptions`；[retryAssistantCall](../app/node_modules/@earendil-works/pi-ai/dist/utils/retry.js#L135)在启用重试、仍有预算且错误匹配分类器时再次调用同一闭包。现有429/HTTP 500映射可能匹配；不能泛称所有网络错误或中文“超时”都一定重试。
4. [Axiom compression wrapper](../app/src/server/compression-worker.ts#L102)透传 options；[SDK streamFn](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.js#L253)将请求交给 model runtime。
5. 实际 agent 使用的 [Pi model-runtime.prepareRequest](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js#L447)虽调用 `getAuth`，仍以 `providerOptions.apiKey ?? resolution.auth.apiKey` 优先采用显式旧票据。再次取 auth 并不自动替换它。该 runtime 对 virtual 模型跨 provider 会剥离 caller 凭据；此例不泛化至所有 virtual 路由。
6. [Kiro 消费票据](../app/src/server/providers/kiro-chat.ts#L92)首次取得后立即删除；相同值再次消费会进入“原生认证交接无效或已过期”分支。新取得但未被 options 采用的票据不能救回旧值。

以上因果链经过独立只读复核，主会话又按当前文件重核关键路径和行号；**没有运行复现，没有使用登录态，不能认定是用户当前不可用的根因**。普通不重试的单摘要并非这个“双次消费”路径，且尚未核验实际用户压缩配置。

后续应在支持的宿主扩展或依赖源码层保证每个物理调用派生本次 opaque ticket，而不是放宽为长期/重复有效、传真实 access token 或直接改安装的 node_modules。验收要覆盖两摘要首段成功、429/500重试、取消/退避/过期、branch summary相同 choke point及用量/调用数，不只测裸 provider。

## K49：二审补入的预热门禁问题

该项不需要官方agent与Pi同构，关注的是Axiom自己要求关闭自动预热能否生效。主会话核对当前源码后的链路如下：

1. 非task主会话直接使用projectSettings，[agent-worker](../app/src/server/agent-worker.ts#L735)在创建/重载前调用applyOverrides关闭cacheWarming。但[applyOverrides](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js#L389)只更新this.settings，[getCacheWarmingMode](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js#L703)却只读this.globalSettings，缺省为streaming；[SDK](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.js#L192)把这个getter交给warmer。merged settings显示off不等于实际getter返回off。
2. [Kiro原生descriptor](../app/src/server/providers/kiro-catalog.ts#L63)没有promptCache且cost全零，默认目录通常在TTL检查处停止，不能据此说默认就会请求。但[配置schema](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/model-config.js#L178)允许显式模型/override携带promptCache和cost；[applyModelOverride](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/provider-composer.js#L54)合并它们，[最终模型组合](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/provider-composer.js#L352)保留override。Axiom[执行快照](../app/src/server/execution-profile.ts#L106)与worker的runtime.getModel不会将这些字段一律清除，因此存在合法配置反例。
3. [CacheWarmer.start](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/cache-warmer.js#L111)还要求非off、请求可重放、所选retention有TTL且大于10秒。[refresh](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/cache-warmer.js#L203)要求模型/上下文仍匹配、未错过派发期限且未超安全窗口，并按最近已记录的prompt token与配置价格判断expectedSavings是否至少0.05美元；扩展可覆盖其决策。不能简化成只要cost非零就必请求，周期也不是固定五分钟。
4. 普通无扩展注入的[SDK Agent构造](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.js#L253)没有配置getApiKey/apiKey；[Agent初始化](../app/node_modules/@earendil-works/pi-agent-core/dist/agent.js#L129)与[agent-loop](../app/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js#L270)因此不会预先取得Kiro票据。[SDK先保存requestOptions](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.js#L267)，再调用runtime；[prepareRequest](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js#L447)用复制后的新options注入auth.apiKey，不回写warmer保存的对象。于是此普通路径没有有效的显式旧ticket，后续预热可重新getAuth取得本次ticket，不能套用K47的“caller显式交旧票据”阻断。
5. [warmer实际调用](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/cache-warmer.js#L237)是models.streamSimple重发保存的context，并设置maxTokens:1、maxRetries:0；[Kiro](../app/src/server/providers/kiro-chat.ts#L87)对maxTokens只加未支持诊断，不映射到上游。因此本地没有建立一token输出上限，不应以此承诺安全重放。warmer只读取结果/记录用量，不会执行其返回的工具；真实服务是否接受、生成多少、额度/费用均未测。

**保留的阻断条件**：task通过[storage wrapper](../app/src/server/agent-worker.ts#L731)将off写入读取结果，compression用[SettingsManager.inMemory](../app/src/server/compression-worker.ts#L64)写入global，这两条不同于非task覆盖；global明确off、缓存none、缺TTL、经济决策stop、上下文变化、迟到或退出/dispose仍可阻断。streaming在agent settled后停止，idle可在安全窗口内继续；不能删掉这些条件后称必然重放。

后续应在支持的宿主层让off作用于实际getter，并为没有明确安全预热契约的Kiro设请求门禁；不直接改安装的node_modules，不削弱一次性ticket，也不改变其他模型路径。验收先用mock观察实际调用次数/选项/取消/生命周期；本轮只修订审查文档，没有发出预热或其他模型请求。

## 二审细化与撤回

- **K29/K30/K44**：[reasoning分支](../app/src/server/providers/kiro-chat.ts#L161)在同一事件同时有signature与redactedContent时，后者覆盖thinkingSignature且置redacted。只确认本地行为，服务是否互斥未知，加入冲突场景而非称真实签名已丢失。[标签解析](../app/src/server/providers/kiro-thinking-stream.ts#L41)不将LF/CRLF混合双换行当作两个列明分隔符；混合分隔后有正文且无后续合法close可走unclosed回退，但纯空白尾在finish仍可关闭，撤回“混合分隔必未闭合”的过强判断。
- **K22键序候选未证实**：JSON.stringify比较本身键序敏感，但当前[JSON schema coercion](../app/node_modules/@earendil-works/pi-ai/dist/utils/validation.js#L115)与[TypeBox object conversion](../app/node_modules/typebox/build/value/convert/from_object.mjs#L9)对既有键赋值；未找到保持值却仅重排键导致误拒绝的当前路径。不计新bug，保留多键/不同声明顺序fixture，不以代码表面比较代替因果证明。
- **K31/K35与K32**：[空流和截断帧](../app/src/server/providers/kiro-eventstream.ts#L80)共用invalid错误属诊断细化；未知事件无单独诊断已由K32覆盖，均不重复新增。
- **K20/K45**：[模型副本测试](../app/tests/model-copy-runtime.test.ts#L14)只参数化四种API、不含kiro-chat，是专项验收缺口，不是副本实现错误或全库没有覆盖的证明。
- **撤回子审中的错误推导**：profile在auth保存时只受通用字符串检查，ARN正则在使用前；ticket表是插入序FIFO而非LRU；Pi目录刷新先offline再独立network context，没有核到“同一context旧scope配新credential”的路径。原K13文字已正确，不为这些推导另报缺陷。
- **预热反证也需追到底**：“目录零价/缺TTL所以所有配置都不会预热”忽略了合法override；“warmer一定保存已消费ticket所以无HTTP”混淆保存options与runtime派生options。两者均撤回。反过来也不能声称已发生请求、token消耗或扣费；本报告只确认条件性可达，不使用实际用户配置或运行结果。

## 其他新增维度的静态依据

- **K42**：[认证说明](kiro-auth.md#L19)和[实现分流](../app/src/server/providers/kiro-auth.ts#L125)表明 Builder/企业 OIDC 提供 PKCE 或 device 两种流程，Social 仅 PKCE。Social远程device、独立external_idp、profile枚举/切换并未实现，GovCloud未联调；这是能力边界，不等于已支持分支失效。
- **K43**：[descriptor](../app/src/server/providers/kiro-catalog.ts#L56)与[分页实现](../app/src/server/providers/kiro-catalog.ts#L125)要求每页合法defaultModel，默认项不会自动补入models，重复ID保留首个描述。页数/响应体/唯一模型数/总期限是本地保护。缺失tokenLimits映射为SDK的0等值，需要联验[宿主主动压缩阈值](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js#L419)，不能把0称为服务无限上限。[历史目录审计](kiro-catalog-audit.md)不是同版macOS契约。
- **K44**：[messageId赋值与reasoning分支](../app/src/server/providers/kiro-chat.ts#L151)会更新同一个responseId，也允许工具事件之后追加原生thinking。官方是否合法、服务是否真的发多ID均未知；不能以缺fixture反推必然错序。
- **K45**：[Pi建议](../app/node_modules/@earendil-works/pi-coding-agent/docs/custom-provider.md#L168)要求跨provider多轮边界验收；当前[agent.model](../app/src/server/agents.ts#L482)→[snapshot/revision](../app/src/server/agents/runs.ts#L82)→[worker安全点](../app/src/server/agent-worker.ts#L130)区分desired与actual/request，保留图/等级/网络/取消门禁、sticky失败及IPC不确定终止。[小窗口预检](../app/src/server/agent-worker.ts#L148)不足则保原文拒绝，不截断/发切换专用压缩；同选择no-op可复用，真切换不回旧profile池。[安全点测试定义](../app/tests/model-switch-safe-point.test.ts)为非kiro-chat且未运行，不能当native Kiro往返验收，也不能断言旧网络必被沿用。
- **K46**：[memory worker](../app/src/server/memory-worker.ts#L20)以实例transportId作[每次请求sessionId](../app/src/server/memory-worker.ts#L72)，[Kiro payload](../app/src/server/providers/kiro-chat-protocol.ts#L155)据此生成确定性conversationId。同一实例复用时逻辑请求可共享这个ID。query/organizer可经[模型选择](../app/src/server/memories.ts#L796)选择Kiro或使用来源会话；[标题](../app/src/server/session-titles.ts#L158)也经同runner提交。[runner](../app/src/server/memory-runner.ts#L69)仍逐次传入完整context，现有[跨scope测试定义](../app/tests/memory-runner.test.ts#L53)是本地上下文隔离，不证明服务端ID语义。没有证据证明串扰、泄漏或计费错误已发生。
- **K48**：[agent断连处理](../app/src/server/agent-worker.ts#L437)有abort与9秒兜底，[compression](../app/src/server/compression-worker.ts#L32)和[memory](../app/src/server/memory-worker.ts#L35)策略不同；但[Pi _persist](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js#L794)同步追加JSONL，[TaskDelivery](../app/src/server/tasks/delivery.ts#L43)可从磁盘恢复。需要核极端时序的一致性，不能直接断言IPC丢包等于持久化丢失。

## 原项细化，不重复计成新缺陷

- **K11**原本已经列了取消轮转/持久化。此次明确“刷新启动后调用方取消仍保存轮转结果”，属于已列未运行验收；跨进程store与退出竞争仍需运行。
- **K12**补“退出后尚未消费票据”的60秒窗口与宿主停止/撤销门禁。退出删除本地凭据不等于服务端撤销，不将此静态窗口直接称权限绕过。
- **K13/K15**补合法profile变更→scope/服务区/目录一致性，以及v1→v2迁移的两阶段发布/失败/取消/并发。是否允许网络决定是否重取；不能承诺refresh后自动重新拉目录。
- **K30**补[auth说明](kiro-auth.md#L83)也存在旧thinking叙述漂移，与原parity/推理审计一起记录勘误；本轮不改冻结证据或这些既有文档。
- **K35**区分非成功HTTP body与EventStream异常JSON。后者已在[帧解析器](../app/src/server/providers/kiro-eventstream.ts#L40)解析，但[流错误映射](../app/src/server/providers/kiro-chat.ts#L148)仅用伪头类别；新增安全白名单/冲突/超限场景，不记录原始敏感body。
- **K38**官方真实overflow文本未取得，不能仅以 `Input is too long.` 合成fixture就说Kiro全覆盖；不另计新增。
- **K39**补完整→不同完整用量快照：当前后者覆盖，快照还是累计的契约未知，不能擅自累加或取max。
- **K41/K11**组合验长排队期间轮转/配置变化与请求时实时重读。排队本身不证明worker拿着旧票据。

## 驳回或降级的推断

1. **“复用worker切模型不会重配网络”不成立**：配置位于每次run、session判断之外；复用还有setModel/refreshContext，配置变化另有retire/rebind。
2. **“入池前prepareAuth取得旧ticket，worker长排队后必然失败”不成立**：[prepareAuth](../app/src/server/model-service.ts#L143)只作预刷新并返回boolean，未跨进程交票据；[执行快照](../app/src/server/execution-profile.ts#L100)复制模型定义而非旧auth副本；真实请求仍getAuth。不猜账号TTL，不把等待时长直接换算认证失败。
3. **“断连导致事件没有持久化”证据不足**：同步JSONL和磁盘reconcile反驳了简单推导，降级为K48极端时序验收。
4. **“将来共享branch session可能abort错任务”是未来假设**：当前独立compression worker不等于该设想。branch summary只作为已存在摘要choke point的验收展开，不新增未来缺陷。
5. reasoning/tool混排、多messageId、同conversationId都只能说明本地行为和契约缺口，不能代替官方行为或真实服务错误。

## 官方证据层级与引用

矩阵中的官方列不能用本地测试定义补齐，也不能把11个函数算成11/49：

- **C**：同版macOS CLI 2.33.1 arm64 **chat** 的11个局部REA切片。是二进制反汇编/反编译伪码，**不是官方源码**，缺外部callee/常量数据等，未闭合caller→最终发送→响应正文。仓库内[局部来源索引](evidence/kiro-calibration/chat-local-rea-index.json)只摘录历史来源绑定，不是本轮新REA或完整Evidence重验。
- **L**：同版launcher的[认证局部旁证](kiro-protocol-audit.md)，不能替代chat实际取token与传递链。
- **H-W / H-S / H-P**：旧Windows 2.12、历史SDK、公开说明；来源各自见[目录审计](kiro-catalog-audit.md)、[推理审计](kiro-inference-audit.md)、[认证说明](kiro-auth.md)。旧版本/说明不能自动升级为同版chat行为。
- **T**：[第三方思考兼容策略](kiro-thinking.md)，不算官方同版证据。
- **A**：Axiom/Pi宿主、本地安全或产品策略；无须与官方agent同构，但其Kiro边界仍需验收。
- **N**：没有直接同版官方证据；不意味已证明不兼容，也不意味旧材料完全不存在。

C类的关键人工标签与地址：`generate-request` 0x1007d2a98、`header-builder` 0x10080a540、`message-serializer` 0x1007e3670、`input-context-serializer` 0x100800444、`bearer-builder` 0x100c132f8、`generate-operation-future` 0x1008283a0、`models-operation-future` 0x1008a90f8、`event-header-handler` 0x100b7b59c；另有json-key/string writer与request-finalizer。完整11项的来源hash、Evidence ID及分析digest见索引。Generate target/Content-Type局部可证；`KiroControlPlaneBearer/ListAvailableModels`只是操作身份，不是HTTP target。

### 逐项矩阵

每行均对应当前清单一个编号。“本轮未运行”适用于全部49项；本表只写静态证据层与还缺什么，**没有任何一行表示官方全行为或业务验收已通过**。

| 编号 | 官方证据层 | 已有证据与缺口 |
| --- | --- | --- |
| K01 | A | 77源新观察及15/35/49/59旧范围分开；三处并行热切变化已补核，不是本会话修复或官方对齐。 |
| K02 | A | 仓库不证明用户运行包与worker对应；需脱敏产物验收。 |
| K03 | C局部 + H-W/H-S + A | models-operation-future只证操作身份；不证modelId上游选择优先级或本地准入。 |
| K04 | A | scope匹配、空raw base与合法显式模型可选后的native/compat分发不对称已静态闭合，待修/P0；不是用户根因确证。 |
| K05 | A + N | Base URL/API限制是本地迁移保护；官方最终endpoint链未闭合。 |
| K06 | A | 目录提示的产品措辞，不是官方推理资格证明。 |
| K07 | A | 代理fail-closed/安全点重绑/连接池是宿主策略；静态close不证明性能或无socket风险。 |
| K08 | L + H-P | launcher与公开说明只旁证部分认证；完整注册/首次换码/chat传递未闭合。 |
| K09 | A | 本地手动回调Promise.race/容错；不要求复制官方UI。 |
| K10 | A | 响应字节保护是本地安全要求；30s不是同版官方常量。 |
| K11 | L局部 + A | 有刷新元数据旁证，不证明Pi刷新锁/5分钟窗口/持久化与官方相同。 |
| K12 | C局部 + A | bearer-builder证Bearer构造，不证token来源；opaque ticket及60s是本地交接。 |
| K13 | L + C局部 | launcher旁证profile非空更新/否则保留；可选profileArn序列化不证保存/使用默认。 |
| K14 | H-W/H-S | 服务区/profile规则为历史旁证与本地映射；同版chat端点选择未闭合。 |
| K15 | A | 缓存v1/v2/scope/发布是本地机制；失配不等于显式模型永不可见，须与K04分发分别核。 |
| K16 | C局部 + H-W/H-S | generate-request/header-builder证部分target/Content-Type；两个operation future证身份，最终URL/发送未闭合。 |
| K17 | C局部 + N | 现有header构造切片不是完整UA/SDK/ID生命周期基线。 |
| K18 | A | hook、固定域、禁止重定向、opt-out为本地保护；不以官方相似度削弱。 |
| K19 | C局部 | generate-request可写顶层systemPrompt；未证caller默认，不能据此否定/迁移axiom_system。 |
| K20 | C局部 | generate-request/message-serializer证current/history结构及modelId输入槽；不证选模优先级/MANUAL/conversationId生命周期。 |
| K21 | C局部 + A | input-context-serializer证工具定义能力；alias/schema/toolChoice门禁是本地策略，非caller全契约。 |
| K22 | N + A | 请求工具serializer不等响应tool增量解码；并行/执行门禁为Pi本地机制。 |
| K23 | C局部 | input-context-serializer证toolResults及扩展字段能力；不证caller默认、空值策略或服务实际接受。 |
| K24 | A + N | 历史ID/副作用账本属宿主；无同版官方恢复执行链证据。 |
| K25 | A + N | 合成user恢复边界是本地转换；官方取消/恢复caller未知。 |
| K26 | N | 同版图片caller与真实图像服务接受性未证；合成fixture不是官方证据。 |
| K27 | N | 工具图提升与逐图绑定无同版caller依据。 |
| K28 | C局部 + T | 仅additionalModelRequestFields外层可序列化；budget/adaptive/effort取自兼容策略，非官方默认。 |
| K29 | N + T/A | event-header-handler不证thinking正文/tag/signature语义；混合解析为本地策略。 |
| K30 | N | 同版签名/opaque回放与续接未闭合；本地保留/省略不是官方证明。 |
| K31 | C局部 + A | event-header-handler仅证部分伪头名/string tag6，不证CRC/完整帧实现或本地大小限额。 |
| K32 | C局部 + N | 伪头识别不证terminal/正文stop/EOF完整性契约。 |
| K33 | A | 参数扫描性能为本地实现；没有运行测量，也无需复制官方复杂度。 |
| K34 | A + N | 本地总期限/idle/大小限额；官方同值未证，真实取消/回收待验。 |
| K35 | C局部 + N | 只局部证exception伪头名；官方错误body/安全类别/重试诊断未闭合。 |
| K36 | N + A | 额度/限流的同版结构契约未知；中文映射/Pi regex是本地事实。 |
| K37 | A | Pi宿主attempt重试/执行状态；无官方完整恢复行为证据，也不要求照搬官方agent。 |
| K38 | A + N | Pi省略/压缩投影及K39宿主阈值门槛已静态核对；真实Kiro overflow正文与完整官方恢复链未证。 |
| K39 | N + A | 官方usage/credits/计价契约未闭合；本地cost初始化0、未知计数被当0、正window但宿主丢context三边界待修/P1，unknownCost仍护金额。 |
| K40 | A | 本地验收门禁；历史记录不能替代本轮运行。 |
| K41 | A | Axiom共享scheduler FIFO准入，不属于官方CLI wire契约。 |
| K42 | L局部 + H-P + A | 认证产品说明与本地能力边界；未证明所有分支在同版chat及GovCloud可用。 |
| K43 | H-W/H-S + A | 历史目录schema/分页旁证与本地限额，非同版Mac完整catalog契约。 |
| K44 | N | 官方多messageId/跨事件顺序与响应关联没有直接同版正文证据。 |
| K45 | A | 原文revision/desired→安全点→actual记录、小窗口拒绝/no-op池隔离已读；非Kiro测试定义未运行，native往返仍待验。 |
| K46 | A + N | transportId→conversationId是本地链；官方服务如何解释辅助操作ID未知。 |
| K47 | A | 本地一次性ticket与Pi多调用存在条件性静态不相容；不依赖官方REA才可识别，也未运行复现。 |
| K48 | A | 本地worker断连/JSONL/reconcile组合验收；非已证数据丢失或官方行为差异。 |
| K49 | A | 本地预热门禁与配置覆盖链；不需复制官方agent，但自动重放/实际输出上限须验收；非已证服务费用或用户根因。 |

## 历史保留与本轮验证边界

- [原41项清单](kiro-calibration-checklist-41-items.md) SHA256：`aade806d740fc3101f7fdca8fcad149387bc1c1c119bd2d7fd3d8bb52fa2107e`。
- [原文档校对结果](evidence/kiro-calibration/verification-41-items.json) SHA256：`31fc90ad91f3e1d6d8aa96f2d0b971456340bc6625cadbf759b17bd1c1d29628`；历史结果是41项、86链接、42链接文件、35源文件、旧15/15匹配，不能改称本轮重跑。
- [前轮48项清单](kiro-calibration-checklist-48-items.md)、[前轮漏项报告](kiro-omission-review-48-items.md)及[verification-48-items.json](evidence/kiro-calibration/verification-48-items.json)保留原字节；SHA256依次为`3462fbf32b1cb784347a68788d2a6254d19e35b4907b36f1c47d7f5f6b09ff1d`、`27705985943e90f82440c3423dc048b35685e6cadd4314189b779ef77ffae575`、`d5803ffeab9c379bd20dc322f6edd3e7b26d1de39893dd85632cc6d748e7ce54`。其48项/48矩阵、171链接、61链接文件、49源是前轮观察，不冒充二审新跑。
- 二审改文档前的“49源/9支持文档无漂移、35源仅package变化”是历史观察；此后发生热切与小窗口并行修改，不能再当当前事实。本轮旧15/35/49/59源匹配分别14/31/46/56，已审三处变化及新范围见[77源基线](evidence/kiro-calibration/convergence-source-baseline.json)。Pi仍1.1.0，九个Kiro provider相对HEAD无差异，不归本会话业务修改。
- 改本稿前的[49项清单](kiro-calibration-checklist-49-items.md)、[49项报告](kiro-omission-review-49-items.md)和[49项结果](evidence/kiro-calibration/verification-49-items.json)按原字节归档，SHA依次为`6d9e8a9ce1e58cbe2d52e139aa4168cc01476c631d7c4ff4ae2cb3470fd78503`、`c73d86a60ee0e3db865aaf7d322e2354e3da276c7c88293331e84c28c32e73c9`、`11f41dfbf9688cddfeca116609932cee8c873430b8e473280adeb826d5c6ae58`。其49/49、15/14/12/8处置、219链接/73文件、59源/12支持文档仅属此前观察。
- 新文档结构、矩阵连续性、链接/行界、源字节观察与历史副本保护由[校对脚本](evidence/kiro-calibration/verify-checklist.py)检查，结果见[verification.json](evidence/kiro-calibration/verification.json)，语义复核见[semantic-review.md](evidence/kiro-calibration/semantic-review.md)。这不是运行接入测试或官方行为验证。
- 本轮不改provider/宿主/其他模型，不运行项目测试、构建、CLI/REA、登录、刷新、目录或模型请求，不读取实际用户配置、凭据、日志或历史。官方完整链仍未闭合；业务修复、离线接线与Axiom实际对话均未执行。

本次静态收敛停止条件已满足，仍不能保证没有遗漏。下一阶段优先修K04原生分发，再分别处理K47票据、K49实际预热门禁、K39用量/context和分阶段诊断；它们都不自动成为用户根因。先获修复授权，再离线provider→Pi→Axiom mock，门禁通过后才在Axiom隔离真实对话；未经授权不使用现有登录态，不自动重跑旧REA失败。
