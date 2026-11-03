# Kiro 清单语义复核记录

对象：[校准清单](../../kiro-calibration-checklist.md)。本记录仅描述独立静态阅读和主会话修订，不是测试通过或用户故障已解决。各节按历史阶段保留；最新结论以末节[多轮收敛报告](convergence-review.md)为准，旧15/15、仅package变化、15/14/12/8等不再描述当前观察。

## 上一轮41项审查范围

- 模型注册/选择、代理/池、认证/刷新/ticket/profile、缓存scope：独立审阅者只读核对K01–K15及后续门禁。
- 请求/工具/图/思考、EventStream、stop/EOF、错误、Pi重试/overflow与worker：另一独立审阅者只读核对K16–K40及修复顺序。
- 补充独立审查了旧提交到当前agents/tasks的共享准入更新，新增K41；普通主会话与scheduler任务分别核对，不泛化到所有Kiro对话。
- 三项前置静态审查分别覆盖接线、认证、工具/流。主会话阅读结果后，对关键新结论重新读当前源码，未直接把建议视为事实。
- 审查中未运行项目测试/构建、网络请求、Kiro CLI/REA，未读取真实配置、令牌、登录缓存、用户会话或日志。

## 上一轮已采纳的实质修订

1. **回调错误不是全都非终止**：[callback parse/handler](../../../app/src/server/providers/kiro-callback.ts#L19)先校验origin/path/state；普通格式/state/Host错误不会消耗网络流程，但通过校验的拒绝或Social分支不匹配可终止。K09已区分；手动错误终止问题仍待修。
2. **profile保存与使用校验不同**：[auth](../../../app/src/server/providers/kiro-auth.ts#L57)收通用字符串，[catalog/chat使用前](../../../app/src/server/providers/kiro-catalog.ts#L17)才严格校验ARN及支持区域。refresh缺字段保留旧值，null/空串拒绝；K13已明示。客户端注册过期检查属于refresh元数据路径，不泛化为每次chat必查。
3. **EOF也涉及真实工具执行门禁**：[chat finalization](../../../app/src/server/providers/kiro-chat.ts#L221)在无其他错误且无未结束工具时，允许非空白正文或至少一个已结束工具在完整帧EOF后成功；[Agent测试定义](../../../app/tests/kiro-chat.test.ts#L267)含工具帧EOF执行及坏尾帧不执行对照。K32补充帧完整/调用完整/服务响应完整的区别；官方必需terminal仍未知。
4. **压缩取消前可能已改变投影**：[Pi恢复](../../../app/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js#L2405)先置一次恢复标志、省略attempt再请求压缩；[省略实现](../../../app/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js#L836)以context_edit持久化，原消息仍在。K38补齐取消后投影、重开、标志及后续输入验收；不宣称本轮真实触发。
5. **执行账本不能排在性能优化之后**：K24并入可靠性阶段；mock错误/取消/恢复门禁放在真实工具前。裸Agent测试定义不能替代完整AgentSession→worker恢复验收。
6. **文档漂移不只一处**：[旧parity](../../kiro-cli-parity-audit.md)及[旧推理审计](../../kiro-inference-audit.md#L47)均须后续勘误。本轮只在清单记录，不改既有文档/冻结证据。
7. 审阅者读取时证据目录尚未生成的时序问题，由主会话后续新增本目录并运行文档/文件字节检查解决；认证审阅者已重读确认目录存在及K09/K13文字问题关闭，没有将不存在的材料当已验证。
8. **更新范围扩大后的纠正**：15个旧源hash匹配的结论成立，但不能将最初provider/worker差异范围推广至共享调用前路径。完整范围diff另见agents及任务调度准入改动；K41单列[入池turn](../../../app/src/server/tasks/admission.ts#L8)、[scheduler唯一注入点](../../../app/src/server/tasks/scheduler.ts#L441)及[普通主会话入口](../../../app/src/server/tasks/commands.ts#L292)。FIFO只排序同步入池调用，不持有turn等待lease/整个任务；慢前序阻塞、等待缺少自身期限属于结构性边界，未证已发生故障。补充审阅者已确认K41及更新范围表述；取得lease后快照变化可重排，最终提交复核失败直接拒绝。已有[task-admission单元定义](../../../app/tests/task-admission.test.ts)由主会话静态读取，未执行，不冒充完整宿主验收。

## 验证边界

上一轮41项文档检查保留于[verification-41-items.json](verification-41-items.json)，对应[原41项清单](../../kiro-calibration-checklist-41-items.md)：41项、86链接、42链接文件、35源文件、旧15/15匹配。当前扩展版检查另见[verification.json](verification.json)，检查49项/矩阵连续性、处置状态、文件/行界、历史副本与源字节；两次结果不得混用。源hash不认证官方行为，链接通过不认证语义。

当前仍未知用户运行产物、实际选模/代理、服务权限、错误阶段和真实推理/工具结果。修复和运行验收均未实施，完整官方调用链未闭合。

## 前轮漏项复查（2026-10-27）

对应[前轮漏项报告及48行官方证据矩阵](../../kiro-omission-review-48-items.md)。认证/目录、协议/响应、宿主生命周期、辅助模型调用分别进行了独立只读审阅；压缩票据链另经独立静态复核。主会话没有直接采纳所有候选，而是重读关键当前源码、校正子审行号并核反证。

- **采纳K42–K48七类检查**，不是七个实测bug。K45/K48是相关原项的独立边界展开，K43/K44/K46为待证契约；K42如实保持能力边界。终审又对照auth实现纠正K08及漏项报告中过窄的流程简写：Builder/企业OIDC提供PKCE或device二选一，Social仅PKCE；这是静态分支支持，不代表真实账号各分支已验收。
- **K47有完整的本地静态因果链**：[压缩入口](../../../app/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js#L2144)取一次apiKey，[split两摘要](../../../app/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js#L685)及[重试闭包](../../../app/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js#L477)复用它；真实[agent model-runtime](../../../app/node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js#L447)仍优先显式apiKey，而[Kiro](../../../app/src/server/providers/kiro-chat.ts#L92)首次消费即删。条件是split两段都有内容，或启用且命中分类的可重试错误；不称所有网络/超时都会重试，不泛化virtual跨provider路径。未运行复现，未认定用户根因。
- **K46只确认本地ID复用**：memory实例transportId成为多个逻辑请求sessionId，再被Kiro哈希为conversationId；服务端是否串扰或影响计费未证。完整context逐次传入与服务端ID语义是两件事。
- **细化而不重复计数**：K11刷新取消/持久化原已列，仍为未运行；K12登出后的未消费ticket联合宿主门禁；K13/K15 profile变化/迁移按allowNetwork处理；K35分别核HTTP与流异常body；K39连续完整快照；K41长排队与轮转组合验收。K38真实overflow签名仍缺证。
- **驳回错误推断**：每次run会重配网络；prepareAuth不交旧ticket到worker；执行快照不复制旧auth；请求会重新getAuth。不能从等待时长直接推断失效。Pi同步写JSONL且宿主从磁盘reconcile，不能将IPC断连直接称持久化丢失。“未来共享branch session”不是当前事实。
- **官方证据逐项标界**：[chat局部索引](chat-local-rea-index.json)11函数只用于各自可证部分；同版launcher、旧Windows/SDK、公开说明、第三方策略、本地机制分开。矩阵不是“48项均通过REA”，也不能以11函数或处置分类计算覆盖率。
- **文档漂移补记**：auth说明同样有旧thinking叙述；本次仅记录勘误，不改原auth/parity/inference文档。保留41项历史字节与结果；对旧35源仅app/package.json有并行entities依赖变化，未将其归于本轮Kiro改动。

## 再审调用链边界（2026-10-27）

认证/目录、请求历史、流状态机、辅助宿主分别独立只读复核；辅助入口再核反证。独立审阅只确认各自读到的部分，不将其未闭合项或错误行号照抄成结论。主会话核当前文件后作以下裁定：

- **新增K49（待修/P1）**：[applyOverrides](../../../app/node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js#L389)与[getCacheWarmingMode](../../../app/node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js#L703)读写不同设置层，非task主会话off覆盖不约束实际getter。默认目录缺TTL/零价只能阻断默认模型，不能排除合法promptCache/cost override。完整触发条件、保留guard及修法见[二审报告](../../kiro-omission-review.md)。不认定真实请求、token消耗、扣费或用户根因。
- **票据反证由主会话补闭合**：部分子审先称“预热必保存旧ticket，无HTTP”，后撤回，但又给了错误API/行号；另一子审未定位Agent core调用点。实际代码在[agent-loop.js](../../../app/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js#L270)，并非未定位的bundle；普通SDK构造未设getApiKey/apiKey。[SDK先保存options](../../../app/node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.js#L267)，[runtime](../../../app/node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js#L447)复制后才注入票据，不回写原options。没有有效显式旧ticket时，warmer能重新getAuth，因此此反证不成立。K47显式票据路径仍成立；不将两者混为一个编号。
- **生命周期反证保留**：task的storage wrapper与compression inMemory off有效，不因非task问题称全局禁用都坏。global off/缓存none/缺TTL/决策stop/上下文变化/迟到/期限/退出仍可阻断；streaming settled停止，idle是另一分支。Kiro没有已证安全的一token预热协议，maxTokens只被诊断忽略；warmer不会执行工具。
- **原项细化**：K20/K45补模型副本专项；四API参数化测试不含kiro-chat只代表该定义的范围。K22保留多键fixture但未证仅键序重排误拒绝。K29区分混合LF/CRLF后有正文与纯空白尾，后者finish可闭合；K30/K44补signature/redacted同事件覆盖，官方是否互斥未知。空流/截断同错误属K31/K35，未知事件诊断已归K32。
- **撤回子审推导，不修改正确原结论**：auth只做profile通用字符串校验、使用前才验证ARN；目录offline/network是分开的context，未证旧scope配新credential；ticket为插入序FIFO，不是LRU。已有K13等文字正确，不把二审试探当历史bug。
- **历史与结果分层**：[48项清单](../../kiro-calibration-checklist-48-items.md)、[48项报告](../../kiro-omission-review-48-items.md)与[48项校验结果](verification-48-items.json)新增为字节副本，41项历史不动。改文档前49源/9支持文档无漂移；当前49项、15/14/12/8处置及新增源字节由更新脚本重新观察，不沿用171链接等旧数字。

上述二审只新增/修订清单与证据说明、文档校验脚本及其结果；没有修改provider/宿主/其他模型，也没有项目测试、构建、网络、REA或真实对话。

## 多轮收敛主裁决（2026-10-27）

[收敛报告](convergence-review.md)记录每轮完整三分区与K45交叉检查，不将独立并行审阅计成多轮。候选经主会话对当前源码裁决：R1 K04/K39、R3热切接线、R5小窗口保护为实质进展；R2/R4仅历史零轮。R6与R7全部完成且77源轮末一致，连续两完整零轮满足本次静态停止条件，仍不证明无遗漏或可用。

- K04改待修/P0：有store离线恢复、scope=current但空raw native目录，合法显式模型可在composed中可见；supportsBaseApi却查raw base，进入无kiro-chat注册的compat，可HTTP前失败。无store/未刷新可能先被filter阻挡，不泛化为空缓存一律可达；不放宽scope、固定域或退OpenAI。
- K39改待修/P1：完整主计数可正但cost未算；无完整快照的初始化0可被当known token，unknownCost仍保护金额；全历史无正token、DB初null、正window时worker丢整个usage/context，宿主阈值早退。SDK只汇总已有cost；null占位不是最终计数保护，完整→部分保旧完整快照，不逐字段覆盖。小窗口直接session usage/估算不修该宿主门槛。
- K45/K07：冻结模型原文字节revision与stable modelDigest不是混比；desired持久化、安全点应用、actual/request记录及失败终止须分别验收。网络只在显式安全点允许重绑；小窗口取session context或估算，加queued和有界reserve，不足保原文拒绝，无截断/切换专用压缩；同选择no-op可复用，真正切换不回旧profile池。非Kiro测试定义未执行，不能当native Kiro往返已验。
- K47仍为条件性显式旧ticket问题：compression是createAgentSession→session.compact，split或匹配的SDK retry可复用票据，不能以Axiom外层无retry否定。每个物理请求新opaque ticket，不延长为重复有效。K49 merged off/global getter不一致独立存在；task/compression off有效，默认及合法override的多重guard均保留，runtime注auth到新options不回写warmer旧对象，不能称必拿旧ticket或必发请求。
- 已驳回/撤回：SDK自动按价格补cost、所有计数永远0、raw/composed混淆、空scope一律阻止K04、sticky失败/IPC终止当新bug、压缩无SDK retry、完整防御/全测试已覆盖、11函数折49项覆盖率。主会话只使用准确来源；子审错误行号与过强运行词不照抄。
- R5轮末字节比较exit1曾被误标Completed，已撤回并补核为有进展；R6任务仍带旧测试SHA792a…，当前1a95d933…与R6基线一致，trim()发生于基线之前，不是新漂移。77源观察未冒称全程冻结；旧15/35/49/59源当前匹配分别14/31/46/56，三处并行修改不是本会话修复。
- 原41/48五文件及新增49三副本保原字节；当前49项、13/16/12/8处置不改写历史。最终文档脚本仅验证结构、链接、hash及范围，轮次与语义是人工裁决，不由0失败推出。

本轮仍仅改审查文档/文档校验脚本与结果，没有业务源码修改、项目测试、构建、CLI/REA、网络或真实对话；不读真实配置、凭据、秘密日志和会话。用户根因与官方完整链未知。下一阶段为分别授权的修复、离线mock和Axiom隔离实对话，不因静态结案提前执行。
