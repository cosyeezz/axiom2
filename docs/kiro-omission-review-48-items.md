# Kiro 清单漏项复查与官方证据矩阵

复查日期：2026-10-27，承接2026-10-26原核对。对象为[当前校准清单](kiro-calibration-checklist.md)，不是一次新的官方 CLI 逆向、业务测试或在线验收。路线仍是 **Axiom/Pi agent 循环 + 原生 Kiro provider**，不接管到官方 CLI/ACP，不改变其他模型。

## 结论与数量的含义

原清单对主对话路径较细，但没有充分单列认证产品边界、目录内容契约、跨事件关联、跨 provider 续聊和辅助模型/进程生命周期。复查后从 **41 项扩展到 48 项**，原编号不变：

- **K42 认证产品能力**：区分“当前分支已实现”与“官方全部登录产品已支持”。
- **K43 目录完整性及元数据**：除了缓存 scope，还要核分页、默认项、重复 ID、能力/上限映射及发布原子性。
- **K44 跨事件顺序与消息关联**：除了单帧/单工具正确，还要核多 ID、thinking/tool/text 交错后的最终 Pi 消息。
- **K45 跨 provider 往返续聊**：将 K20 模型/会话边界扩展为明确的跨 provider 宿主验收，而非宣称切换有缺陷。
- **K46 记忆/整理/标题的逻辑请求身份**：不能将主对话 sessionId 契约直接套到辅助 worker 的 transport 槽。
- **K47 压缩多请求与一次性认证票据**：发现有条件的静态不相容，详见下节。
- **K48 断连取消、持久化与任务结算**：把原取消/恢复项中的跨进程部分单列为验收；没有证据证明当前丢消息。

这是 **七类新增检查维度，不是七个已复现 bug**。K45/K48是原项相关边界的独立展开，K47也关联K12/K37/K38，但此前没有识别出多物理调用复用同一票据的因果链。当前处置分类为 **15 保留、13 待修、12 待证、8 待验**，不是通过率。

## K47：本次确认的条件性静态问题

针对已解析的普通 Kiro 物理模型，当前安装的 Pi 1.1.0 与本地 provider 有以下链路：

1. [AgentSession 压缩入口](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js#L2144)只取得一次摘要认证，将 `request.apiKey` 交给 `compact()`。
2. [compact](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js#L685)在 `isSplitTurn` 且历史段、turn 前缀段均非空时，顺次生成两个摘要，两次均接收同一个 `apiKey`。首段成功后，第二段仍会复用它。
3. 即使不 split，[completeSummarization](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js#L477)也在重试闭包外创建包含 `apiKey` 的 `requestOptions`；[retryAssistantCall](../app/node_modules/@earendil-works/pi-ai/dist/utils/retry.js#L135)在启用重试、仍有预算且错误匹配分类器时再次调用同一闭包。现有429/HTTP 500映射可能匹配；不能泛称所有网络错误或中文“超时”都一定重试。
4. [Axiom compression wrapper](../app/src/server/compression-worker.ts#L102)透传 options；[SDK streamFn](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.js#L253)将请求交给 model runtime。
5. 实际 agent 使用的 [Pi model-runtime.prepareRequest](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js#L447)虽调用 `getAuth`，仍以 `providerOptions.apiKey ?? resolution.auth.apiKey` 优先采用显式旧票据。再次取 auth 并不自动替换它。该 runtime 对 virtual 模型跨 provider 会剥离 caller 凭据；此例不泛化至所有 virtual 路由。
6. [Kiro 消费票据](../app/src/server/providers/kiro-chat.ts#L92)首次取得后立即删除；相同值再次消费会进入“原生认证交接无效或已过期”分支。新取得但未被 options 采用的票据不能救回旧值。

以上因果链经过独立只读复核，主会话又按当前文件重核关键路径和行号；**没有运行复现，没有使用登录态，不能认定是用户当前不可用的根因**。普通不重试的单摘要并非这个“双次消费”路径，且尚未核验实际用户压缩配置。

后续应在支持的宿主扩展或依赖源码层保证每个物理调用派生本次 opaque ticket，而不是放宽为长期/重复有效、传真实 access token 或直接改安装的 node_modules。验收要覆盖两摘要首段成功、429/500重试、取消/退避/过期、branch summary相同 choke point及用量/调用数，不只测裸 provider。

## 其他新增维度的静态依据

- **K42**：[认证说明](kiro-auth.md#L19)和[实现分流](../app/src/server/providers/kiro-auth.ts#L125)表明 Builder/企业 OIDC 提供 PKCE 或 device 两种流程，Social 仅 PKCE。Social远程device、独立external_idp、profile枚举/切换并未实现，GovCloud未联调；这是能力边界，不等于已支持分支失效。
- **K43**：[descriptor](../app/src/server/providers/kiro-catalog.ts#L56)与[分页实现](../app/src/server/providers/kiro-catalog.ts#L125)要求每页合法defaultModel，默认项不会自动补入models，重复ID保留首个描述。页数/响应体/唯一模型数/总期限是本地保护。缺失tokenLimits映射为SDK的0等值，需要联验[宿主主动压缩阈值](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js#L419)，不能把0称为服务无限上限。[历史目录审计](kiro-catalog-audit.md)不是同版macOS契约。
- **K44**：[messageId赋值与reasoning分支](../app/src/server/providers/kiro-chat.ts#L151)会更新同一个responseId，也允许工具事件之后追加原生thinking。官方是否合法、服务是否真的发多ID均未知；不能以缺fixture反推必然错序。
- **K45**：[Pi自定义provider建议](../app/node_modules/@earendil-works/pi-coding-agent/docs/custom-provider.md#L168)将跨provider多轮列为检查范围。[worker每次run配置网络](../app/src/server/agent-worker.ts#L641)，[复用更新模型](../app/src/server/agent-worker.ts#L835)与[环境重绑](../app/src/server/execution-profile.ts#L100)是反证，不能称“必然沿用旧网络”。已有Kiro专项测试未见明确命名的跨provider往返场景，不证明不存在隐式覆盖。
- **K46**：[memory worker](../app/src/server/memory-worker.ts#L20)以实例transportId作[每次请求sessionId](../app/src/server/memory-worker.ts#L72)，[Kiro payload](../app/src/server/providers/kiro-chat-protocol.ts#L155)据此生成确定性conversationId。同一实例复用时逻辑请求可共享这个ID。query/organizer可经[模型选择](../app/src/server/memories.ts#L796)选择Kiro或使用来源会话；[标题](../app/src/server/session-titles.ts#L158)也经同runner提交。[runner](../app/src/server/memory-runner.ts#L69)仍逐次传入完整context，现有[跨scope测试定义](../app/tests/memory-runner.test.ts#L53)是本地上下文隔离，不证明服务端ID语义。没有证据证明串扰、泄漏或计费错误已发生。
- **K48**：[agent断连处理](../app/src/server/agent-worker.ts#L382)有abort与9秒兜底，[compression](../app/src/server/compression-worker.ts#L32)和[memory](../app/src/server/memory-worker.ts#L35)策略不同；但[Pi _persist](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js#L794)同步追加JSONL，[TaskDelivery](../app/src/server/tasks/delivery.ts#L43)可从磁盘恢复。需要核极端时序的一致性，不能直接断言IPC丢包等于持久化丢失。

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

矩阵中的官方列不能用本地测试定义补齐，也不能把11个函数算成11/48：

- **C**：同版macOS CLI 2.33.1 arm64 **chat** 的11个局部REA切片。是二进制反汇编/反编译伪码，**不是官方源码**，缺外部callee/常量数据等，未闭合caller→最终发送→响应正文。仓库内[局部来源索引](evidence/kiro-calibration/chat-local-rea-index.json)只摘录历史来源绑定，不是本轮新REA或完整Evidence重验。
- **L**：同版launcher的[认证局部旁证](kiro-protocol-audit.md)，不能替代chat实际取token与传递链。
- **H-W / H-S / H-P**：旧Windows 2.12、历史SDK、公开说明；来源各自见[目录审计](kiro-catalog-audit.md)、[推理审计](kiro-inference-audit.md)、[认证说明](kiro-auth.md)。旧版本/说明不能自动升级为同版chat行为。
- **T**：[第三方思考兼容策略](kiro-thinking.md)，不算官方同版证据。
- **A**：Axiom/Pi宿主、本地安全或产品策略；无须与官方agent同构，但其Kiro边界仍需验收。
- **N**：没有直接同版官方证据；不意味已证明不兼容，也不意味旧材料完全不存在。

C类的关键人工标签与地址：`generate-request` 0x1007d2a98、`header-builder` 0x10080a540、`message-serializer` 0x1007e3670、`input-context-serializer` 0x100800444、`bearer-builder` 0x100c132f8、`generate-operation-future` 0x1008283a0、`models-operation-future` 0x1008a90f8、`event-header-handler` 0x100b7b59c；另有json-key/string writer与request-finalizer。完整11项的来源hash、Evidence ID及分析digest见索引。Generate target/Content-Type局部可证；`KiroControlPlaneBearer/ListAvailableModels`只是操作身份，不是HTTP target。

### 逐项矩阵

每行均对应当前清单一个编号。“本轮未运行”适用于全部48项；本表只写静态证据层与还缺什么，**没有任何一行表示官方全行为或业务验收已通过**。

| 编号 | 官方证据层 | 已有证据与缺口 |
| --- | --- | --- |
| K01 | A | 本地源hash/更新范围；不是官方行为对齐项。 |
| K02 | A | 仓库不证明用户运行包与worker对应；需脱敏产物验收。 |
| K03 | C局部 + H-W/H-S + A | models-operation-future只证操作身份；不证modelId上游选择优先级或本地准入。 |
| K04 | A | 原生注册/dispatch是本地架构；真实worker接线待验。 |
| K05 | A + N | Base URL/API限制是本地迁移保护；官方最终endpoint链未闭合。 |
| K06 | A | 目录提示的产品措辞，不是官方推理资格证明。 |
| K07 | A | 代理fail-closed/连接池是宿主策略，无官方相同参数证明。 |
| K08 | L + H-P | launcher与公开说明只旁证部分认证；完整注册/首次换码/chat传递未闭合。 |
| K09 | A | 本地手动回调Promise.race/容错；不要求复制官方UI。 |
| K10 | A | 响应字节保护是本地安全要求；30s不是同版官方常量。 |
| K11 | L局部 + A | 有刷新元数据旁证，不证明Pi刷新锁/5分钟窗口/持久化与官方相同。 |
| K12 | C局部 + A | bearer-builder证Bearer构造，不证token来源；opaque ticket及60s是本地交接。 |
| K13 | L + C局部 | launcher旁证profile非空更新/否则保留；可选profileArn序列化不证保存/使用默认。 |
| K14 | H-W/H-S | 服务区/profile规则为历史旁证与本地映射；同版chat端点选择未闭合。 |
| K15 | A | 缓存v1/v2/scope/发布是本地机制；不代表官方缓存同构。 |
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
| K38 | A + N | Pi省略/压缩投影已静态核对；真实Kiro overflow正文与完整官方恢复链未证。 |
| K39 | N + A | 官方usage快照/累计/credits/价格语义未闭合；本地保护不证明零费用。 |
| K40 | A | 本地验收门禁；历史记录不能替代本轮运行。 |
| K41 | A | Axiom共享scheduler FIFO准入，不属于官方CLI wire契约。 |
| K42 | L局部 + H-P + A | 认证产品说明与本地能力边界；未证明所有分支在同版chat及GovCloud可用。 |
| K43 | H-W/H-S + A | 历史目录schema/分页旁证与本地限额，非同版Mac完整catalog契约。 |
| K44 | N | 官方多messageId/跨事件顺序与响应关联没有直接同版正文证据。 |
| K45 | A | Pi文档建议与宿主重绑路径；跨provider真实续聊仍待验，不要求复制官方多provider系统。 |
| K46 | A + N | transportId→conversationId是本地链；官方服务如何解释辅助操作ID未知。 |
| K47 | A | 本地一次性ticket与Pi多调用存在条件性静态不相容；不依赖官方REA才可识别，也未运行复现。 |
| K48 | A | 本地worker断连/JSONL/reconcile组合验收；非已证数据丢失或官方行为差异。 |

## 历史保留与本轮验证边界

- [原41项清单](kiro-calibration-checklist-41-items.md) SHA256：`aade806d740fc3101f7fdca8fcad149387bc1c1c119bd2d7fd3d8bb52fa2107e`。
- [原文档校对结果](evidence/kiro-calibration/verification-41-items.json) SHA256：`31fc90ad91f3e1d6d8aa96f2d0b971456340bc6625cadbf759b17bd1c1d29628`；历史结果是41项、86链接、42链接文件、35源文件、旧15/15匹配，不能改称本轮重跑。
- 相对这35个历史源文件，本次观察34相同、仅app/package.json因并行工作新增entities依赖而变化；Pi仍1.1.0。更早15文件基线另保持，不把两个基线混成一组。
- 新文档结构、矩阵连续性、链接/行界、源字节观察与历史副本保护由[校对脚本](evidence/kiro-calibration/verify-checklist.py)检查，结果见[verification.json](evidence/kiro-calibration/verification.json)，语义复核见[semantic-review.md](evidence/kiro-calibration/semantic-review.md)。这不是运行接入测试或官方行为验证。
- 本轮不改provider/宿主/其他模型，不运行项目测试、构建、CLI/REA、登录、刷新、目录或模型请求，不读取实际用户配置、凭据、日志或历史。官方完整链仍未闭合；业务修复、离线接线与Axiom实际对话均未执行。

仍不能保证没有遗漏。下一步应优先取得用户故障的脱敏阶段/错误，再按清单修复与离线验证；未经进一步授权，不使用现有登录态，也不自动重试旧REA失败。
