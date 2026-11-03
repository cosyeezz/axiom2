# Kiro 原生接入的多轮收敛核查

日期：2026-10-27。目标不是增加清单编号，而是让 **Axiom/Pi 自己掌控 agent 循环、工具、权限、子任务和恢复，Kiro 仅作为原生 provider**。不采用 CLI/ACP runtime，不改变其他模型。对应[校准清单](../../kiro-calibration-checklist.md)和[逐项官方证据矩阵](../../kiro-omission-review.md)。

本文只交付静态结论与后续修复/验收方案。用户“已登录、有模型、不能使用”的现象没有脱敏报错或运行复现，不能把下列任一问题认定为其根因。没有修改业务源码、运行项目测试/构建/CLI/REA、使用登录态、刷新、请求目录或模型；没有读取真实配置、凭据、秘密日志或会话。

## 范围、轮次与停止规则

每个完整轮次覆盖认证/目录/注册/准入（K01–K17、K41–K43）、协议/历史/工具/图/思考/流（K18–K34、K44、K48）、错误/恢复/用量/辅助调用（K35–K40、K46–K47、K49），并交叉核K45。独立审阅提供候选，主会话重读当前关键源码、核反证后裁决；并行子审不等于多个轮次。

改变诊断、修法或验收的真实补证、纠错、漏项算进展；重复风险、同义表述、单纯行号变化或未证猜测不算。遇到实质源码变化先重核受影响范围，不能套用旧快照的零轮。须连续两个完整轮次无实质新增才停止；停止只针对此静态范围，不证明全行为穷尽或接入可用。

| 轮次 | 主裁决 | 连续零轮 |
| --- | --- | --- |
| R1 | 两组实质进展：K04空目录与显式模型的分发不对称；K39成本、计数完整性与宿主context门槛 | 0 |
| R2 | 完整反证无净新增；后因源码改变，保留为历史零轮，不能直接沿用 | 1（历史） |
| R3 | 并行热切模型代码改变K45/K07接线及K01源观察边界；不是本会话修复 | 0 |
| R4 | 更新源码上的完整反证无净新增；sticky failure/IPC不确定终止属已纳入的失败门禁 | 1（随后因R5实质变化重置） |
| R5 | 轮末并行新增小窗口保护与no-op切换，主核及独立补核确认K45验收实质细化 | 0 |
| R6 | 当前源码上的完整反证无净新增；77源轮末与本轮起始一致 | 1 |
| R7 | 独立完整反证无净新增；77源轮末与R6起始一致 | 2 |

R6与R7三个分区分别完成、主会话裁决净0后，达到连续两完整零轮停止条件；R7轮末2026-10-27T02:45:21.898602+00:00对77源比较exit 0、差异0。不是将并行子审算多轮，也不是将R2/R4历史零轮套用到新源。R5一次轮末比较发现worker/测试变化并exit 1；主会话一度误标结案，已撤回并补核为有进展，不把失败观察改写成无漂移。R6测试疑似漂移另核实为任务沿用了R5旧hash；当前1a95d933…与R6基线一致，trim()发生于基线之前，不是新机制。

## K04：可选不等于能分发（待修/P0）

[宿主创建runtime](../../../app/src/server/model-runtime.ts#L59)关闭默认刷新，已有store时可走离线恢复。[Kiro refresh/filter](../../../app/src/server/providers/kiro.ts#L21)在缺项、空目录或scope失配的恢复分支可令原生models为空，但把scope设为当前认证scope。合法显式模型经[composer](../../../app/node_modules/@earendil-works/pi-coding-agent/dist/core/provider-composer.js#L173)加入composed目录后，filter仍按scope校验并可放行，并非绕过filter。

分发时[同一composer](../../../app/node_modules/@earendil-works/pi-coding-agent/dist/core/provider-composer.js#L372)的supportsBaseApi却只查原生base.getModels；空目录没有kiro-chat，因而绕过native stream进入[compat](../../../app/node_modules/@earendil-works/pi-ai/dist/compat.js)，该处没有kiro-chat注册，能在HTTP前抛出 `No API provider registered for api: kiro-chat`。有合法OAuth/API/固定域检查，不足以消除此分发不对称。

边界：没有store而未刷新时，scope仍undefined，可能先被filter挡掉；不能说所有空缓存、所有scope失配或所有显式模型都进入此错误。热切换的冻结快照guard不补回composer丢失的原生stream。修法应在受支持的组合/依赖源码边界保持原生分发，不靠全局注册、退OpenAI、放宽scope或直接修改安装node_modules。

## K39：三个独立消费者边界（待修/P1）

1. **计数完整不等于已算价格**：[provider](../../../app/src/server/providers/kiro-chat.ts#L194)只在四个主token字段齐全时整组写入；完整计数可以为正，但cost仍为初始化的数字0，未调用本地计价。[Pi stats](../../../app/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js#L3383)和[usage汇总](../../../app/node_modules/@earendil-works/pi-coding-agent/dist/core/usage-totals.js#L10)只累加已有usage.cost，不会统一按model价格补算。合法正价override亦不改变这条链；SDK有calculateCost helper不等于此路径调用了它。金额消费者的unknownCost保护仍在，不能说UI把服务账单当免费。
2. **没有完整快照仍可被当精确零token**：无metadata或仅部分主字段时，主计数保持初始化0；[usageCost](../../../app/src/server/usage-cost.ts#L9)只核四个数字合法性，0也合法，不接收provider的usageSeen/usageIncomplete诊断。[费用](../../../app/src/server/costs.ts#L89)与memory消费者可能把它当完整0计数。[memory-worker](../../../app/src/server/memory-worker.ts#L65)先写null占位，随后结果的usage真值对象仍可覆盖，不能把初始null当最终保护。完整→部分保留旧完整快照，不是逐字段更新；usageIncomplete也不是永久粘滞。
3. **宿主context被总token门槛一起丢掉**：[worker usage](../../../app/src/server/agent-worker.ts#L672)在算出context后仍要求stats.tokens.total>0才返回usage。条件是全部历史没有正token、DB usage初为null且contextWindow为正；[runs](../../../app/src/server/agents/runs.ts#L375)仅truthy usage才写库，[恢复view](../../../app/src/server/agents/views.ts#L77)也依赖usage，[宿主自动压缩](../../../app/src/server/compressions.ts#L225)缺context会早退。不是“worker写null覆盖DB”，也不表示旧正历史、手动压缩或独立Pi overflow都失效。

修法须分别传递安全的计数完整性、标明本地估价与真实账单区别、独立保存/使用context；不要回显原始私有diagnostics，或以undefined破坏Pi Usage必需number契约。保留完整→部分不覆盖；未知价不伪造免费。K38和K43联验，但不混同未知contextWindow=0与这里的正window条件。

## K45/K07：并行热切接线改变了验收，不等于Kiro已通过

[agent.model入口](../../../app/src/server/agents.ts#L482)先校可用模型/等级，[runs准入](../../../app/src/server/agents/runs.ts#L82)核snapshotValid及冻结模型原字节SHA与当前config.revision，再保存desired selection并发送带revision的IPC。这里比的是原字节hash，不是将[execution profile](../../../app/src/server/execution-profile.ts#L106)的stable JSON modelDigest与原文hash混比。

[worker](../../../app/src/server/agent-worker.ts#L131)只在prompt/continue、finishTurn和prepareNextTurnWithContext安全点应用pending选择，核历史及队列图片、模型/等级、取消状态和扩展是否改掉目标。切换失败粘滞、abort并阻止后续流/结算；不确定IPC由[runs](../../../app/src/server/agents/runs.ts#L278)终止，不静默声称已应用。model-applied只更新live provider，只有model-request才更新run.selection；菜单desired selection不因失败自动回滚，也不能假称已经发过目标请求。撤销同时关注实际、run及pending provider。

[网络配置](../../../app/src/server/integrations/model-proxy-env.ts#L83)允许显式atSafePoint重绑；先构造新dispatcher，再换环境/global dispatcher、关闭旧dispatcher；非安全点重配仍拒绝，代理读取仍fail-closed。仅Kiro保留60s/120s池参数，不把它们当请求/idle期限，不据静态close就保证无并发socket/性能问题。

最新新增：目标窗口为正且小于当前窗口时，worker用当前计数或估算历史、队列及输出reserve做容量检查，不足就失败，不能截断或发“仅切模型”的压缩请求。该路径直接用session.getContextUsage，不修复K39宿主usage门槛。同provider/id/thinking的no-op可不置modelChanged，仍可复用干净worker；真正改变选择不能回旧profile池。

[安全点测试定义](../../../app/tests/model-switch-safe-point.test.ts)使用safe-direct/safe-proxy与openai-completions，并非原生kiro-chat，且本轮未运行。定义中的工具批次、合并选择、代理切换、图片失败、撤销、小窗口及no-op不能折算为Kiro往返验收。

## 仍须保持的K47/K49及反证裁决

- K47：[compression-worker](../../../app/src/server/compression-worker.ts#L77)是createAgentSession→session.compact，不是completeSimple。split两段均非空或命中启用的可重试错误时，显式apiKey复用一次性ticket；首429/500可匹配重试，次消费在HTTP前本地失败，不能说发出4次请求、中文错误全不重试、真实消耗或扣费。每个物理调用应派生新opaque ticket，不延长为可重复票据。
- K49：普通主会话applyOverrides只改merged，而[getCacheWarmingMode](../../../app/node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js#L703)只读global；task storage wrapper和compression inMemory off有效。默认缺TTL/零价有阻断，合法override仍须通过正prompt、经济性、上下文、期限等门禁才可达。runtime注auth到新options不回写warmer原对象，不能声称必保存旧ticket；Kiro忽略maxTokens:1，warmer不执行工具。
- 子审建议只作候选。已撤回：raw/composed混淆后声称K04必被准入挡住；SDK自动补价；全部token始终0；null占位永远保护最终计数；compression无SDK重试；sticky失败或IPC终止当新bug；“完整防御/穷尽/所有测试已覆盖”；无官方未知。未形成新结论的不重复编号。

## 后续mock验收矩阵（未执行）

| 组合 | 必须观察的门禁 |
| --- | --- |
| 无store/空v2/缺kiro项/失配scope × provider-only/显式模型/副本 | 区分先挡选择与可选后分发；合法模型只进native stream，错误API/固定域/scope仍拒绝 |
| 完整/缺失/部分/完整→部分/重复乱序metadata × 默认价/合法正价override | 数字、计数完整性、本地估价、未知金额及上下文分别正确；不拿credits/百分比换token/账单 |
| DB usage初null/旧正历史 × 正window/未知window × 重开/自动阈值/手动/overflow | 不丢可用context，不抹旧记录；不将不同压缩入口合并判断 |
| split两摘要/可重试429或500/branch summary × 取消/退避/过期 | 每个物理请求新ticket，调用数/结果/账本一致；不放宽一次性或泄漏access |
| 非task/task/compression × global off/缺省/idle × TTL/经济/上下文/期限 | 实际getter和自动请求次数正确；未授权预热为零，不承诺maxTokens:1安全 |
| native Kiro→其他provider→Kiro × 文本/图/工具/思考/中断历史 | 工具批次后切换、模型/等级/身份/网络对应，失败不静默回旧模型、不重放已完成工具 |
| 活跃改目录/快速改选/撤销/IPC不确定/切换取消/小窗口/no-op | 原文revision与冻结快照一致；desired与实际请求分开；容量不足不截断/伪压缩，真正切换不回旧池 |
| 流中/工具前后/压缩时断连 × 重开/reconcile | 全流成功后才执行工具；同步JSONL与宿主结算一致，不由IPC失败直接推消息丢失 |

## 证据、归档与执行门禁

[41项历史](verification-41-items.json)、[48项历史](verification-48-items.json)及新增[49项历史](verification-49-items.json)保留原字节。49项历史观察为49清单/49矩阵、15/14/12/8处置、219链接/73链接文件、59源/12支持文档；不是本轮结果。前15、41项35源、48项49源、49项59源的当前匹配分别记录，不拿范围增长冒充代码不变。

审查期间有外部并行源码变化；九个Kiro provider源未由本会话修改，worker/agents/runs/network及safe-point定义的变化不是本会话修复。已审77源观察保存于[收敛源基线](convergence-source-baseline.json)，[文档校验脚本](verify-checklist.py)只校结构、文件/行界、历史hash及源字节，不验证语义。链接有效不证明所引结论正确。

11个macOS CLI 2.33.1 arm64 chat局部REA函数，不是11/49覆盖率；完整官方caller默认、模型/endpoint/认证传递、最终发送、响应正文/terminal/签名续接仍未闭合。同版launcher、旧Win/SDK、公开说明、第三方策略和本地实现不能混成官方契约。保留本地固定域、认证头、CRC/schema、成功后执行工具、取消与opt-out门禁。

后续必须分别获得授权：先修已确认本地问题及诊断；再实际运行离线provider→Pi→Axiom接线与错误/取消/恢复mock；门禁通过后才在Axiom隔离会话用已登录账号做最小文本，再无副作用工具、多轮、图/思考/中断及针对性其他模型回归。不要求盲目重登，不复制凭据，不用一条回复上卷全部通过。
