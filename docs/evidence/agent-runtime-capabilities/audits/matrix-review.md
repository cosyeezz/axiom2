# Agent runtime 能力矩阵只读复核

## 结论

151项/14域的**静态归一化清单计数成立**，状态分布为 live 136、partial 8、helper 1、gap 2、new 4；ID均唯一，所有 sources 指向的文件存在，能力标题无逐字重复。它不是SDK方法计数、可替换完成率或测试通过率。

矩阵对 deferred、交互UI、canonical 未接线和账务不完整的总体态度诚实。**但目前不能不加修订地把它作为“现有语义均已代码证实”的基线**：发现1项直接源码反证、1项观测字段夸大，以及若干应明确的归一化/边界缺口。以下“阻断”仅指文档事实定稿，不建议本轮改业务或执行模型。

本次只读矩阵、现有契约及相关源码；没有运行测试/应用/模型、安装或网络，没有修改仓库。Python仅作JSON计数/来源文件存在性核验及写本/tmp报告，相关命令退出码0；这些不是产品测试。

## A. 阻断及优先修正

### A1（高）：V02、H04把未来“不伪造phase”原则写成了现状

[transcript.ts](/Volumes/D_Work/axiom2/app/src/server/transcript.ts) `displayPhase`（20–36行）先检查响应API流式提示和textSignature，但最后明确执行：

```ts
return !streaming && message.stopReason === "stop" ? "final_answer" : undefined;
```

即没有原生phase/signature的非流式成功助手消息也得到 `final_answer`。流式Responses的 `stop` 提示亦有推断路径。`chatMessage`把该值放入显示DTO；[thread-layout.ts](/Volumes/D_Work/axiom2/app/src/shared/thread-layout.ts):5–8 的 `threadDelivery`据其判定显示交付；[transcript.ts](/Volumes/D_Work/axiom2/app/src/server/transcript.ts):272–279 的 `transcriptForkPoint`也据它接受助手分支点。

这与V02“没有phase…不伪造final_answer”、H04“缺原生phase不可瞎造”直接不一致。不是说现有显示归一化必然是bug，而是**显示推断不是原生事实**。建议保持现有行为，仅改统计说明：现有Pi显示有stop→final的兼容推断；新中性事件应区分 native phase、host inferred delivery 和unknown。V02可保留live（文字/思考链路存在），但不能让整项语义隐含所有保证都已实现；若坚持该项包含严格原生phase保证，应拆分/降partial。H04和B01的“final”也应说明是显示规则，不是SDK确证交付。

### A2（中）：U05的“报告选择、路由和terminal”超过列举来源的实际字段

[provider-requests.ts](/Volumes/D_Work/axiom2/app/src/shared/provider-requests.ts):1–5只有 start(id/provider/precision) 和 end(id)。[provider-request-observer.ts](/Volumes/D_Work/axiom2/app/src/server/provider-request-observer.ts):39–101只发这些计数事件；不报告logical selection/model、实际model/endpoint或成功/失败/cancel终结原因。`finish`还可因不支持的result override而结束观测。[provider-request-statistics.ts](/Volumes/D_Work/axiom2/app/src/server/provider-request-statistics.ts):5–50是服务期current/peak/rpm计数，非完整请求记录。

partial状态正确，但语义应收窄为“provider级开始/结束与http/call精度计数；结束不代表上游终结事实”。完整选择/路由证据另属V06/request-selection，不能凭相邻能力存在就把字段算入U05。

## B. 所有15项非live逐项复核

| ID/状态 | 相关源码位置、判断及保留限制 |
|---|---|
| E10 new | [capabilities.ts](/Volumes/D_Work/axiom2/app/src/server/capabilities.ts):1–120只处理skills/MCP、偏好/catalog/session revision；没有runtime/contract注册。相关server源码搜索 `RuntimeRegistry/AgentRuntimeAdapter/runtimeId/UNSUPPORTED_CAPABILITY`未命中。new准确；来源是当前缺口的对照，并非实现证据。 |
| S07 partial | [persisted-inputs.ts](/Volumes/D_Work/axiom2/app/src/server/agents/persisted-inputs.ts):3–76只确认完整换行记录和身份/offset/anchor，失败不推进；[compression-context.ts](/Volumes/D_Work/axiom2/app/src/server/compression-context.ts):95是序列化字节行存在性检查。worker `delivered()`在done前，但shutdown是abort→扩展shutdown→dispose→closed，不是fsync/全事件drain屏障。partial诚实；新契约durability确认必须定义具体证据等级。 |
| S08 new | [storage.ts](/Volumes/D_Work/axiom2/app/src/server/storage.ts):69现有agent_sessions存selection/file/environment/usage，没有runtime身份字段。源码仍固定Pi，尚无缺adapter→unavailable服务。new准确；旧Pi显式映射是迁移设计，不应读成现状。 |
| V07 new | [execution-protocol.ts](/Volumes/D_Work/axiom2/app/src/server/execution-protocol.ts):15–17捕获lease/run的sender，没有binding seq/eventId/finalEventSeq/drain确认；[outgoing.ts](/Volumes/D_Work/axiom2/app/src/server/outgoing.ts)是另外的WS队列。新绑定可靠事件语义确实未有。 |
| V09 gap | [agent-worker.ts](/Volumes/D_Work/axiom2/app/src/server/agent-worker.ts):928–935 bindExtensions只有mode rpc/onError；[compression-worker.ts](/Volumes/D_Work/axiom2/app/src/server/compression-worker.ts):116也只有rpc。未提供uiContext、interactionId响应/取消端口，gap准确。没有在本次审计中执行或逐实现验证Pi缺省confirm返回false等细节；“不能把默认false当用户拒绝”应作为防误用要求，而非已验证实际交互结果。 |
| V10 gap | 同一绑定不提供Web展示uiContext/终端组件桥，gap合理。应把它限定为终端presentation移植缺口，避免与V09审批往返混为同一个能力；theme/editor/widget各自不强制同构。 |
| A12 helper | 全app/src搜索七个canonical模块引用，仅返回它们之间的内部import，未见worker/views/transcript生产入口；[canonical-publisher-bridge.ts](/Volumes/D_Work/axiom2/app/src/server/canonical-publisher-bridge.ts):45–49明确“Metadata links are not owned body/source authority”。helper准确，不能称canonical事实源或生产增量性能优化完成；搜索不排除未扫描的构建生成/动态加载。 |
| M15 partial | [model-copies.ts](/Volumes/D_Work/axiom2/app/src/server/model-copies.ts):85–91确实包装streamDeferred/cancelDeferred并映射上游model；[model-runtime.ts](/Volumes/D_Work/axiom2/app/src/server/model-runtime.ts):165–166把observer/copies接入创建链路。但全server搜索deferred只见此包装，没有宿主延期作业流程；observer:103–115只包装stream/streamSimple。partial诚实（活跃构造中的能力包装，不是工作流已上线）。如采用更严格“必须有实际调用者”状态标准，可改helper；必须明确两者统计口径。 |
| M16 partial | [kiro-chat.ts](/Volumes/D_Work/axiom2/app/src/server/providers/kiro-chat.ts):245–253显式写local-eof-policy、terminalContract unverified，再推断stop/toolUse；[qoder-sse.ts](/Volumes/D_Work/axiom2/app/src/server/providers/qoder-sse.ts):183–197在finish+finalUsage后默认1000ms idle窗口触发terminal。partial准确，不能把本地容错政策当上游终结保证或已实测。 |
| U04 partial | [native-compaction-usage.ts](/Volumes/D_Work/axiom2/app/src/server/native-compaction-usage.ts):31–35明示branch summaries、SDK transport内部retry不在覆盖内且非crash-atomic；18–28逐调用定价，40–58记录未合并/归属不明请求。[compression-worker.ts](/Volumes/D_Work/axiom2/app/src/server/compression-worker.ts):124–153在请求前unknown占位，result后更新，finally等待accounting。partial诚实。 |
| U05 partial | 状态正确，描述字段夸大；详见A2。仍需保留仅服务期、观测精度有限和原生内部retry不全可见的限制。 |
| U07 partial | [memory-worker.ts](/Volumes/D_Work/axiom2/app/src/server/memory-worker.ts):72–89同usageId先null后实测，先报usage再检查abort；[memory-runner.ts](/Volumes/D_Work/axiom2/app/src/server/memory-runner.ts):115–130先sameLease检查，再usage upsert，之后才检查signal.aborted。原lease取消后仍可接收清理前usage成立；进程close/settled清listener后不再接收，不支持任意晚到/强杀后的远端对账。partial准确；不要扩为跨adapter通用修订API已实现。 |
| U10 partial | [shared/costs.ts](/Volumes/D_Work/axiom2/app/src/shared/costs.ts):14–29区分unknown和估价，但records明确不是物理请求数；[costs.ts](/Volumes/D_Work/axiom2/app/src/server/costs.ts):85–140扫描原生entry/usage及后台job，缺档计unknown并告警。尚无统一request/activity/aggregate、confirmed/source revision完整协议，partial准确，矩阵“需明确”是设计要求。 |
| H06 partial | [outgoing.ts](/Volumes/D_Work/axiom2/app/src/server/outgoing.ts):17–18明示B+一个合法大帧而非RSS限额；99–119的AbortSignal取消只控制等待准入的reader。[index.ts](/Volumes/D_Work/axiom2/app/src/server/index.ts):453、473–475有read取消/准入，不同服务各自传signal；同步JSON/历史解析无法被中途打断。partial准确；adapter emit Promise背压仍属V07新增设计。 |
| H08 new | 现有Capabilities是资源选择目录，shared transport不是runtime支持注册证明；源码未见中性UNSUPPORTED_CAPABILITY/registry实现。new准确，不应把已有资源失效错误与跨runtime能力门禁等同。 |

## C. 每域至少一个live源码抽查（14/14）

这里的live仅意味着现有链路源码可见；表内不是全项保证/执行验证。

| 域/抽查项 | 代码证据与结论 |
|---|---|
| E/E02 | [execution-protocol.ts](/Volumes/D_Work/axiom2/app/src/server/execution-protocol.ts):1–17 lease三元组及入口sender捕获原run。身份分层成立。E03还可见:33–49等待同lease执行许可。 |
| S/S05 | [agent-worker.ts](/Volumes/D_Work/axiom2/app/src/server/agent-worker.ts):314–321 abort→扩展shutdown→dispose→closed，:1346–1388先inputQueue/waitForIdle再done，最后idle或shutdown。现有链路成立，不证明全错误路径清理都成功。 |
| I/I06,I07 | [native-queue.ts](/Volumes/D_Work/axiom2/app/src/server/agents/native-queue.ts):7–16集中读私有queue布局，漂移throw；:38–59同步清/重建且保留非目标消息。live合理，依赖固定Pi布局。 |
| V/V08 | [agent-worker.ts](/Volumes/D_Work/axiom2/app/src/server/agent-worker.ts):928–935扩展异常只发固定warning。live合理，不意味着notify/问答UI可用。V02有A1反证需改文案。 |
| T/T07,T08 | [agent-worker.ts](/Volumes/D_Work/axiom2/app/src/server/agent-worker.ts):82子工具allowlist含shell；:770–798禁包解析/外扩展/模板；:821–825 tool_call阶段/allowlist复验；:1336 summary工具集清空。live合理，明确不是只读OS沙箱。 |
| R/R05 | [session-environment.ts](/Volumes/D_Work/axiom2/app/src/server/session-environment.ts):48–105 preview无session，packages清空、noExtensions，工具调用函数直接throw，返回source preview和未连接声明。live合理；loader.reload是本地资源发现，不等于runtime reload。 |
| C/C01 | [session-safe-point.ts](/Volumes/D_Work/axiom2/app/src/server/session-safe-point.ts):14–17八种操作，:32–89按原生phase授权；:104–137集中prompt/continue/prepareNextTurnWithContext/finishTurn四hook。live合理，不是持久锁。 |
| A/A02,A03 | [transcript.ts](/Volumes/D_Work/axiom2/app/src/server/transcript.ts):215–233 readonly走parse+inMemory并复核物理身份；:241–265只投影当前branch，原文模式移除compaction仍用原生projection。live合理。 |
| B/B02,B03 | [session-fork.ts](/Volumes/D_Work/axiom2/app/src/server/session-fork.ts):25–44权限/忙碌检查后独立manager分支；:50–54持久空分支；:70–80提交后通知失败不删新档，失败前补偿。live合理，跨DB/JSONL非原子已明示。 |
| P/P05 | [compression-worker.ts](/Volumes/D_Work/axiom2/app/src/server/compression-worker.ts):77–114 scratch loader禁外扩展/技能/模板/上下文，noTools all，仅宿主压缩hook；:121先执行许可再compact。live合理，不是独立Agent业务循环。 |
| M/M11,M12 | [memory-worker.ts](/Volumes/D_Work/axiom2/app/src/server/memory-worker.ts):69–104执行许可后completeSimple，全新完整context、无工具且拒toolCall；[memory-runner.ts](/Volumes/D_Work/axiom2/app/src/server/memory-runner.ts):78–91排队计deadline，:147–153 cleaned后才release。独立推理边界成立。 |
| U/U08 | [costs.ts](/Volumes/D_Work/axiom2/app/src/server/costs.ts):54–65子报告不包含父兄弟；:85–140依原生Pi entry/usage和宿主后台表汇总。live成立，仍需native codec，不能按“无import”推断解耦。 |
| J/J09 | [session-titles.ts](/Volumes/D_Work/axiom2/app/src/server/session-titles.ts):20声明只改metadata；:102重新查授权/owner，:156–160调用memories.runner独立title请求，不追加主agent历史。live合理；真正池共享见agents.ts:215把this.pool/profiles传入ColdMemoryRunner。 |
| H/H01 | [storage.ts](/Volumes/D_Work/axiom2/app/src/server/storage.ts):465–490同步事务同时存mutation和request receipt，同request不同参数拒绝；:430–461外部作业区分committed/uncertain，写回执失败提示勿重发；[index.ts](/Volumes/D_Work/axiom2/app/src/server/index.ts):691–692 request.get。live合理，scope授权事实仍属于宿主而非adapter。 |

## D. 层次、重复与明显缺项

1. **模型边界不能收进AgentRuntime。** M01/M11/M14和标题/记忆现有路径足以证明完整AgentSession不是独立推理必要条件。ModelGateway是目标边界名，不是现有自有接口已经存在：model-runtime/memory-worker仍直接依赖Pi ModelRuntime/pi-ai。契约3节给了AgentRuntime核心类型，却未同等定义InferenceJob、credential授权引用、deferred句柄/取消/修订、usage修订的中性类型。作为下一步设计待办，不应在统计中记“已封装”。
2. **授权与账本必须保留宿主。** R01/E05中的资源解析/身份适配不能迁走workspace授权；M05负责原生凭据格式转换但读凭据的授权属于宿主；M06宿主OAuth owner socket流程也不是V09的agent interaction。U01虽port名usage-ledger，主责archive应严格指原生usage解码，不是把费用事实源移入adapter；U08/U09/价格/去重仍留宿主。C04执行请求的网络安全点与M07宿主账户查询/隔离worker属于不同故障面，不能仅按同一文件合并。
3. **规范归一化存在合理交叉，不应算独立成果。** I05/I10/S07分别是输入状态、文件游标、关闭保存证据；V05/A09是runtime context事件与宿主overlay释放；P11/S07是压缩幂等证据与一般关闭保存；V07/H05/H06是adapter事件、wire重连、读取背压；U04/P09/U10是账务覆盖、请求参数和账务完整性。可以保留独立条目，但主报告应声明交叉故障面，不把它们重复累加成SDK覆盖率。
4. **建议明确列出的缺口：软中断。** 契约声明`interruption.v1`，但矩阵S04只用live表示当前用户stop退役worker，末尾“软中断另行协商”没有独立状态。现有abort/reload暂停不证明通用可恢复软中断（队列/工具/会话保留及停止水位）。若追求对契约扩展的全面统计，应独立标gap/new，或S04明列子能力状态；不要把live整体解释为该端口已具备。
5. **其他设计保证也不可由live推导。** RuntimeRegistry/版本协商、nativeRef存储域注册、binding级可靠事件、可信interaction应答、ModelGateway中性作业类型和跨adapter usage修订均还只是契约要求。矩阵new/gap大部分已覆盖，新增细目不必追求维持151；若不增项，可加明确子能力/关联索引。
6. live定义目前有意很弱（有链路而未执行），但partial定义“观测或保证有限”与大量live条目的受限保证重叠。推荐主报告解释：状态按**主行为是否接线及已知专门缺口**分类；每项semantics中“应/需/不能”可能是迁移要求，不是现有保证。尤其M15包装接线 vs无人调用，必须给出一致口径。没有发现逐字重复或明显同主责完全重复项；本轮不声称已穷尽SDK所有能力（音频/embedding/全部扩展UI等非已接入行为不应硬凑计数）。

## E. 未验证边界

- 没有执行产品或fixture测试、编译、模型/DSH/Pi交互、授权安全攻防、并发/进程树清理、fsync/崩溃恢复或性能/RSS测量。不得报告这些已通过。
- 本次对151条做分类/语义阅读，对全部15个非live复核相关源码，对每域至少一项live取代码证据；不是对136个live逐条完整调用图与全部异常分支的形式化证明。
- 未运行已安装Pi SDK，未按其所有默认UI实现证明confirm缺省值；未证明候选DSH能力或其版本兼容；本报告主要检验Axiom现有接线和文档诚实性。
- 来源文件存在性不代表源码manifest全覆盖；canonical“未接线”是当前app/src静态引用搜索结果，不排除动态加载或未来构建生成。没有把测试文件存在等同生产能力。

建议主代理先修A1/A2事实措辞，在主报告加入D节分层与状态读法，再定稿；本轮不需要改变业务行为或执行模型。
