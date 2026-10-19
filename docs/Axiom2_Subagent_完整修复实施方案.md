# Axiom2 Subagent 完整修复实施方案

本文记录 F1–F6 的当前实现、有效约束与验收证据。业务代码位于 `app/`；`ui/` 保持用户设计源。工作区存在其他并行修改，本次以冻结副本验证，基线是实施前业务文件覆盖快照，不能解释为 Git HEAD 或整个仓库的原子快照。

## 1. 当前交付状态

下表通过结论绑定已记录的冻结版本和各次运行的源码摘要。最终核查发现，当前工作区较该记录新增26项、改变114项、删除2项，涉及执行池、Agents、Worker、Scheduler及前端；冻结438项无漂移。当前整合版本正在做影响审查，旧工作区UI/构建结果不能直接作为最新版本通过证明。详见 `final-delivery-verification.json`，本次一致性门禁退出1，保留原记录。

| 项目 | 当前实现与状态 |
| --- | --- |
| F1 输入事实 | 已修复并验证：区分明确失败与 unknown；回执校验 task/run/input；迟到接受清理失败标记；撤回凭 Worker 实际 ID；重启对账不重放。 |
| F2 预算与恢复 | 已修复并验证：保留受理后预算不回退；图片准备先于恢复工具；实际提交成功才恢复；全部明确拒绝只失败收束一次并保存已有成果。 |
| F3 最终准入 | 已修复并验证：最后不跨 await 的准入点重查容量及 FIFO；不足时延后，不产生失败伪 run/result。 |
| F4 全局锁 | 已优化并验证：同会话命令串行；配置锁内捕获快照、校验并登记 pending，锁外等待 ACK/旧进程；停止、关闭与供应商变更可识别 pending。 |
| F5 职责边界 | 已验证：工具调用硬限制、扩展禁用及安装哨兵、跨复用/淘汰/恢复权限一致。允许平台 Shell 可修改合成源码；不提供 OS 只读沙箱。 |
| F6 展示与性能 | 冻结版本的队列去重、scope合并、固定SQL、生产惰性订阅及后台浏览器交互已验证；正式ABBA八份数据与清理核查完成。已记录版本的构建、13项编译Worker及设置UI通过。准入退化已复现，根因未确认；最新执行池整合版本待复验。 |

没有提交或发布，没有操作用户数据库、调用真实模型供应商或升级依赖。AOCI 工具在本会话不可用，未生成正式认知维护收据。

## 2. 外部契约与不变量

保留 `Tasks → TaskCommands / TaskScheduler / TaskRecords / TaskDelivery → Agents / AgentRuns → pi Worker`。四个独立工具仍为 `delegate`、`append`、`cancel_task`、`read_result`；不引入第二套调度器或自动重放。追加使用 steer；历史 followUp 仍可读；resume/rewrite 保持控制输入语义。同一子任务沿用子会话与绑定 JSONL，每次执行有独立 runId，结果按不可变 resultId 读取。

| 编号 | 约束 |
| --- | --- |
| I01 | 同一子会话只有一个执行归属；旧 run 回执、定时器及延迟发布不影响新 run。 |
| I02 | IPC 背压不等于未发送；异常不等于肯定未送达。 |
| I03 | accepted 是接收证据，delivered 是可靠落盘证据；均不等于模型完成处理。 |
| I04 | 草稿撤回必须有未交接证明或 Worker 实际返回 ID，保留顺序及附件。 |
| I05 | delivered 不降级；迟到接受不覆盖取消；同 run 的可靠消费证据可以修正旧回执，不抹掉停止事实。 |
| I06 | 服务端通过校验并持久化时刷新预算；受理前拒绝不刷新，后续发送失败不倒拨时钟、不重发。 |
| I07 | 总结恢复要求真实成功提交；准备 Promise 完成或为撤回而发出的接受事件不是恢复依据。 |
| I08 | 最终准入检查最新容量；降低并发不强停已准入任务，等待容量不生成失败报告。 |
| I09 | 全局配置锁不等待慢 ACK/旧进程；释放前同步登记可被停止和撤权识别的 pending。 |
| I10 | 缓存和合并只优化展示；访问前仍校验工作区、会话及任务归属。 |
| I11 | 投递与已读分开；无正文订阅仍保留置顶、费用、活动与未读副作用。 |
| I12 | discarded 结果不能被迟到通知重新激活；已有报告仍按原权限读取。 |

父会话整体停止冻结自动通知；对子会话明确追加不解冻父会话。停止不请求模型额外总结、不回滚文件。工作到期进入同一业务运行内的无工具总结，最多 180000ms。数据结构继续使用现有回执表；不回填用户历史、不重写 JSONL、不改变费用口径。

## 3. 实现与文件范围

### F1：输入与撤回

`shared/tasks.ts` 增加输入回执 unknown，不增加 TaskStatus。`tasks/records.ts` 的 receipt 绑定 task/run/input，保护消费与取消终态。`tasks/scheduler.ts` 分开 handed、failedInputs 与未知事实；uncertain 保留交接及草稿，实际接受清理失败标记。unknown/inflight 撤回调用 `recallIds()`，仅恢复确认 ID。`tasks/delivery.ts` 使用可靠会话记录对账，重启不自动启动模型。

`agents/native-queue.ts` 提供只读留存核查，Worker 在 SDK 抛错后检查 native queue、内存与记录：无留存才明确 failed，留存检查本身失败为 unknown。客户端 `chat/reconcile-inputs.ts` 保留未确认事实，不把未知输入自动恢复成可重发草稿。

| 证据 | 回执与行为 |
| --- | --- |
| 已持久入队、未交接 | queued；可以按本地证明撤回。 |
| 明确未发送或 SDK 明确无留存 | failed；可恢复原草稿一次。 |
| 传输或留存证据不确定 | unknown；保留身份，不自动重发。 |
| Worker 实际接受 | accepted；清理旧失败标记。 |
| 同 task/run/input 的可靠消费证据 | delivered；清理队列、草稿与辅助集合。 |
| Worker 实际撤回 ID | cancelled；只恢复该 ID 的草稿及附件。 |

### F2：阶段恢复

`agent-worker.ts` 先完成图片准备，再变更工具与总结阶段。`resumeSubmission` 保存本次恢复的 transition/accepted/uncertain/ready/confirm 事实；等待最新 inputQueue 尾部，防止旧 Promise 或旧阶段误确认。多个输入中有真实成功项才继续工作；只有未知项时等待后续证据、截止或停止；全部明确拒绝以 `TASK_RESUME_FAILED` 收束一次。

`BUDGET_SUMMARY` 记录实际总结事实，结果中的 budgetSummary 不能仅从 summaryDeadlineAt 反推。正常总结、恢复失败、取消及强杀分别保留正确状态与 partial/final 元数据。强杀时尚未落盘的流式尾部不承诺保存；已持久部分成果保留，不能被称为完整产出，也不能由旧缓存复活。

### F3/F4：容量与命令串行

`TaskScheduler` 在最终 beforeStart 重查 active 与更早 FIFO launching；容量不足保持 queued。父会话整体停止导致的旧任务取消、删除、撤回及准备失败均使旧准入意图失效；父 frozen 本身不禁止显式追加子任务。

`Agents.serialCommand()` 按会话串行 prompt/resume/model，使用持久请求身份与入队前捕获的 stop epoch；锁内外多次复核。`AgentRuns.launch()` 在首次 await 前登记 pending。锁内返回 `{ completion }`，避免裸 Promise 被串行器继续等待；ACK 与退休进程交接在锁外。相同会话仍不重叠执行，配置 revision 变化拒绝混合快照。

执行池整合保护：Agent 强杀先通过池同步退役并撤销复用资格，再终止进程；迟到 idle 不能把旧物理进程交给后续 run。归池 stat 或异步 release 失败仍兑现业务退出与已持久终态的唯一通知；物理 close 的快照清理异常不阻断后续监听，未删文件在下次启动重试。执行环境提交前的准备异常记明确失败，提交后不确定回执不被清理异常覆盖。stop／供应商撤销等待 pending start 收尾；配置队列只允许取消尚未进入的回调，已进入准备仍等待完成，避免撤权 writer 与同锁排队准备互等。

这些整合修正的定向回归已补入 startup-delivery、prompt-preparation、worker-pool、execution-profile、subagent-regressions：覆盖强杀到 close 之间的迟到事件、同步及异步归池异常、快照删除失败、真实池容量等待中的4→1→4／取消／父停止／撤回，以及停止等待与配置锁取消。两组验证任务均因外部性能队列占用而未运行，不使用此前116项通过记录替代本次验证。15个相关生产／测试文件语法解析退出0，不含类型或动态验证；测试诊断和UI截图支持 `AXIOM_TEST_ARTIFACTS` 独立输出，避免覆盖旧证据。

### F5：权限与执行范围

子代理允许 read、grep、find、ls 和当前平台 Shell；伪造 write/edit、非平台 Shell、delegate 会在运行时拒绝。子代理禁用扩展、模板与资源包解析，测试用本地 npmCommand 哨兵确认不存在包不会触发安装。主代理的授权写入与扩展能力保留。当前 readonly 夹具已接入真实 ExecutionPool 和绑定执行许可，再检查首次及恢复请求的工具／扩展／安装限制；此项增强尚待复验。

Shell 是通用执行器。“不得修改源码”是职责要求，不是操作系统隔离。测试明确证明允许 Shell 能修改合成项目哨兵。需要恶意命令也无法写源码时，应另行实施与验证 OS 隔离；本轮不新增隔离平台。测试使用独立临时项目、随机回环端口与产物目录。

### F6：发布与 UI

Worker 与 Scheduler 按 run、queue/native 分区、顺序及 mode 去重。`pendingViews` 通过 setImmediate 合并 scope 失效，flush 读取最新权威状态；不省略回执处理。纯 queue/input 更新不重建父聊天。结算、未启动结束与关闭清理辅助集合并完成必要发布。

复用当前 `AgentViews` 的 observed、peek/current、persisted、布局与有界历史缓存，通过生产订阅验证接线。任务列表在 0/32/500/2000 规模使用固定批量 SQL，避免结果/回执 JOIN 乘法。新订阅、重连、消息集合与单消息订阅均返回完整权威内容。

UI遵循当前设计：主／子会话工具栏均为44px等宽热区连续单排、间距0，设置入口紧跟指标，空间不足时仅工具栏内部横滚；主会话记忆入口紧接压缩图标。`TooltipLayer.tsx` 不拦截输入元素的Escape。设置专项覆盖12组主窗口尺寸、短屏及1440/768/641/390宽度子窗口，并检查面板宽度与底部锚点。当前测试已补齐子窗口单排／横滚正向断言，修正后尚待运行；旧冻结布局的通过记录只证明对应冻结版本。

## 4. T01–T52 验收矩阵

下列构造与验收条件保留原方案要求。证据简称均指 `app/tests/`：R=`subagent-regressions.test.ts`，W=`subagent-worker-regressions.test.ts`，B=`subagent-boundaries.test.ts`，S=`subagent-subscriptions.test.ts`，P=`subagent-publishing.test.ts`，C=`subagent-continuity.test.ts`，V=`subagent-view-batch.test.ts`，RO=`subagent-readonly.test.ts`，TR=`task-reliability.test.ts`，TT=`tasks-thin.test.ts`，BW=`task-budget-worker.test.ts`，BG=`subagent-background.check.ts`。组合证据表示条件由多项测试共同验证，不伪称单一端到端测试。

| ID | 构造方式 | 验收断言 | 当前证据 |
| --- | --- | --- | --- |
| T01 | 交接前 `signal()` 明确返回未发送 | 输入明确 failed；可编辑原文/附件可恢复；不重复发送；无交接集合残留 | R，附件、单次发送与集合清理加强项通过。 |
| T02 | 模拟 send 返回背压，但随后正常接受/落盘 | 不按 false 背压判失败；最终一次 delivered | S，真实 child.send 发送后返回 false，通过。 |
| T03 | Worker 已收到，服务端先得到 uncertain，再执行撤回 | 必须经过 Worker 撤回；不能仅本地删除并声称成功；返回 ID 真实 | R，真实返回 ID/空确认两分支通过；接口用可控 mock。 |
| T04 | unknown 后迟到 input-accepted | 状态收敛、清理失败标记；后续撤回仍走实际队列 | R，通过。 |
| T05 | delivered 后迟到传输错误/旧 accepted | 不降级 delivered，不回填草稿、不污染任务终态 | R，通过。 |
| T06 | SDK 在入队前抛错、入队后抛错、检查留存时抛错三种场景 | 分别是明确拒绝、保留已提交证据、unknown；不自动重放 | W + worker-submission-fixture，真实 SDK 故障注入通过。 |
| T07 | 同 requestId 重传；不同 ID 相同文本 | 同 ID 只执行一次；不同 ID 不按文本合并 | S + R，通过；8 请求、每 ID 一次消费。 |
| T08 | 旧 run 回执到达相同 task 的新 run | 不改变新输入/预算/错误；不错误绑定 runId | R + TR，通过。 |
| T09 | 带 unknown 回执重启；分别有/无可靠 JSONL 输入证据 | 有证据只修正回执；无证据保留未确认；均不启动模型 | R，两分支通过。 |
| T10 | 停止中追加两条，重复停止/旧结算回调 | 保留既有 waiting/FIFO 规则；重复停止撤销待续接；旧回调不消费下一运行 | TR + TT，通过。 |
| T11 | 无效 mode、超长输入、外层图片校验失败 | 受理事务前拒绝，预算、阶段、输入数不变 | R，通过。 |
| T12 | work 中追加已受理，后续发送明确失败 | 新受理时钟保留，不回退；仅该输入失败，原工作继续 | R，通过。 |
| T13 | summary 中追加格式头合法但无法解码的图片 | 不打开工具，不生成“已收到新要求”的虚假工作轮次；失败/原总结收束按第 3 节 F2 规则明确记录 | W，通过；阶段规则见本文 F2。 |
| T14 | summary 中合法文字追加 | 同一 runId 中恢复工作；新要求恰好一次；截止来自服务端受理值 | BW + TT + S，组合通过。 |
| T15 | summary 中合法图片追加 | 完成准备后才恢复；图片 ID/内容对应正确；一条串行模型链 | W + images.test，通过。 |
| T16 | 图片准备被屏障阻塞时撤回，随后释放 | 不消费该 ID，不触发工作恢复；草稿/附件只恢复一次 | W，真实图片准备屏障→Scheduler→Worker撤回 ID，原文与图片草稿仅恢复一次，通过。 |
| T17 | 收到为撤回而发送的 input-accepted | 不作为恢复工作的真实提交证据 | W，通过。 |
| T18 | 触发恢复后 SDK 明确拒绝，且无其他成功输入 | 无工具新轮次；本运行按错误路径收束一次，部分产出保留，不自动总结/重放 | W，唯一不可变 partial 结果通过。 |
| T19 | 同一恢复批次第一条失败，第二条成功；全部失败 | 成功输入可处理且失败有单独回执；全部失败不能按批次 Promise 成功恢复 | W，逐项失败/接受/消费恰好一次加强项通过。 |
| T20 | summary→work 过程中再次到期、旧 summarize/预算事件迟到 | 新 revision 胜出；drain 无死锁；不能覆盖新阶段或额外延长总结 | W + BW + task-budget.test，组合通过。 |
| T21 | 停止/强杀、正常总结与恢复失败分别结算 | done/result 各一次；completed/failed/cancelled、partial/final、预算总结说明与实际事实一致 | W + BW + C + task-lifecycle.test，组合通过；强杀是 interrupted，无 Worker done，用一次主机结算/结果验收。 |
| T22 | 4 个任务处于启动预备屏障，上限 4→1 | 释放屏障后按新容量准入；其余 queued，无失败 run/result | R，通过。 |
| T23 | 4 个任务已正式准入，上限 4→1 | 不强停已准入任务；后续任务等实际容量足够 | R + TT，通过。 |
| T24 | 上限 1→4，队列已有等待任务 | 及时补空位，原 FIFO 顺序保留 | R，通过。 |
| T25 | 同一任务被连续 kick/偏好变更触发 | 不重复预留、不重复 Worker、不因延后形成忙循环 | R，100 次 kick 与准备屏障通过。 |
| T26 | 候选准备期间取消、整体停止或逻辑删除 | 释放屏障后不启动旧意图；排队取消沿原契约产生一次结果 | R，三分支通过。 |
| T27 | 队首准备失败/撤回，后续任务正常 | 队首按既有错误语义结束或退出候选；后续能推进，计数正确 | R，两分支通过。 |
| T28 | A 活动会话 ACK 被阻塞，B 启动子任务 | B 在 A 屏障释放前完成准入；无全局 ACK 队头阻塞 | R，屏障通过；B Worker 启动为 stub，正式性能另测准入。 |
| T29 | A 等待旧 idle Worker 退出，B 启动 | B 不等待 A 的进程退出；A 同会话仍不重叠执行 | R，真实 retirement/fork 通过。 |
| T30 | 配置快照准备期间修改配置 | 校验 revision；不混合配置，不静默换模型；失败清理归属/快照 | R，通过。 |
| T31 | 锁释放后、fork 前停止/关服/撤销供应商 | pending 可见且被阻止；无迟到启动、漏停或 orphan Worker | R，三分支通过。 |
| T32 | 新启动、追加、模型切换、resume/rewrite 同会话并发 | 一个执行归属；旧 expectedRunId/rewrite revision 被拒绝；无重复分支修改 | B，启动及竞争 rewrite 通过。 |
| T33 | 通知启动等待时父会话变 active/frozen/rewrite discarded | 保留原通知身份；不唤醒舍弃结果；已持久通知不重复注入 | TR + B，active/frozen/discarded/persisted 通过。 |
| T34 | 同 run 发送 100 次相同空/非空 queue | 除首次外不重复广播相同队列；回执事件仍处理 | R，服务端计数通过；C 真实 Worker 连续 queue 投影无重复。 |
| T35 | 相同输入 ID 顺序变换、mode 变化、pending→native | 不被错误去重；按原顺序展示 | R，通过。 |
| T36 | 短时间多子任务真实队列/状态变化 | 同父 scope 可合并视图构造；所有真实状态已先提交，不丢终态 | V 三子任务逐项持久回执先于一次父快照；S 六 Worker 终态通过。 |
| T37 | 延迟 flush 期间切换 run、停止、压缩或 rewrite | 旧快照不能覆盖新运行/分支；无旧消息复活 | B 四投影分支通过；C 另验真实强杀/恢复。 |
| T38 | 父会话包含 0/32/500/2000 个历史任务 | 返回集合与排序不变；SQL 次数固定量级，不按每任务三次递增 | P，通过；SQL 固定且 ≤10。 |
| T39 | 单任务多结果、多回执、不同运行时间 | 无 JOIN 乘法导致的重复结果/耗时；未知或未结束时间不造零证据 | P，通过。 |
| T40 | 通过生产服务入口创建 1 个前台会话、6–16 个后台子任务交错输出 | 实际接入 observed 判断而非默认全 true；后台不持续重建完整历史，前台缓存不被反复驱逐 | S 六真实 Worker、P 十六模拟流通过；正式基准另含十六真实 Worker。 |
| T41 | 无直接订阅时任务状态变化，但存在置顶/费用订阅 | 不构建无用正文；置顶、未读/活动摘要和费用失效仍正确 | S + P，通过；重复失效不重复费用。 |
| T42 | 新订阅/重连、逐消息与 messages 集合订阅 | 首次权威快照完整；集合订阅仍收到增量；不依赖先前被跳过的快照 | S + P，通过。 |
| T43 | 长任务结束，反复创建/关闭子窗口、会话逻辑删除 | transient/待发布/辅助队列回到稳定基线；未落盘尾部不被提前丢掉 | S 正常/删除、P + session-loading.test 正常落盘前保留通过；BG 十二次真实子对话框开关通过；C 强杀仅保留已持久部分。 |
| T44 | 鼠标选择、输入中、附件、原始会话、折叠/滚动、阅读确认 | 原交互不变；无焦点跳转、草稿覆盖、整会话闪烁或误标已读 | 已记录版本的Steering、session-experience、original-conversation、sticky、settings及BG通过，含六Worker和12次子窗口开关。当前设计改为全尺寸单排横滚，相关测试已对齐，整合版本待复验。 |
| T45 | 伪造 write/edit/非平台 Shell/delegate | 运行时真实拒绝，不只是 schema 隐藏；主代理能力不受影响 | RO，通过。 |
| T46 | 当前平台允许 Shell 写合成哨兵与产物 | 明确记录职责模式实际能力；不能据工具白名单宣称 OS 只读 | W，Shell 写合成源码和产物通过；是边界表征。 |
| T47 | 项目/全局同名扩展、资源包试图扩权 | 不加载或执行可执行扩展；不自动安装依赖；合法 read/测试仍能运行 | RO，npmCommand 本地哨兵及项目/全局扩展检查通过。 |
| T48 | summary 中伪造任意工具调用，之后合法追加/再总结 | summary 真正禁止工具；合法恢复受 F2 门禁；阶段不重复结算 | BW + W，组合通过。 |
| T49 | 两个子任务并行运行同类测试 | 输出目录不相互覆盖；端口/资源按约定隔离；不修改真实项目源码 | W，两个真实 Worker 隔离路径/端口通过。 |
| T50 | 长报告分页、旧结果重读、取消部分产出 | 按 resultId 可重建完整报告；旧结果不变；停止不请求额外模型总结 | TR + tasks.test，通过。 |
| T51 | 相同子任务首次、追加、恢复、Worker 复用/淘汰 | 工具/职责一致；只恢复绑定 JSONL；不出现跨会话上下文或模型污染 | C，同任务热 PID 复用、淘汰新 PID、强杀恢复、双模型/兄弟隔离通过。 |
| T52 | 全量测试、编译、真实 UI 场景与资源收尾 | 退出码真实；无遗留测试进程/端口；未执行项显式列出，不写“全部通过” | 冻结全量、专项、SDK/13项编译Worker、已记录版本build/UI及正式8份性能运行退出0；各次清理证据保留。最终一致性退出1，当前整合版本存在142项文件变化，影响审查与必要复验中。 |

## 5. 运行证据与重现

本轮产物根目录：`C:/Users/dane/AppData/Roaming/Axiom2/memory/sessions/802a607f-4585-4222-8f03-168e9e805b69/artifacts/`。日志名称以下均相对此根，保留首次 fixture 错误，不将失败或中断计为通过。

| 验证 | 实际结果与证据 |
| --- | --- |
| 冻结全量 | 106 个测试文件，按文件去重 467 项通过。四组原始运行中 11 个失败来自遗漏的外围文件；补齐 bin/package/scripts/desktop 后，六受影响文件 34/34、退出0。不是单次全量命令退出0。见 full-frozen-peripheral-rerun.log 及四组日志。 |
| 扩展回归 | frozen-regressions-first.log：31/31；包含真实 Worker、SDK 失败与启动屏障。 |
| 会话/通知边界 | boundaries-second.log：7/7；view-reset-four-boundaries.log：四投影分支通过，其中 stop/run-switch 是新增。 |
| 生产订阅 | subscriptions-fourth-unit.log：1/1，六 Worker、真实背压、精确8请求/费用1、重连、删除清理。 |
| 连续性/多任务合并 | final-boundary-tests.log：2/2；final-boundary-types.log：tsc 退出0。 |
| 加强断言 | final-strengthened-regressions.log：2/2；readonly-install-sentinel.log：1/1；image-recall-through-scheduler-second.log：1/1，退出0。 |
| 浏览器 | frozen-ui-second-steering-ui.log：25/25；session-experience、original-conversation、frozen-ui-third-sticky.log 退出0；final-settings-identity.log 为最终冻结设置专项，退出0；background-ui-third.log 为冻结六Worker交互。当前工作区settings与BG也分别退出0，实际产物位置见下文。 |
| 构建/SDK | final-build.log、final-sdk.log、final-compiled-workers.log 均退出0；编译Worker为13/13，含图片撤回与安装哨兵。布局复核后 final-frozen-build-after-layout.log（21.755秒）、final-workspace-build-after-layout.log（23.111秒）均退出0。进程、监听端口及fixture根核查见各运行清理记录。 |

当前工作区的补充验证采用独立产物目录：

- settings：`C:/Users/dane/AppData/Roaming/Axiom2/sessions/2a481fdb-f9fb-4f2d-87ee-9000d2a0c544/artifacts/final-workspace-settings.log`、同名前缀 `.exit.json` / `.cleanup.json`；155项前端及测试文件前后SHA256一致，端口55184和临时根清理通过。
- BG：`F:/Axiom2/artifacts/final-workspace-background.log`、`final-workspace-background/run2/result.json` / `cleanup-check.json`；453项src/tests文件前后SHA256一致，六Worker交互通过，已记录进程身份及端口全部释放。Chrome曾留下一个已记录的空临时目录，最终复核时已不存在，见 `run2/chrome-temp-final-cleanup.json`。首轮未取得退出码，最终结论只采用第二轮退出0。
- 一致性：`final-source-consistency.json` / `final-frozen-manifest.json` 记录冻结243源码/195测试目录文件（110个测试文件），以及当时工作区453项；该时点386相同、52同路径差异、15工作区新增，101个server/shared仅index静态资源处理不同。最终复核 `final-delivery-verification.json` 中工作区已为477项，较此前记录26新增、114变化、2删除，包含后端核心。冻结438项无漂移；既有工作区build/settings/BG仅覆盖运行时摘要对应的版本。

冻结运行目录为产物根下 `frozen-review/app`；独立边界与订阅补跑在 `boundaries-check/app`（src 指向冻结源码）。所有运行使用已有依赖、本地回环模型和临时 Store。环境 Node v24.19.0、pi SDK 1.1.0，Chrome 使用本机安装版本。

```text
node node_modules/typescript/bin/tsc --noEmit
node --import tsx --test --test-concurrency=1 --test-reporter=tap tests/<指定文件>.test.ts
node --import tsx tests/<指定场景>.check.ts
npm.cmd run build
npm.cmd run check:sdk
```

编译 Worker 必须先生成当前 dist，然后设置 `AXIOM_TEST_COMPILED=1` 运行支持该变量的指定测试。浏览器设置 `AXIOM_TEST_BROWSER=C:/Program Files/Google/Chrome/Application/chrome.exe`。原综合 `ui.check.ts` 的入口/picker/草稿契约过时，本轮未作为完整通过证据；专项仅证明各自列明范围。

## 6. 性能对比

两个脚本为 `subagent.perf.ts` 与 `subagent-production.perf.ts`。当前core夹具在B03仅测准入时主动退役未启动租约，避免空launchWorker占住同会话；失败时也释放ACK屏障并关闭隔离Agents。无池基线的缺失统计保留null，不当作0。该夹具修正尚待冒烟验证，正式八轮仍绑定原冻结脚本。同一候选脚本通过 `AXIOM_PERF_SOURCE` 切换基线/候选源码，`AXIOM_PERF_OUTPUT` 保存 JSON；正式运行清除 `AXIOM_PERF_SMOKE`、`AXIOM_PI_DIR`、`AXIOM_TEST_COMPILED`。按 A/B/B/A 顺序串行采样，保留每份命令、退出码、原始样本与源码 SHA256。

| 场景 | 输入与计数 |
| --- | --- |
| B01 | 冷启动10次；热启动20次；受理→准入→ready→running 分段。 |
| B02 | 并发1/4/8/16，各弃1次预热、保留20次；总完成与事件循环p95、逐任务阶段。 |
| B03 | 慢ACK屏障，弃2保留20；B准入是否早于释放、每场景锁次数/总占用/最大单锁占用；单锁摊平分位数另列。 |
| B04 | 6/16真实Worker，固定read工具后SSE；stream弃2保留20，记录字节、IPC、thread、JSONL open、publish。 |
| B05 | 历史0/32/500/2000，各弃2保留20；SQL、耗时、payload字节。 |
| B06 | 追加→撤回→再次追加→消费，弃2保留20；取消单独一次，只作正确性及描述性耗时，不伪称20样本p95。 |
| B07 | 核对辅助集合、运行归属、堆与active resources；正常结束、窗口关闭及删除另有专项。 |

队列结构事件另用6/16任务的独立父会话，每样本触发100×size个事件，弃2保留20，并断言实际父会话任务数等于size；不继承启动场景的历史任务。production耗时包括固定45ms等待和ping往返，不解释为纯处理耗时。core记录SDK版本；production未单独写出SDK字段。汇总校验每轮自然退出记录、ABBA顺序、Node版本、源码摘要、完整样本及辅助集合，资源快照与进程最终清理分别核对。

基线保留当时其他已实现的 Views/订阅能力，并包含未被旧 Worker 使用的通用留存 helper；不能把共同优化全部归为本轮收益。百分比只基于本机固定 fixture。优先验收确定性门槛：慢ACK不阻塞、相同队列不重复发布、TaskList SQL固定且≤10、纯queue不重建父聊天、无观察者稳定流不回读历史、结果/输入/费用一致、辅助集合归零。轻负载若出现约10%以上稳定退化，需解释定位，不以平均值掩盖。

八份正式数据均自然退出0：core每轮640次本地请求，production每轮88次；完整样本、源码摘要和非null辅助集合归零均通过。外部运行器曾因PID复用误报B3清理失败，其退出1记录保留，后续按PID及创建时间复核确认已观测原进程无残留。汇总脚本退出0，原始数据、独立退出记录及96项统计见会话产物 `perf-full-isolated-*`、`perf-full-isolated-eight-final-verification.json`、`perf-full-summary.json/.md`。

下表时间单位为ms，采用合并样本median / nearest-rank p95；每轮统计仍保留，不能用合并值遮盖单轮退化。

| 指标 | 基线 A median / p95 | 候选 B median / p95 |
| --- | ---: | ---: |
| 冷启动总耗时 | 3418.878 / 3578.180 | 3516.024 / 3824.761 |
| 热启动总耗时 | 133.849 / 149.374 | 126.389 / 181.729 |
| 并发1总耗时 | 130.310 / 155.904 | 120.558 / 145.776 |
| 并发4总耗时 | 602.627 / 682.648 | 487.948 / 550.761 |
| 并发8总耗时 | 1373.923 / 1561.160 | 929.923 / 1103.693 |
| 并发16总耗时 | 6092.287 / 6972.114 | 6147.255 / 7026.408 |
| 慢ACK下另一会话准入 | 194.823 / 215.408 | 38.920 / 43.845 |
| 6任务队列事件 | 225.198 / 328.046 | 25.552 / 69.980 |
| 16任务队列事件 | 859.501 / 984.246 | 66.175 / 107.716 |
| 6Worker生产追加/撤回/消费 | 125.241 / 169.784 | 110.667 / 126.430 |
| 16Worker生产追加/撤回/消费 | 125.752 / 156.109 | 109.653 / 125.370 |
| 空列表 | 0.172 / 0.238 | 0.231 / 0.311 |
| 2000条历史列表 | 75.527 / 93.447 | 87.161 / 118.617 |

确定性计数：慢ACK下先于释放准入由0/40变为40/40，每场景配置锁次数2→1；6/16任务队列场景TaskList和父thread重建分别600/1600→0，发布3000/8000→6/16。生产操作消息152→32、发布36→4，字节中位43131/43165→7801/7805，下降约82%。无观察者稳定流双方均为0次历史open和thread重建，这是保留的共同能力。历史0/32/500/2000列表双方始终9条SQL，payload字节一致。

完整96项统计已经独立复算一致。退化记录保留：冷/热准入分段中位增加约18%/16%；单并发事件循环分位增加约16%；空列表约+0.059ms，2000历史列表中位约+15%。热启动合并p95增幅主要出现在B3，B2的p95为137.560ms、低于A1的139.156ms，不能宣称每轮都变差，也不能丢弃B3。

隔离诊断不替代正式结果：

- `diagnostic-list-isolation.json` 在同进程、同Store、同数据下分别运行A/B/B/A，0/32/2000各20样本/块，退出0。2000条A合并median/p95=62.672/85.073ms，B=57.722/79.294ms；9SQL、内容及字节一致，未重现独立列表实现退化。方法正文及Store摘要相同，不将GC假说写成原因。
- `diagnostic-admission-analysis.md`：独立准入四轮均退出0，每轮23请求、20有效hot样本；合并A30.835/B27.583ms。beforeStart、owner校验有小幅直接成本，锁等待很短，不能解释正式多毫秒差异。该版分段用Date边界截断存在毫秒量化，部分细小事件跨边界，不作为高精度因果证据。
- `diagnostic-list-warmup-analysis.md`：固定候选代码，cold/warm/warm/cold四轮退出0，warm复刻正式B04额外48,400次list调用；320样本均9SQL/同字节。2000条cold68.645/warm70.765ms，32/500规模warm反而更慢，未证实“热身使A更快”或JIT/GC归因。
- `diagnostic-admission-prefix-analysis.md`：匹配正式B03及10cold/1warm/20hot的ABBA均退出0，共124请求。单调时钟run INSERT中位cold A33.581/B40.580ms，hot A32.326/B38.304ms，复现不利方向。配置准备hot中位28.162→32.190ms；双方statSync中位均425次，耗时10.363→13.246ms；beforeStart约0.098→0.260ms，B会话等待约0.018ms。增量集中在配置准备，不能全部归于新增校验或锁等待；GC有重叠，但尚未建立因果。
- 完整core逐SQL/GC候选首轮中断，没有自然退出码，不计通过。重做 `diagnostic-core-list-B-retry` 的Node自然退出0，640请求、固定9SQL及辅助集合归零通过；与另一个执行池基准重叠，时间数据排除出性能归因。原运行器退出2来自父PID复用导致的错误祖先关系，补充创建时间约束后，162个符合归属的已观测身份无残留，root/port清理通过，见 `diagnostic-core-list-B-retry-identity-review.json`。原失败记录保留；A对照尚未执行，不形成有效B/A比较。

资源快照若早于 provider 最终关闭，不能据其非零直接判断泄漏；也不能把基线不存在的 null 字段当作0。

## 7. 收尾与限制

当前剩余工作：完成执行池等并行改动的必要定向复验、构建与当前UI检查，补双源性能夹具正确性冒烟及最终交付记录。另一个会话的三批性能矩阵之后还接补充队列；须两套队列结束且无相关基准进程后，才启动本任务测试、构建或UI负载。正式八轮及冻结验收有效；当前整合版本、未解释的准入/列表性能退化不标为全部通过。

持续有效的限制：平台 Shell 不提供 OS 只读；强杀/异常写盘前未持久流式尾部不保证保存；旧综合 UI 脚本未通过；全量采用冻结分组与受影响文件补跑；AOCI维护不可用。测试通过不代表已发布，也不代表覆盖真实供应商、所有操作系统或恶意Shell硬隔离。

回退只针对本轮文件，不重放任务、不改历史结果、不复活 discarded 通知。unknown 回执回退前必须确保旧客户端/服务端安全显示未确认，不能批量改为未发送。用户数据迁移需另行明确范围。
