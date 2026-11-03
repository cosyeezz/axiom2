# Agent Runtime 全面统计独立最终静态审阅

## 结论

**本次限定检查范围内未发现需要阻断研究交付的新增事实冲突。** 151项、14域、五主责和状态分布可从当前JSON独立重算，主报告明确其为手工归一化审计粒度，不能解读为SDK方法、已上线数量、完成率或行为覆盖率。五边界及接口族在职责层面可以容纳14域；这不是全部DTO已经定义、每项保证已经证明或替换可实施的认证。

先前审计的phase和observer两项阻断在当前文档中保持关闭；软/强stop的现状与提案也分开了。建议交付时保留有限静态检查声明，并将下列措辞和可追踪性建议列为非阻断待办。

## 1. 范围、方法与执行记录

工作目录：`/Volumes/D_Work/axiom2`。完整阅读以下指定材料：

- [主报告](/Volumes/D_Work/axiom2/docs/agent-runtime-capability-inventory.md)
- [接口契约](/Volumes/D_Work/axiom2/docs/agent-runtime-adapter-contract.md)
- [矩阵JSON](/Volumes/D_Work/axiom2/docs/evidence/agent-runtime-capabilities/capability-matrix.json)
- [首次矩阵审阅](/Volumes/D_Work/axiom2/docs/evidence/agent-runtime-capabilities/audits/matrix-review.md)
- [修订复核](/Volumes/D_Work/axiom2/docs/evidence/agent-runtime-capabilities/audits/matrix-recheck.md)

另阅读工作约束要求的Pi开发技能说明；未执行SDK定位脚本或打开额外SDK资料，因为本轮不做SDK能力发现或新增实现结论。未重新做已通过的14域live源码抽查，未重复15个非live源码审计，也没有新增源码核验。先前源码证据的结论仅作为已交付审计证据引用，不能称本轮重新独立证明了源码行为。

唯一分析命令为`python3 - <<'PY' … PY`（标准库json/collections/pathlib）：读取指定JSON、展平domains/rows、重算ID及各维计数，打印指定两篇文档的关键措辞及行号；**实际退出码0**。命令未加载项目模块，非测试程序。随后以Python标准库写本报告，写入命令退出码见调用结果。没有运行产品、模型、fixture、测试、编译、构建、网络、安装或DSH；没有修改仓库文件。没有为本轮另存详细命令日志，关键输出已记录如下。

## 2. 统计口径与算术

独立重算结果：

| 维度 | 结果 |
| --- | --- |
| 域 / 行 / 唯一ID | 14 / 151 / 151 |
| 各域 | E10、S8、I11、V10、T10、R12、C8、A12、B11、P14、M17、U10、J10、H8 |
| 状态 | live136、partial8、helper1、gap2、new4 |
| 主责 | host57、runtime40、resources14、archive23、model17 |

与主报告§2、§2.1、§2.2逐一一致。JSON首部`countingUnit`明确“归一化行为能力及独立故障边界”，每项一个主责而非所有协作者。主报告第65行尤其直接排除了“151个SDK方法、151个待实现接口、151项已上线功能”；第95行解释live只依主行为接线，不把semantics中的迁移约束当既成保证。M15为partial的路由包装不被宣称成延期工作流上线；A12为helper、V09/V10为gap保持清晰。

**本轮未重算**600文件、64,445行、94直接依赖文件、100符号、153闭包、163涉及源码及源码manifest。它们有主报告§1的明确单位/范围/快照限制，但不能把这次计数核对宣传为依赖扫描或SHA复核。第57–61行明确脏工作树、HEAD非全部被审计内容、非原子快照，避免当前性过度承诺。

## 3. 五边界与14域的容纳关系

| 域 | 对应边界/接口族（概念覆盖，不是SDK逐项实现） |
| --- | --- |
| E | 宿主ExecutionHost/Registry；Runtime环境计划；Resource身份 |
| S | RuntimeBinding/Run；宿主runtime固定及准入 |
| I | 核心submit、InputQueue；宿主input ledger；Archive保存证据 |
| V | RuntimeEvent/EventSink/Interaction；宿主事件可靠性；资源展示扩展 |
| T | ToolDescriptor/Invocation/Result；宿主ToolGateway/权限；Resource包装 |
| R | ResourceCatalog/InstructionComposer/Lifecycle；宿主资源授权/安装 |
| C | Configuration/Interruption；宿主reload作业；Model网络适配 |
| A | ArchiveReader；宿主显示/overlay/缓存服务 |
| B | NativeBranch/Recovery；宿主准入、事务和服务恢复 |
| P | NativeContext；宿主CompressionService；Model请求选项 |
| M | ModelGateway/CredentialBridge；宿主Auth/Network/Quota/配置发布 |
| U | Model观测；Archive usage codec/context meter；宿主Ledger/查询 |
| J | 宿主Tasks/Memory/Title；独立ModelGateway推理与Archive元数据 |
| H | 宿主API授权、目录、wire、视图、文件和UI能力门禁 |

主报告§3.2是“主要审计ID”索引而非每行完整展开，且明确不是冻结SDK。因此未把P01/P14压缩调度、B10/B11服务恢复、U09费用查询等宿主端口逐名列成接口族，不构成遗漏职责或需要下放底层的理由。它们在矩阵已有`compression-service`、`recovery-service`、`usage-query-service`等目标端口。**建议**后续加“全部ID→接口族/宿主服务”交叉索引，尤其把CompressionService、RecoveryService、UsageQueryService、ContextMeter显式列出，避免以HostApplicationServices大兜底误读为接口已完整定义。无需本轮为凑SDK数量添加接口或改151。

## 4. 跨文档语义一致性

### 4.1 phase与observer

- JSON V02、H04、B01均承认`stop → final_answer`宿主兼容推断；主报告§3.3/§4.1、契约§6.1第7条要求新DTO区分native、host-inferred、unknown。没有再将未来“不伪造原生phase”原则说成当前无推断的事实。
- JSON U05为partial，仅provider级start/end及http/call精度，明确缺完整选择/路由/终结原因；主报告§4.5四条链同样收窄。V06的实际选择证据不能自动补成U05观察器已有字段。契约request.state的完整DTO是提案，不是当前observer能力。
- 两点的源码反证/关闭证据分别见首次审计A1/A2及修订复核1/2；本轮没有重读transcript或provider observer源码。

### 4.2 stop、保存与结果交付

- JSON S04和主报告第95行把live限于当前retire worker/process tree；软中断不能由abort或reload暂停推定。
- 契约核心stop是宿主必需停稳语义，可通过关闭独占会话/回收树实现；`interruption.v1`是另行证明的可选可继续性，不降低现有Pi用户stop强度。契约§5明确保留现状。
- S07的partial、主报告§4.3及契约§3一致：message_end、完整磁盘记录、fsync、事件drain、宿主交付各不同。强杀不等于flush成功；无句柄不免除初始化失败清理；late usage走原身份对账，不激活新run。

### 4.3 归档、上下文与账本

- A02严格只读reader与原生写端口分离；A03/A04保留活动branch/context_edit，不能用全树正文或通用messages替代有效上下文。
- H02的SQLite archived/deletedAt是宿主业务目录，不是原生档删除或runtime.resume。UI分段/preview/overlay不是原生权威正文；A12 helper没有生产接线/性能承诺。
- P02/P10/P13把单写者、旧摘要冲突和原生70%安全网区分于Axiom异步压缩；U03占用、U04压缩账费与U08/U09宿主账本/查询不混同。
- U01主责archive、端口名usage-ledger仅表示原生usage/选择codec协作，不意味着账本事实源迁入adapter；U02/U07–U10及契约第335行仍把价格、修订、去重和唯一账本留宿主。有限drain不能保证强杀后的远端费用恢复。

### 4.4 不可迁走的宿主权威与DSH

契约§2/§8（第363行）和主报告§3/§6一致：workspace授权、唯一执行池、lease/permit、Tasks调度及精确taskId/resultId先存后通知、Memory业务、Title作业、账本及UI门禁均归宿主。资源/凭据codec可适配，授权决定和配置发布不因此下放。ModelGateway与AgentRuntime分层；runtime原生agent loop接模型网关还需可信桥，不是两个接口存在就自动接通。

主报告第249行、契约开头/§9均明确没有新增DSH运行证据，SDK/ACP有限能力不能推成直接替换或主聊天准入。本轮同样没有产生任何DSH证明。

## 5. 非阻断建议及未完成项

1. **优先澄清“一个压缩控制者”**：契约第406行“每种原生上下文只有一个压缩控制者”字面可能与P13/主报告原生70%安全网＋Axiom异步压缩并存产生张力。按全文单写者/冲突规则可作一致理解，但建议写成“每个原生上下文提交只有一个获授权写者/协调器，多个触发策略必须串行并校验冲突”，不要误删安全网或禁止既存双策略。
2. **授权措辞**：契约第332行“ModelGateway负责选择与凭据授权接口”应理解为消费宿主授权引用、解析原生凭据，不是拥有授权政策。建议直接写明宿主授权/发布与gateway解析/适配的区别，避免脱离§2阅读的误解。
3. **快照措辞**：契约第7行“当前工作树HEAD”建议复用主报告“脏工作树/非原子快照”的提醒或直接交叉引用，不能暗示HEAD精确覆盖所有审计字节。
4. DTO判别联合、可靠事件、Interaction、Archive写端口、ModelGateway中性作业及跨adapter费用修订仍是待设计/待证明；全部不是本轮已实现。

这些是研究文档清晰度与后续追踪建议，不是本轮新增代码事实阻断。本轮有限静态检查不证明所有151项语义、故障路径、安全隔离、并发、性能、取消及时性、fsync、模型/provider/DSH兼容或任何产品测试通过。
