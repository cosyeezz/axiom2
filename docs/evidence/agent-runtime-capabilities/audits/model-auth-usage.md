# Axiom 模型、供应商、认证与用量静态审计

## 结论与口径

- 工作目录 `/Volumes/D_Work/axiom2`；只读当前工作树（未还原、未修改仓库）；不运行测试、模型、认证流程或网络请求。只生成本 `/tmp` 审计产物。
- 交付包含 **55项文件证据、40项建议接口能力（R6/G17/H17）、4条事件/观测/账务链、12类缺口/风险**。
- 主范围 **55 文件、7,655 源行**：用户列出的 53 文件，另补 `provider-usage.ts` / `provider-usage-cache.ts` 两个直接依赖。文件清单完整见表一；另少量消费者/已安装SDK仅作为链路交叉证据，不计入主范围。
- 35/55 文件直接含 Pi 包引用：pi-ai 27、pi-coding-agent 15、pi-agent-core 2（集合有交集；包含 type-only，不能直接当运行时调用数量）。已安装 Pi coding-agent **1.1.0**，通过本地 documentation-paths 脚本确认；未联网。
- **关键边界：Pi ModelRuntime ≠ AgentRuntime。** 本报告 R=建议 AgentRuntime/其历史适配边界，G=建议 ModelGateway，H=宿主服务。名称是目标接口分层建议，不声称仓库已定义这些接口。`pi-ai` 的 Provider/Model/OAuth/stream、以及 `pi-agent-core` 的 StreamFn 类型均不能据包名误计为 agent loop 能力。
- 主体应拆为 ModelGateway 推理/提供商插件、宿主认证/管理/账本；AgentRuntime 在本范围只暴露会话统计/上下文/历史/压缩结算集成点。后台标题/记忆直接 completeSimple 不经过 AgentSession，不应被迫套 AgentRuntime。

## 表一：逐文件能力与证据（55项；R/G/H为目标归属）

| # | 文件与行号 | 归属 | 能力、约束与Pi耦合 |
|---|---|---|---|
| 1 | [agent-session-usage.ts:8-21](/Volumes/D_Work/axiom2/app/src/server/agent-session-usage.ts#L8) | R→H | 会话累计 token/cost、当前容量、末请求及 Kiro measurement 显示投影；读取 AgentSession stats/context/model/manager，不发请求。 |
| 2 | [auth-browser.ts:4-29](/Volumes/D_Work/axiom2/app/src/server/auth-browser.ts#L4) | H-auth | 安全 URL→平台启动命令；shell:false，取消/10s 超时；不是模型或代理运行时。 |
| 3 | [auth.ts:36-278](/Volumes/D_Work/axiom2/app/src/server/auth.ts#L36) | H-auth→G-auth | 连接 owner 隔离登录状态机；revision/authActive 互斥、prompt/notify、浏览器、答案校验、取消/断连、落盘复验。 |
| 4 | [context-usage.ts:10-81](/Volumes/D_Work/axiom2/app/src/server/context-usage.ts#L10) | R-adapter→H | Pi buildSessionProjection/calculateContextTokens/estimateTokens；系统增量合并一次，context_edit/compaction 使旧基线失效；Kiro partial/zero 改估计。 |
| 5 | [costs.ts:14-155](/Volumes/D_Work/axiom2/app/src/server/costs.ts#L14) | H-ledger←R-history | 按主子会话家族读历史及 DB；assistant、toolResult.usage、usage entry、摘要/压缩、memory_usage；压缩 ID 去重、缺失未知；不重价历史。 |
| 6 | [model-copies.ts:6-92](/Volumes/D_Work/axiom2/app/src/server/model-copies.ts#L6) | G-adapter | 配置 ID→物理模型 ID；鉴权仍使用本地复制项；历史助手 ID 改写、流结果恢复本地 ID；覆盖 stream/simple/deferred/cancelDeferred。 |
| 7 | [model-discovery.ts:10-93](/Volumes/D_Work/axiom2/app/src/server/model-discovery.ts#L10) | G-catalog | 仅配置 endpoint 提供模型身份；OpenAI/Anthropic/Google 列表及分页、凭据头优先级、拒绝重定向、2MB/20页/1000项边界。 |
| 8 | [model-latency.ts:24-113](/Volumes/D_Work/axiom2/app/src/server/model-latency.ts#L24) | G-observe→H | run/request/purpose、payload/response/first-event、白名单 HTTP、result 完成、首 text/thinking/toolcall、retry/delivery；不消费流/响应体。 |
| 9 | [model-metadata.ts:21-120](/Volumes/D_Work/axiom2/app/src/server/model-metadata.ts#L21) | H-admin/G-store adapter | 只读 CredentialStore 快照及 catalog；价格/显示名独立有界读取，不解析执行密钥、不锁认证、不初始化 SDK、不归属不明 scoped cache。 |
| 10 | [model-network-worker.ts:15-70](/Volumes/D_Work/axiom2/app/src/server/model-network-worker.ts#L15) | H-process→G-auth/catalog | 独立网络 worker 路由 catalog/login/storeKey/checkAuth/prepareAuth/available/logout/usage；token/header 不跨 IPC 返回；回传可控错误。 |
| 11 | [model-network.ts:10-117](/Volumes/D_Work/axiom2/app/src/server/model-network.ts#L10) | H-process | 按 root/dir/provider/proxy/configRevision 复用隔离进程、串行、prompt/notify IPC、取消握手/强杀、空闲回收及 close。 |
| 12 | [model-runtime.ts:25-175](/Volumes/D_Work/axiom2/app/src/server/model-runtime.ts#L25) | G-adapter | Pi ModelRuntime 工厂；原生懒注册、metadata/configuration/execution scope；受控 refresh、观察器/复制项安装；Kiro auth/dispatch 防错误泛型路由。 |
| 13 | [model-service.ts:73-695](/Volumes/D_Work/axiom2/app/src/server/model-service.ts#L73) | H-admin→G | 模型目录、只读设置/凭据状态、串行配置发布、API key 迁移、prepareAuth、目录实时发现、代理、注销/partial failure；使用 Pi ModelRegistry/ModelRuntime。 |
| 14 | [model-usage-ledger.ts:28-426](/Volumes/D_Work/axiom2/app/src/server/model-usage-ledger.ts#L28) | H-ledger←R-history | 校验筛选/分页、分批有界 JSONL+DB 索引、文件/工作区归属、谱系去重、原子 staging、partial/warnings、快照查询/analytics。 |
| 15 | [model-usage-statistics.ts:28-160](/Volumes/D_Work/axiom2/app/src/server/model-usage-statistics.ts#L28) | H-ledger | 另一个按需有界会话家族累计扫描；Costs fingerprint+LRU/singleflight；软预算，源变化报告非原子。 |
| 16 | [models/draft.ts:38-557](/Volumes/D_Work/axiom2/app/src/server/models/draft.ts#L38) | H-admin→G-metadata | 模型/供应商配置编辑语义、header/body 掩码与命令授权、复制/alias、思考/输入/成本、注销确认、SDK 有效结果复验；保留未展示字段。 |
| 17 | [models.ts:12-72](/Volumes/D_Work/axiom2/app/src/server/models.ts#L12) | H-admin→G-metadata | advisory 可用目录；按 provider 快照+metadataOnly runtime 隔离，模型白名单、思考/图像能力；不作为执行准入。 |
| 18 | [provider-request-observer.ts:19-114](/Volumes/D_Work/axiom2/app/src/server/provider-request-observer.ts#L19) | G-observe→H | 物理 HTTP/call 精度探测，跳过虚拟入口；onPayload 后 start，HTTP失败即 end，成功至 result；worker instance IPC；不消费事件。 |
| 19 | [provider-request-statistics.ts:6-53](/Volumes/D_Work/axiom2/app/src/server/provider-request-statistics.ts#L6) | H-telemetry | owner/request ID 幂等 start/end、current/peak/60s滚动 RPM、callLevel、releaseOwner 防幽灵；纯内存不准入。 |
| 20 | [provider-usage-cache.ts:15-115](/Volumes/D_Work/axiom2/app/src/server/provider-usage-cache.ts#L15) | H-quota | 只持久化白名单公共 DTO；独立命名空间/权限/防链接、有界读取/原子替换；不是 token/cost 账本。 |
| 21 | [provider-usage.ts:17-95](/Volumes/D_Work/axiom2/app/src/server/provider-usage.ts#L17) | H-quota→G-auth adapter | 仅 openai/openai-codex OAuth quota adapter；读取已存凭据，不 refresh/getAuth；认证/配置/代理绑定缓存、singleflight、stale/限频与返回前身份复验。 |
| 22 | [providers/codebuddy-auth.ts:22-109](/Volumes/D_Work/axiom2/app/src/server/providers/codebuddy-auth.ts#L22) | G-auth plugin | Pi OAuthAuth：固定 CN 地址 state/token 轮询、取消/超时、refresh/toAuth；保守 fallback TTL 明确不是上游 TTL。 |
| 23 | [providers/codebuddy-cn.ts:38-74](/Volumes/D_Work/axiom2/app/src/server/providers/codebuddy-cn.ts#L38) | G-provider plugin | createProvider/envApiKeyAuth/lazyApi；OpenAI completion 适配、reasoning_effort/summary、onPayload/fetch；保留 system/tools/results。 |
| 24 | [providers/codebuddy-models.ts:24-57](/Volumes/D_Work/axiom2/app/src/server/providers/codebuddy-models.ts#L24) | G-catalog plugin | 11项静态模型能力与 limits、thinkingLevelMap、OpenAI compat；零价表示未核验，目录不是账号实时权限。 |
| 25 | [providers/codebuddy-response.ts:29-105](/Volumes/D_Work/axiom2/app/src/server/providers/codebuddy-response.ts#L29) | G-transport plugin | HTTP/SSE 安全错误分类/上下文溢出归一化；转换流保留取消与背压；不转发上游原始错误文本。 |
| 26 | [providers/kiro-auth.ts:124-276](/Volumes/D_Work/axiom2/app/src/server/providers/kiro-auth.ts#L124) | G-auth plugin | Builder ID/Identity Center OIDC PKCE/device、social PKCE、refresh；严格 TTL/region/URL、2MiB响应/独立等待截止、禁止 generic toAuth。 |
| 27 | [providers/kiro-callback.ts:11-121](/Volumes/D_Work/axiom2/app/src/server/providers/kiro-callback.ts#L11) | G-auth support/H-loopback | loopback callback+手动URL竞速；origin/path/state/method 校验、取消清理；只有用户登录时监听。 |
| 28 | [providers/kiro-catalog.ts:17-182](/Volumes/D_Work/axiom2/app/src/server/providers/kiro-catalog.ts#L17) | G-catalog plugin | 凭据/profile/服务 region、scope hash、cache validation/迁移、IMAGE/limits、固定 AWS分页实时目录；无静态回退。 |
| 29 | [providers/kiro-chat-protocol.ts:15-159](/Volumes/D_Work/axiom2/app/src/server/providers/kiro-chat-protocol.ts#L15) | G-serialization plugin | 限定 kiro-chat/固定元数据 endpoint；system/tool/images/history 映射、tool name alias、配对/中断恢复安全；不重放历史 thinking/signature。 |
| 30 | [providers/kiro-chat.ts:34-272](/Volumes/D_Work/axiom2/app/src/server/providers/kiro-chat.ts#L34) | G-provider plugin | 一次性 auth ticket、enterprise profile discovery、payload/response/provider-event hooks、AWS事件→Pi文本/思考/tool、schema验证、usage/diagnostics/cancel/timeout。 |
| 31 | [providers/kiro-eventstream.ts:9-102](/Volumes/D_Work/axiom2/app/src/server/providers/kiro-eventstream.ts#L9) | G-parser plugin | AWS prelude/message CRC32、严格头/JSON/UTF8、增量帧、16MiB帧/64MiB流/10万事件、CPU公平性与取消。 |
| 32 | [providers/kiro-failure.ts:20-157](/Volumes/D_Work/axiom2/app/src/server/providers/kiro-failure.ts#L20) | G-error plugin | 有界16KiB/1s错误体、状态/代码/冲突/证据分类、脱敏请求ID；验证reason仅观测、不改变重试；部分输出禁止盲重放。 |
| 33 | [providers/kiro-profile.ts:11-64](/Volumes/D_Work/axiom2/app/src/server/providers/kiro-profile.ts#L11) | G-auth/request prep | 企业 profile 分页/地区查询、固定源；多profile拒绝猜选；仅空成功可试另一服务区；不使用共享 ARN。 |
| 34 | [providers/kiro-thinking-stream.ts:10-84](/Volumes/D_Work/axiom2/app/src/server/providers/kiro-thinking-stream.ts#L10) | G-parser plugin | 开头 thinking 标签流解析、Unicode分片、有限前缀/空白、未闭合诊断；普通正文引用不误解析。 |
| 35 | [providers/kiro-thinking.ts:18-71](/Volumes/D_Work/axiom2/app/src/server/providers/kiro-thinking.ts#L18) | G-capability plugin | 明确兼容 profile→预算/adaptive/reasoning 等级及序列化；不把兼容配置当上游能力声明，不静默降级。 |
| 36 | [providers/kiro-tool-input.ts:8-47](/Volumes/D_Work/axiom2/app/src/server/providers/kiro-tool-input.ts#L8) | G-parser plugin | 工具参数UTF8增量预算1MiB，代理对边界、几何增长预览、complete一次性；不是工具执行器。 |
| 37 | [providers/kiro-usage.ts:10-84](/Volumes/D_Work/axiom2/app/src/server/providers/kiro-usage.ts#L10) | G-metering→H | 物理请求价格快照含tiers；unknown/partial/complete；完整快照原子提交，token一致性；配置估价/零价未知；摘要保留逐请求 provenance。 |
| 38 | [providers/kiro.ts:41-89](/Volumes/D_Work/axiom2/app/src/server/providers/kiro.ts#L41) | G-provider/catalog plugin | Provider 实现/filterModels/refreshModels/publish；账号scope cache、network generation与失败诊断、stream/simple。 |
| 39 | [providers/openai-usage.ts:34-134](/Volumes/D_Work/axiom2/app/src/server/providers/openai-usage.ts#L34) | H-quota adapter | Wham usage/reset credits、窗口/余额/重置次数、部分失败、bounded reader；direct scope拒绝未核实quota接口并给官方管理页。 |
| 40 | [providers/qoder-auth.ts:14-132](/Volumes/D_Work/axiom2/app/src/server/providers/qoder-auth.ts#L14) | G-auth plugin | 地区device PKCE polling/refresh、PAT交换/userinfo、期限不虚构；Pi OAuthAuth→打包身份；进程内有界singleflight，调用者取消不取消共享交换。 |
| 41 | [providers/qoder-catalog.ts:27-122](/Volumes/D_Work/axiom2/app/src/server/providers/qoder-catalog.ts#L27) | G-catalog plugin | 账号 config→Pi descriptor；思考/default/context/function switches、BYOK metadata；raw config/secret只在内存，零价不是credit倍率。 |
| 42 | [providers/qoder-client.ts:28-197](/Volumes/D_Work/axiom2/app/src/server/providers/qoder-client.ts#L28) | G-serialization plugin | generation/effort/budget/context、BYOK、自定义业务参数、消息/工具/图像、reasoning encrypted replay的provider+model边界、完整原生payload。 |
| 43 | [providers/qoder-protocol.ts:49-259](/Volumes/D_Work/axiom2/app/src/server/providers/qoder-protocol.ts#L49) | G-transport plugin | 请求JSON预算与编码/解码、地区推理endpoint allowlist、COSY签名、错误业务码分类、有界JSON与超时；非AgentRuntime。 |
| 44 | [providers/qoder-sse.ts:6-205](/Volumes/D_Work/axiom2/app/src/server/providers/qoder-sse.ts#L6) | G-parser plugin | SSE envelope/legacy工具/签名回放/usage标准化、finish校验、quota/通知控制帧、终结后1s usage idle grace、4MiB帧/背压/取消。 |
| 45 | [providers/qoder.ts:36-141](/Volumes/D_Work/axiom2/app/src/server/providers/qoder.ts#L36) | G-provider plugin | createProvider+lazy OpenAI assembly；PAT/device identity、账号签名目录、固定地区endpoint、native payload hook后编码发出；maxRetries:0、不静默换模型。 |
| 46 | [request-selection.ts:5-31](/Volumes/D_Work/axiom2/app/src/server/request-selection.ts#L5) | R-history→H | 从真实 assistant stamp恢复 provider/model/thinking；本地error/aborted无证据不冒认selection；change投影。 |
| 47 | [request-usage.ts:8-27](/Volumes/D_Work/axiom2/app/src/server/request-usage.ts#L8) | R-history→H | getBranch倒序最近assistant（含不进入context尝试）；Kiro非complete不展示cache率，不用旧请求回填新unknown。 |
| 48 | [usage-accounts.ts:16-110](/Volumes/D_Work/axiom2/app/src/server/usage-accounts.ts#L16) | H-auth/quota | 独立Codex quota授权目录，绝不进入模型执行快照；防符号/硬链接别名、登录互斥、proxy、revision+credential generation注销。 |
| 49 | [usage-analytics.ts:38-73](/Volumes/D_Work/axiom2/app/src/server/usage-analytics.ts#L38) | H-ledger | 已验证行单次聚合；时区日历/DST、≤60趋势桶、top5+其他、未定日期保留。 |
| 50 | [usage-cost.ts:7-47](/Volumes/D_Work/axiom2/app/src/server/usage-cost.ts#L7) | H-ledger | 记录价优先，unknown tokens/cost/parts分离；非Kiro可加标注公开参考价估算；Kiro只认请求时价格和measurement，禁止后补重价。 |
| 51 | [usage-materialized-store.ts:12-95](/Volumes/D_Work/axiom2/app/src/server/usage-materialized-store.ts#L12) | H-ledger/cache | 独立派生SQLite/WAL、generation/head原子发布、bounded rows/views、分批清旧；不attach源DB。 |
| 52 | [usage-query-cache.ts:2-24](/Volumes/D_Work/axiom2/app/src/server/usage-query-cache.ts#L2) | H-cache | 快照本地8项/1MiB serialized LRU，隔离响应对象突变。 |
| 53 | [usage-sidecar-engine.ts:32-230](/Volumes/D_Work/axiom2/app/src/server/usage-sidecar-engine.ts#L32) | H-ledger worker | 只读源DB，低优先级tick分批重建/快照发布；DB版本与轮转文件stat侦测append/replacement（含迟到用量），visibility隔离、重试、background状态。 |
| 54 | [usage-sidecar-worker.ts:5-34](/Volumes/D_Work/axiom2/app/src/server/usage-sidecar-worker.ts#L5) | H-process | priority19，init/read/close IPC；仅cache writer，错误脱敏；退出不执行模型。 |
| 55 | [usage-sidecar.ts:11-110](/Volumes/D_Work/axiom2/app/src/server/usage-sidecar.ts#L11) | H-process | 256MB child，500ms查询、bounded队列、自动重启/preparing/error，无进程内扫描fallback；没有模型/消息订阅。 |

## 表二：建议抽象接口能力（40项 = R 6 + G 17 + H 17）

以下是从代码反推的能力清单，不是新接口已存在的声明；实现位置不等于最终归属。R06 是为避免宿主账本继续依赖 Pi JSONL 形状而建议的适配出口，H12/H13 的源实现是范围外补证。

| ID | 所属边界 | 建议能力名（示意） | 必须保留的语义 | 证据 |
|---|---|---|---|---|
| R01 | R | `readSessionUsage(session)` | getSessionStats/getContextUsage/model 只读投影；不要让 UI 持有 AgentSession。 | [agent-session-usage.ts:8-21](/Volumes/D_Work/axiom2/app/src/server/agent-session-usage.ts#L8) |
| R02 | R | `readBranchAccountingEntries(session)` | SessionManager.getBranch/getEntries→宿主标准化 accounting entries；保留失败/取消/usage条目及摘要ID。 | [request-usage.ts:8-13](/Volumes/D_Work/axiom2/app/src/server/request-usage.ts#L8)；[costs.ts:92-120](/Volumes/D_Work/axiom2/app/src/server/costs.ts#L92) |
| R03 | R | `projectContext / estimateContext` | Pi projection/token estimator应藏适配器；上下文占用与累计账本、lastRequest分别返回，不混算。 | [context-usage.ts:10-81](/Volumes/D_Work/axiom2/app/src/server/context-usage.ts#L10) |
| R04 | R | `readLastPhysicalSelection` | 保留真实 provider/model/thinking stamp；本地合成失败不能冒充真实请求。 | [request-selection.ts:5-31](/Volumes/D_Work/axiom2/app/src/server/request-selection.ts#L5) |
| R05 | R | `observeNativeCompactionSettlement` | compaction_start/end、物理摘要调用、成功checkpoint归属，未采用尝试以不可见usage entry结算。此集成实现位于主范围外。 | [native-compaction-usage.ts:32-121](/Volumes/D_Work/axiom2/app/src/server/native-compaction-usage.ts#L32)；[kiro-compaction-usage.ts:15-114](/Volumes/D_Work/axiom2/app/src/server/kiro-compaction-usage.ts#L15) |
| R06 | R | `appendAccountingUsage / appendCheckpoint` | 宿主业务意图由R适配SessionManager.appendUsage/appendCompaction；不要让Costs/全局ledger继续解析Pi形状。 | [costs.ts:100-120](/Volumes/D_Work/axiom2/app/src/server/costs.ts#L100)；[kiro-compaction-usage.ts:24-30](/Volumes/D_Work/axiom2/app/src/server/kiro-compaction-usage.ts#L24) |
| G01 | G | `createGateway(snapshot, providerScope, mode)` | ModelRuntime.create及native注册/refresh包装；模式 execution/metadata/configuration-only；底层Pi对象不外泄。 | [model-runtime.ts:81-175](/Volumes/D_Work/axiom2/app/src/server/model-runtime.ts#L81) |
| G02 | G | `describeProvider / listModelDefinitions / getModel` | provider/model/input/limits/thinking/price capabilities、catalog source/freshness/unknown状态。 | [model-service.ts:334-416](/Volumes/D_Work/axiom2/app/src/server/model-service.ts#L334) |
| G03 | G | `checkConfigured / listAvailable (advisory)` | credential presence、账号catalog、可用性各有含义；不能当execution admission或真实推理验证。 | [models.ts:11-59](/Volumes/D_Work/axiom2/app/src/server/models.ts#L11)；[model-service.ts:440-443](/Volumes/D_Work/axiom2/app/src/server/model-service.ts#L440) |
| G04 | G | `validateDefinitions(snapshot)` | 只验证selected provider结构，不读凭据、不刷新目录、不加model gate。 | [model-runtime.ts:95-103](/Volumes/D_Work/axiom2/app/src/server/model-runtime.ts#L95)；[model-runtime.ts:170-175](/Volumes/D_Work/axiom2/app/src/server/model-runtime.ts#L170) |
| G05 | G | `discoverCatalog(connection, auth, signal)` | 标准endpoint列表及native signed/account catalogs；不把本地override/静态metadata伪装endpoint发现结果。 | [model-service.ts:417-552](/Volumes/D_Work/axiom2/app/src/server/model-service.ts#L417)；[model-discovery.ts:10-93](/Volumes/D_Work/axiom2/app/src/server/model-discovery.ts#L10) |
| G06 | G | `prepareCredential / resolveAuth(model, signal)` | 显式OAuth预刷新与每物理请求鉴权；opaque ticket不当可复用key，auth header/baseUrl/密钥不得到UI。 | [model-service.ts:178-195](/Volumes/D_Work/axiom2/app/src/server/model-service.ts#L178)；[model-runtime.ts:61-78](/Volumes/D_Work/axiom2/app/src/server/model-runtime.ts#L61) |
| G07 | G | `stream(request, signal)` | 文本/thinking/tool/done/error标准事件；Pi AssistantMessageEventStream仅adapter内部；自定义provider结果兼容性需声明。 | [providers/kiro-chat.ts:49-272](/Volumes/D_Work/axiom2/app/src/server/providers/kiro-chat.ts#L49)；[providers/codebuddy-cn.ts:61-74](/Volumes/D_Work/axiom2/app/src/server/providers/codebuddy-cn.ts#L61) |
| G08 | G | `streamSimple / complete / completeSimple` | 简单reasoning选项与完整options分开；后台直接调用，不启动agent loop。当前completeSimple在SDK调用this.streamSimple(...).result()。 | [model-runtime.ts:72-78](/Volumes/D_Work/axiom2/app/src/server/model-runtime.ts#L72)；[memory-worker.ts:63-95](/Volumes/D_Work/axiom2/app/src/server/memory-worker.ts#L63) |
| G09 | G | `pollDeferred / cancelDeferred (optional)` | 复制项路由已覆盖streamDeferred/cancelDeferred；观察器未覆盖这些路径，必须独立能力声明，不把支持copy当支持计数。 | [model-copies.ts:85-91](/Volumes/D_Work/axiom2/app/src/server/model-copies.ts#L85)；[provider-request-observer.ts:103-114](/Volumes/D_Work/axiom2/app/src/server/provider-request-observer.ts#L103) |
| G10 | G | `routeVirtual / resolvePhysicalIdentity` | 虚拟模型只在物理递归计数；配置copy ID、requested/physical/response model三种身份须显式保留。 | [provider-request-observer.ts:41-43](/Volumes/D_Work/axiom2/app/src/server/provider-request-observer.ts#L41)；[model-copies.ts:32-89](/Volumes/D_Work/axiom2/app/src/server/model-copies.ts#L32) |
| G11 | G | `onPayload / onResponse / onProviderEvent` | 调用链hook，不拷贝/重放/消费流；只在真实native payload后计数；provider-specific校验不能被hook突破。 | [provider-request-observer.ts:60-89](/Volumes/D_Work/axiom2/app/src/server/provider-request-observer.ts#L60)；[providers/kiro-chat.ts:144-180](/Volumes/D_Work/axiom2/app/src/server/providers/kiro-chat.ts#L144) |
| G12 | G | `serializeContext / toolSchema / validateToolCall` | system增量、tool/results配对、图片、thinking signature replay，留在provider插件；不等于实际tool执行能力。 | [providers/kiro-chat-protocol.ts:53-157](/Volumes/D_Work/axiom2/app/src/server/providers/kiro-chat-protocol.ts#L53)；[providers/qoder-client.ts:105-197](/Volumes/D_Work/axiom2/app/src/server/providers/qoder-client.ts#L105) |
| G13 | G | `resolveReasoning / generationControls` | 公开输入capabilities/映射，unsupported/unknown不可静默忽略；Kiro部分controls诊断为未映射。 | [providers/kiro-thinking.ts:18-71](/Volumes/D_Work/axiom2/app/src/server/providers/kiro-thinking.ts#L18)；[providers/kiro-chat.ts:93-97](/Volumes/D_Work/axiom2/app/src/server/providers/kiro-chat.ts#L93) |
| G14 | G | `normalizeFailure / retrySafety` | 结构化category/stage/partial/evidence、脱敏；禁止将部分响应重放。传输SDK重试与agent级重试区分。 | [providers/kiro-failure.ts:103-157](/Volumes/D_Work/axiom2/app/src/server/providers/kiro-failure.ts#L103)；[providers/qoder.ts:57-126](/Volumes/D_Work/axiom2/app/src/server/providers/qoder.ts#L57) |
| G15 | G | `measureUsageAndPriceSnapshot` | input/output/cacheRead/cacheWrite、measurement state、price provenance/tiers；服务token≠credits/percent，配置估价≠服务账单。 | [providers/kiro-usage.ts:10-84](/Volumes/D_Work/axiom2/app/src/server/providers/kiro-usage.ts#L10)；[providers/kiro-chat.ts:237-242](/Volumes/D_Work/axiom2/app/src/server/providers/kiro-chat.ts#L237) |
| G16 | G | `observeRequestLifecycle` | id/provider/precision/start/end、虚拟去重、HTTP失败/完成结算、native/custom保守探测；不承担额度准入。 | [provider-request-observer.ts:19-114](/Volumes/D_Work/axiom2/app/src/server/provider-request-observer.ts#L19) |
| G17 | G | `observeLatency` | runId/requestId/purpose/first-event/HTTP attempts/finish与delivery关联；观察异常不能影响推理。 | [model-latency.ts:24-113](/Volumes/D_Work/axiom2/app/src/server/model-latency.ts#L24) |
| H01 | H-auth | `loginFlow(owner, revision, method)` | 交互state、browser/prompt/notify、secret校验、cancel/disconnect；gateway提供provider auth method协议，不拥有UI连接owner。 | [auth.ts:36-278](/Volumes/D_Work/axiom2/app/src/server/auth.ts#L36) |
| H02 | H-auth | `credentialPersistence / migration / logout` | 存储授权、env/命令表达式显式授权、旧key迁移、持久化复验、CredentialSynchronizationError/部分成功。 | [model-service.ts:244-321](/Volumes/D_Work/axiom2/app/src/server/model-service.ts#L244)；[model-service.ts:588-695](/Volumes/D_Work/axiom2/app/src/server/model-service.ts#L588) |
| H03 | H-admin | `readEditPublishConfiguration` | revision/serial writer、保留未表示字段、SDK validate→fsync/rename、credential与config不是单事务。 | [models/draft.ts:177-557](/Volumes/D_Work/axiom2/app/src/server/models/draft.ts#L177)；[model-service.ts:588-695](/Volumes/D_Work/axiom2/app/src/server/model-service.ts#L588) |
| H04 | H-admin | `proxyRoute / isolatedNetworkWorker` | 按provider/配置/route隔离网络、拒绝代理不可用时降级直连；主进程不直接承载OAuth和目录联网。 | [model-network.ts:30-117](/Volumes/D_Work/axiom2/app/src/server/model-network.ts#L30) |
| H05 | H-admin | `metadataOnlyDisplay / invalidation` | 无key解析/credential lock/持久cache写；watcher只是optional display invalidation，不是执行依赖。 | [model-metadata.ts:21-52](/Volumes/D_Work/axiom2/app/src/server/model-metadata.ts#L21)；[model-service.ts:113-131](/Volumes/D_Work/axiom2/app/src/server/model-service.ts#L113) |
| H06 | H-quota | `queryProviderQuota` | quota adapters独立于推理usage；OpenAI/Codex账户窗口/余额/重置，unsupported不联网，direct scope未核实不查询。 | [provider-usage.ts:17-30](/Volumes/D_Work/axiom2/app/src/server/provider-usage.ts#L17)；[providers/openai-usage.ts:84-134](/Volumes/D_Work/axiom2/app/src/server/providers/openai-usage.ts#L84) |
| H07 | H-quota | `isolatedUsageAccount` | 独立directory/generation/revision/links防护；额度账户不是模型连接，不能进执行快照。 | [usage-accounts.ts:15-110](/Volumes/D_Work/axiom2/app/src/server/usage-accounts.ts#L15) |
| H08 | H-quota | `quotaCache / singleflight / stale` | identity hash包含credential+config+live proxy，返回前复验；每viewer取消不影响共享bounded查询。 | [provider-usage.ts:45-95](/Volumes/D_Work/axiom2/app/src/server/provider-usage.ts#L45)；[provider-usage-cache.ts:52-115](/Volumes/D_Work/axiom2/app/src/server/provider-usage-cache.ts#L52) |
| H09 | H-observe | `aggregatePhysicalRequests` | owner-scoped current/peak/rpm/callLevel，释放dead worker，幂等end；无payload/secret/持久化。 | [provider-request-statistics.ts:6-53](/Volumes/D_Work/axiom2/app/src/server/provider-request-statistics.ts#L6) |
| H10 | H-ledger | `normalizeHistoricalUsage / estimateMissingPrice` | known/unknown tokens/cost/parts、公开参考价估计来源；Kiro measurement、配置估价规则单独保真。 | [usage-cost.ts:7-47](/Volumes/D_Work/axiom2/app/src/server/usage-cost.ts#L7) |
| H11 | H-ledger | `sessionFamilyCostReport` | main/subagent/tool/compression/other，实际模型而非选中模型；摘要关联去重、不可读记录unknown、子会话不暴露兄弟。 | [costs.ts:55-155](/Volumes/D_Work/axiom2/app/src/server/costs.ts#L55) |
| H12 | H-ledger | `recordAuxiliaryUsageUpsert` | 后台标题/记忆 placeholder→actualusage，同一call ID upsert；usage先于取消结果过滤，保留已发生费用。 | [memory-worker.ts:68-84](/Volumes/D_Work/axiom2/app/src/server/memory-worker.ts#L68)；[memory-runner.ts:118-137](/Volumes/D_Work/axiom2/app/src/server/memory-runner.ts#L118) |
| H13 | H-ledger | `recordCompressionBillingUntilWorkerClose` | 每物理摘要尝试unknown→actual、重试/分段逐项累计；取消后仍接收billing，应用结果需closed/ownership验证。 | [compression-worker.ts:127-151](/Volumes/D_Work/axiom2/app/src/server/compression-worker.ts#L127)；[compression-worker.ts:188-199](/Volumes/D_Work/axiom2/app/src/server/compression-worker.ts#L188)；[compressions.ts:394-446](/Volumes/D_Work/axiom2/app/src/server/compressions.ts#L394) |
| H14 | H-ledger | `boundedUsageLedger / snapshotQuery` | 源文件+DB核对、fork lineage去重、过滤/分页/稳定快照、损坏/预算partial；不能把账本行数当物理HTTP数。 | [model-usage-ledger.ts:151-426](/Volumes/D_Work/axiom2/app/src/server/model-usage-ledger.ts#L151) |
| H15 | H-ledger | `usageStatisticsAndAnalytics` | workspace/provider/model/category聚合，时区calendar趋势/unknown/estimated；按需旧扫描与sidecar路径分别标识。 | [model-usage-statistics.ts:28-160](/Volumes/D_Work/axiom2/app/src/server/model-usage-statistics.ts#L28)；[usage-analytics.ts:38-73](/Volumes/D_Work/axiom2/app/src/server/usage-analytics.ts#L38) |
| H16 | H-ledger | `materializeInLowPriorityWorker` | 只读source+derived writer，generation/head发布/可见性，轮转stat捕获迟到追加/替换，bounded重建；不订阅高频模型事件。 | [usage-sidecar-engine.ts:53-230](/Volumes/D_Work/axiom2/app/src/server/usage-sidecar-engine.ts#L53)；[usage-materialized-store.ts:56-95](/Volumes/D_Work/axiom2/app/src/server/usage-materialized-store.ts#L56) |
| H17 | H-process | `shutdownAndCancellationDrain` | 网络active credential取消需worker确认或exit才能解锁；usage worker独立回收，不用主进程scan fallback。 | [model-network.ts:85-117](/Volumes/D_Work/axiom2/app/src/server/model-network.ts#L85)；[usage-sidecar.ts:39-110](/Volumes/D_Work/axiom2/app/src/server/usage-sidecar.ts#L39) |

## 事件、请求观测、用量与迟到结算：不能合并的四条链

| 链路 | 起点/终点 | 精度与数据 | 迟到/取消语义 | 归属与证据 |
|---|---|---|---|---|
| 请求并发/RPM | onPayload后、HTTP fetch前或unsupported call；成功stream.result完成、HTTP拒绝立即end | 随机id/provider/precision；没有tokens/cost，不持久化；标准API函数身份+原生白名单决定http，否则call | finished后迟到hook/fetch不再start；真实调用不被阻止。owner释放清计数、迟到end无害；不等同服务器已停止计费。 | G观察，H聚合；[provider-request-observer.ts:39-101](/Volumes/D_Work/axiom2/app/src/server/provider-request-observer.ts#L39)；[provider-request-statistics.ts:11-53](/Volumes/D_Work/axiom2/app/src/server/provider-request-statistics.ts#L11)；[execution-pool.ts:200](/Volumes/D_Work/axiom2/app/src/server/execution-pool.ts#L200)；[execution-pool.ts:316-317](/Volumes/D_Work/axiom2/app/src/server/execution-pool.ts#L316) |
| 延迟诊断 | 每逻辑stream生成runId:sequence；payload/response/first_event/first text/thinking/toolcall/end | 单调duration+墙钟at，session/auxiliary purpose；白名单HTTP attempt，错误只allowlist分类 | 每request闭包保留归属防retry串号；自定义result不调用，只发unobserved_end；不是账务凭证 | G hooks，H diagnostics；[model-latency.ts:24-113](/Volumes/D_Work/axiom2/app/src/server/model-latency.ts#L24) |
| 推理measurement/历史账本 | Pi assistant/usage/checkpoint或memory_usage/compression billing→Costs/Ledger | input/output/cacheRead/cacheWrite、actual response model、已记录cost/provenance；账本records可为aggregate不是HTTP次数 | 失败/取消仍可能有真实usage；Kiro partial/unknown不冒认完整零，copy/response模型与selected模型不可混用；未知保留。 | G产生，R历史适配，H账本；[providers/kiro-usage.ts:10-84](/Volumes/D_Work/axiom2/app/src/server/providers/kiro-usage.ts#L10)；[costs.ts:92-137](/Volumes/D_Work/axiom2/app/src/server/costs.ts#L92)；[model-usage-ledger.ts:331-417](/Volumes/D_Work/axiom2/app/src/server/model-usage-ledger.ts#L331) |
| 供应商quota | 独立已存OAuth→Wham usage/reset credits→ProviderUsage DTO | 窗口百分比/余额/次数；不等价本地token/$cost，不代表模型权限 | 不refresh token；singleflight跨viewer；网络返回后认证/代理hash/expiry复验，旧结果不覆写新身份；允许stale明确标记 | H独立quota；[provider-usage.ts:21-95](/Volumes/D_Work/axiom2/app/src/server/provider-usage.ts#L21)；[providers/openai-usage.ts:91-134](/Volumes/D_Work/axiom2/app/src/server/providers/openai-usage.ts#L91) |

### 后台直调模型：不是 AgentRuntime

1. `memory-worker` 复用 `ModelService.runtime()`，按所选模型和思考等级调用 **runtime.completeSimple**，Context只有system/user、禁止tool执行；kind同时包括query/organize/title。先发同一usageId的unknown占位，再发actual usage，随后才按取消/stopReason/工具结果决定是否发布答案。[memory-worker.ts:16-19](/Volumes/D_Work/axiom2/app/src/server/memory-worker.ts#L16)；[memory-worker.ts:57-99](/Volumes/D_Work/axiom2/app/src/server/memory-worker.ts#L57)
2. 主进程只接收相同lease；**先处理usage upsert，再检查signal.aborted**。取消不应丢弃已经发生的费用；后台标题/记忆归原始会话/任务lease，不能记到后继lease或主模型选择上。[memory-runner.ts:107-153](/Volumes/D_Work/axiom2/app/src/server/memory-runner.ts#L107)
3. 本地已安装SDK确认 `complete()` 调用 `this.stream(...).result()`，`completeSimple()` 调用 `this.streamSimple(...).result()`；因此工厂安装的stream observer正常涵盖这些完成式API，不能只搜stream调用漏掉后台。见 [Pi ModelRuntime:485-517](/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js#L485)。observer自身只在workerInstance存在时发IPC；主进程/未绑定worker、直接pi-ai API调用没有同等保证。

### 摘要与压缩迟到结算

- 原生压缩：R适配层拦截compaction_start/end+agent.streamFunction结果+appendCompaction。成功checkpoint拥有费用，未被checkpoint覆盖的尝试另appendUsage，分段摘要逐请求保留tiers/provenance；Kiro和非Kiro各有guard。不是每个native/tool/branch摘要自动都覆盖。[native-compaction-usage.ts:16-121](/Volumes/D_Work/axiom2/app/src/server/native-compaction-usage.ts#L16)；[kiro-compaction-usage.ts:15-114](/Volumes/D_Work/axiom2/app/src/server/kiro-compaction-usage.ts#L15)
- 独立compression-worker：每次物理summary调用先放入unknown charge、result()回来替换为真实usage并发billing；finally **await allSettled(accounting)** 后 waitForIdle/dispose/closed，Kiro成功返回前也等accounting。[compression-worker.ts:127-158](/Volumes/D_Work/axiom2/app/src/server/compression-worker.ts#L127)；[compression-worker.ts:187-199](/Volumes/D_Work/axiom2/app/src/server/compression-worker.ts#L187)
- 主进程在 `live.cancel` 过滤之前处理model_result/closed/billing，所以取消后仍可保存费用；不能因job已取消就忽略billing。真正应用摘要还需闭包收到closed、正确lease、非terminal、有entry，避免答案发布和计费结算混为一谈。[compressions.ts:394-446](/Volumes/D_Work/axiom2/app/src/server/compressions.ts#L394)
- Costs/Ledger用axiomCompressionId+applied集合避免同一数据库job与checkpoint双计；snapshot-only取消/启动拒绝没请求，不造unknown账。[costs.ts:104-135](/Volumes/D_Work/axiom2/app/src/server/costs.ts#L104)；[model-usage-ledger.ts:349-417](/Volumes/D_Work/axiom2/app/src/server/model-usage-ledger.ts#L349)
- 后台materialization不靠实时消息订阅：DB data_version、轮转128文件stat检查、配置stamp和过期重建使迟到append/replace最终可见；返回verifiedThrough/publishedAt/background状态，不能宣称实时一致或完整账单。[usage-sidecar-engine.ts:98-196](/Volumes/D_Work/axiom2/app/src/server/usage-sidecar-engine.ts#L98)

## 抽象建议：对外DTO，Pi仅在adapter/plugin内

| 抽象 | 最小边界 | 不应泄露/混入 |
|---|---|---|
| AgentRuntime | 会话统计、标准化history/accounting entries、context measurement、checkpoint及未采用摘要结算；将原生lifecycle转为稳定宿主事件 | AgentSession/SessionManager/SessionEntry、appendCompaction位置参数、裸agent.streamFunction不应成为宿主所有模块的依赖 |
| ModelGateway | provider/model descriptor、definition validation、catalog、explicit auth preparation、stream/complete、optional deferred、request hooks、usage/provenance、结构化failure及physical request observation | Pi Provider/Model/Usage/AssistantMessageEventStream、compat全局注册表身份、one-use票据实现，不应直接传给UI/账本 |
| HostAuth/ModelAdministration | owner交互流程、凭据目录/权限/迁移/原子配置发布、proxy/worker生命周期、独立quota账户、revision与停止确认 | 不把登录成功、catalog返回或metadata available当真实推理权限/资源准入 |
| HostUsageLedger | request/lease/generation身份、unknown→measured幂等upsert、取消后drain、source dedup、pricing provenance、派生查询/持久物化 | 不用HTTP start/end充当bill；不从当前选中模型推断tool/backend实际模型，不把quota credits换成token/$ |

建议标准请求标识至少区分 `runId / leaseId / requestId / attemptId / provider / configModelId / physicalModelId / responseModelId / purpose`；usage需要 `measurementState + pricingKind + recordedRates/tier + sourceEntryId/checkpoint/jobId + settlementState`。现有这些字段分散存在，并非已有统一DTO。`stream`/`result`、retry、compaction等事件需要有序关联，而不是把所有事件塞进AgentRuntime。

## 12个缺口/风险与迁移建议（静态发现，不声称为线上已复现故障）

| # | 缺口/风险 | 证据与建议 |
|---|---|---|
| 1 | 尚非真正技术无关的ModelGateway：业务直接拿ModelRuntime/ModelRegistry/Model/Usage | ModelService、draft、model-copies等均依赖Pi类型/方法；逐步在工厂和provider插件后加稳定descriptor/request/result DTO，先隔离运行时值再隔离type-only引用。 |
| 2 | 宿主账本仍直接消费Pi SessionEntry/JSONL语义 | Costs:92-120、Ledger:327-360、context/request projections；应由R适配导出会计事件，保留历史版本迁移；纯去import不能消掉语义耦合。 |
| 3 | 缺统一物理请求/账务correlation ID | 请求observer随机UUID、latency run:sequence、memory usageId、compression callId、账本hash各自不同；不能仅凭时间可靠join。采用上节统一关联字段。 |
| 4 | 观测覆盖不是所有模型API | observer只包装stream/streamSimple，workerInstance外不安装；streamDeferred/cancelDeferred等copy支持不意味着请求计数支持。对非chat/image/audio/embedding等不得从SDK能力推断本范围已有完整支持，需显式capability matrix及观测入口。 |
| 5 | HTTP/call精度与结束时刻不能冒称“全量真实网络活跃” | 白名单API+函数identity保护、codex仅SSE为http、Qoder/任意extension回退call；custom result不观测，未触发onPayload可能没有start；成功HTTP统一到stream完成才end。UI/接口必须公开precision/coverage。 |
| 6 | 摘要账务不是crash-atomic，覆盖有限 | native-compaction-usage:32-36明确排除branch summaries及SDK transport内部重试；两guard于compaction_end落盘，强杀可丢末次usage。引入持久attempt占位/结算协议；不得承诺精确一次billing。 |
| 7 | 取消与迟到usage只有drain窗口内保证 | memory-runner settled后移除listener，compression主进程等待close且2s强杀，model-network取消2s回收；worker死亡后不可恢复的远端已计费用仍unknown。结算模型应允许unresolved/interrupted，不假报0。 |
| 8 | Provider终结/usage协议部分是本地兼容政策 | kiro-chat:243-252明确local-eof-policy/terminalContract:unverified；kiro-thinking:5-16为explicit compatibility profiles；descriptor应区分declared/compatible/verified，不把EOF推断当服务确认；[qoder-sse.ts:183-190](/Volumes/D_Work/axiom2/app/src/server/providers/qoder-sse.ts#L183) finish+finalUsage后默认1s idle grace，超过窗口的后续用量可能不再收，不能宣称服务端terminal契约已验证。 |
| 9 | 原生压缩归属遇到mixed/custom/ambiguous只能保守处理 | Kiro uncertainAppend/custom避免猜计，非Kiro ambiguous写unknown；这些路径不是“账完整”。应暴露warning/unknown原因与source，不拿成功checkpoint掩盖未核对尝试。 |
| 10 | 全局物化/家族统计只可视作有界保留历史视图 | budgets、已归档/删除过滤、原始记录缺失、fork lineage限制、文件变化、轮转stat均可能partial/延迟；保留verifiedThrough/warnings并明确不是供应商法定账单；核对两统计路径fork去重口径是否统一。 |
| 11 | 认证/配置/目录同步不是单事务 | ModelService:640-691、auth:183-211、model-network:101-106；保存可能published且credential同步失败，取消也须等待store锁释放。抽象必须保留`PARTIAL_CONFIG_FAILURE` / `CredentialSynchronizationError`，禁止一律retry。 |
| 12 | 协议硬化/取消一致性及账户quota覆盖仍不对称 | Kiro有独立abortable等待和有界body，CodeBuddy response/auth没有同等显式frame/body上限；Qoder部分等待靠注入transport遵守signal。quota仅OpenAI/Codex，不支持Kiro/Qoder等，direct grant接口未核实。后续用隔离离线契约测试补齐，当前未运行任何测试。 |

### 未验证与交付边界

- 所有结论为静态阅读，未启动应用/child、未加载外部扩展、未执行测试/build/模型/网络；唯一执行的node脚本仅解析本地安装文档路径，另用Python统计文本与写本报告。
- 未证明供应商端endpoint/权限/limits/价格/终结契约的实时正确性，代码中的“verified/official”注释只作为实现来源声明，不作为本次联网实测。
- 未全量审计其他agent/session/resource/tool模块；`memory-worker/runner`、`compression-worker/compressions`、`native/kiro-compaction-usage`、`execution-pool`和已安装SDK只用于证明后台/迟到链。建议主代理合并到全仓统计时把这些补证去重，不重复加主范围55数目。
- 当前工作树可能由其他任务并行修改；行号代表本次读取时位置，无commit冻结/全仓dirty diff比对。审计过程未做任何仓库写入或git reset/checkout。
