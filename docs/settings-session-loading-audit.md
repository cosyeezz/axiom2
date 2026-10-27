# 配置与会话切换加载调研

> 本文保留初始调研时的基线事实和验证结果。随后已实施配置快照、模型行隔离和单次元数据查找复用；当前改动与验证边界见[第一批低风险优化](settings-loading-safe-implementation.md)。会话/滚动及协议分层建议仍未在该批实施。

## 范围与结论

本轮只调研、验证和提出建议，不修改产品逻辑、不重启正在使用的后台。以当前工作区源码为准；工作区已有大量修改，不能把本轮发现归因于某次提交。所有新增验证使用隔离数据或模拟传输，未读取真实会话、未调用模型。

用户目标：先显示页面壳、供应商/会话标题和可见摘要，进入具体区域才加载正文或配置；已有缓存可复用。硬约束：不能用闪屏、无法回到最上、阅读位置跳回开头、丢草稿或破坏双击重命名交换速度。

**当前已部分实现 UI 按需挂载，但没有端到端按需加载。最值得优先处理的是摘要背后的全量数据与计算，而不是先重写聊天滚动。**

## 一、已确认的额外成本

### 1. 模型编辑器：标签懒挂载，数据仍一次读取全部供应商

- [Models.tsx](../app/src/client/pages/Models.tsx#L12) 已通过 `React.lazy` 加载登录/模型编辑器，并使用 [MountOnVisit.tsx](../app/src/client/MountOnVisit.tsx) 延迟首次挂载。
- [useConfiguration.tsx](../app/src/client/models/useConfiguration.tsx#L115) 首次仍发 `configuration.get`，取回全部供应商、全部模型和 templates；[model-service.ts](../app/src/server/model-service.ts#L304) 遍历全体供应商构建编辑草稿，单个模型还有多次重复 `runtime.getModel`。
- 本地 metadata-only 配置读取已经与网络目录、推理鉴权重建分离。不能把“打开编辑器必然联网查所有供应商”当作当前问题。
- [useConfiguration.tsx](../app/src/client/models/useConfiguration.tsx#L65) 每次 render 都对全部 providers 与 savedProviders 做规范化 JSON 序列化以判断 dirty；搜索、标签和提示更新也会带来重复工作。
- [ModelRegistry.tsx](../app/src/client/models/ModelRegistry.tsx#L160) 进入模型标签后全量 `rows.map`；标签隐藏后 DOM 和组件仍保留，不等于停止派生和 render。

**隔离生产构建观察：**8 个供应商、每个 250 个模型时，未进入模型标签有 0 个模型行，但完整编辑配置约 246,435 bytes 已返回；另有包含全部 available 模型的 configuration scope。进入标签一次挂载 250 行，当前桌面视口实际相交约 8 行；返回供应商标签仍保留 250 行。此处字节数是合成夹具的 JSON 大小，不是用户配置大小。

### 2. 会话标题目录：背后可能同步扫描历史

- [server/index.ts](../app/src/server/index.ts#L120) 为工作空间及置顶会话列表补 `messageCount`。
- [AgentViews.messageCount](../app/src/server/agents/views.ts#L152) 在计数缓存未命中或文件身份/版本变化时，同步打开原生 JSONL，并遍历当前分支中包含压缩前历史的 entries。
- 它不填充聊天显示消息缓存，但仍需要读盘和解析；因此“目录只返回标题”不等于“服务端只读标题”。DOM 虚拟化不能消除这项成本。

**隔离结构验证：**12 个会话、每个 100 条、原生文件共约 10.0 MB。首次计算打开了 12 次 transcript，重复计算未变化会话打开 0 次；结果均为每会话 100，聊天显示缓存仍为空。单次本地采样约 13.0ms / 0.22ms，只证明冷/热路径差异，不代表用户设备耗时，也不是优化前后对比。

### 3. 会话正文：前端窗口化已做，服务端仍有完整投影

- [agents.messages](../app/src/server/agents.ts#L100) 对整个当前 transcript 投影逐条 `boundedMessage` 后返回。单条预览有长度上限，但消息条数不是按当前视口取。
- [AgentViews.transcript/thread](../app/src/server/agents/views.ts#L109) 冷读取仍解析当前投影并建立完整索引/分组。
- [historyIndex](../app/src/server/agents/views.ts#L202) 也不是纯磁盘轻索引：冷路径调用 [historyProjection](../app/src/server/history-projection.ts)，构建带正文的投影，再返回 index。
- 同一隔离夹具中，一个没有 compaction 的会话读取 historyIndex，返回 0 个归档区间，服务端却仍打开 transcript 并在历史投影缓存保留 100 条正文，估算约 1.66 MB。不能据此认定所有会话都能跳过 index 校验；外部编辑、版本和原生分支仍需正确识别。

前端已有虚拟列表、可见归档分组加载、请求取消、live/archive 正文交接、缓存预算和迟到结果保护。不是需要从零加懒加载。

### 4. 会话首屏附加读取：环境和费用详情提前到达

- [SessionState.tsx](../app/src/client/chat/SessionState.tsx#L63) 面板闭合时仍在适用条件下预加载 `agent.environment`。服务端 [agents.ts](../app/src/server/agents.ts#L301) 可能执行 capabilities.prepare 和 previewEnvironment，生成提示词、工具 schema、资源清单等详细内容。
- [Usage.tsx](../app/src/client/chat/Usage.tsx#L35) 的费用图标首屏调用 [useCostReport.ts](../app/src/client/useCostReport.ts)，读取完整账本再汇总；弹层 DOM 按需不等于明细数据按需。
- 本轮生产构建的模拟传输确实观察到：环境面板及费用弹层未打开，已出现 `agent.environment` 和 `costs.get`。

可以拆成“首屏必要摘要”与“展开后的详情”，但不能把可见的费用状态、金额准确性或真实执行资源准备一并关闭。环境和费用目前也不在历史读取的 `read.cancel` 支持范围内：忽略迟到回执不等于服务端已停止计算。

### 5. 真实鼠标点击会话有固定 300ms 等待

[SessionHistory.tsx](../app/src/client/workspaces/SessionHistory.tsx#L166) 为区分单击切换与双击重命名，鼠标单击延迟 300ms 才 select；键盘激活立即切换。即使缓存命中，这个等待仍存在。

生产构建、模拟 WS、真实 Playwright 鼠标点击的单次样本：首个新会话请求在 click 后约 **310ms** 发出，与源码机制一致。合成 DOM `.click()` 的 `detail=0` 会走立即路径，不能拿这类测试结果代表鼠标体验。

这不是可以无条件删除的“无用等待”。建议先保留点击即时反馈，研究可取消的轻量准备；若要立即切换，需另外确认双击重命名、焦点和触控语义，不能静默更换交互。

### 6. 配置页与工作台之间为整文档导航

[main.tsx](../app/src/client/main.tsx#L13) 已让连接和当前页面 import 并行启动，但渲染仍等待页面模块及后续 overrides CSS；HTML root 初始无页面壳。配置页之间及返回工作台使用普通链接。

本轮当前源码的隔离生产构建中，依次进入配置概览、模型配置和工作台，每页都新建一个 WS。相同 JS/CSS 可命中 HTTP 缓存，但页面运行时、React 和模块内缓存一般需要重建；浏览器 BFCache 的实际恢复情况未专项测量。工作台内部切换会话不重新建 WS，不能混为一谈。

整页导航也承担页面 CSS 隔离功能。直接全站 SPA 化或全部页面 hidden 保活会带来样式、订阅、计时器、草稿、焦点和滚动风险，优先级应低于数据分层。

## 二、建议顺序

| 批次 | 建议 | 风险与验收重点 |
| --- | --- | --- |
| 第一批：不碰聊天几何 | 按引用 memo 配置 dirty/rows，复用单模型查找，隔离隐藏标签无关 render | 不改变规范化 dirty 规则、不丢跨供应商草稿、隐藏编辑器仍参与保存；先做这类低风险减计算 |
| 第一批：轻首屏 | 环境摘要/详情、费用摘要/账本分离；配置概览只收计数而非完整 available | 保留当前模型、费用未知态、警告和金额语义；只延迟非可见重详情 |
| 第二批：目录不扫正文 | 会话计数持久化或后台增量维护，列表先交付摘要；为旧记录设计补算 | compaction、分支、编辑、append、瞬态增量都要准确，unknown 不冒充 0；不能简单失去计数 |
| 第二批：配置协议分层 | 供应商目录 → 当前供应商连接 → 模型列表摘要 → 单模型编辑详情 | 必须同时设计 patch/完整快照和 revision；“未加载”绝不能被保存为空数组而删除配置 |
| 第二批：模型大列表 | 以规模阈值引入稳定行、可见范围＋overscan；离屏内容延迟挂载 | 稳定 key/占位，搜索可定位，编辑 focus/IME/滚动不被卸载破坏；不能只 `display:none` |
| 单独评审 | 会话 300ms 的反馈与单/双击策略；轻量稳定页面壳 | 不静默改变重命名语义；避免闪出旧会话正文、错误主题或布局 |
| 第三批：高风险 | 服务端轻历史索引、正文按可见分组/范围＋overscan；必要时再讨论跨页导航架构 | 先解决当前导航基线失败，再建立 live 流、归档、懒正文、断线与滚动全套不变量 |

补充边界：普通客户端命令在 [transport.ts](../app/src/client/transport.ts#L148) 限制 200,000 UTF-8 bytes，而模型服务保存校验允许到 1 MiB。大配置可能“能读却不能保存”。这是静态确认的协议上限差异，尚未在本轮执行真实保存复现；分层设计时应一并验收，不能仅增加读取规模。

**缓存建议：**复用最近数据而非无限保活。现有 transport 活跃保护＋5会话 LRU，history-cache 全局16MiB/5项，单 HistoryStore 8MiB等预算应保留；有缓存先稳定展示，后台校验版本，不能先清空再显示，也不能用旧缓存确认最新已读。

## 三、滚动必须保留的约束

1. 物理“回到最上/最下”和“上一/下一交付”是不同语义，不能只留一套跳转。
2. lazy 正文、测高、折叠展开、live/archive 交接时，以稳定消息身份和像素偏移保锚；不能将浏览器暂时高度夹紧到0记录为用户主动回到开头。
3. 手动 wheel/touch/键盘/滚动条、选区与焦点优先；真实手势可打断导航，但布局 scroll、普通点击不能误判为手动滚动。
4. 交付/首尾导航拥有滚动控制期间，旧 ResizeObserver 锚点不得抢回；边缘需等待真实正文和几何稳定，不能把稳定占位当作已到达。
5. 虚拟窗口换行仍要保留总高度与必要 overscan，防止瞬间 clamp、空白和闪动；不能为“严格只挂视口内”牺牲快速滚动。
6. 输入框伸缩不遮尾部，自动跟底不抢历史阅读；提交、流式更新和缓存切换遵循既有语义。

## 四、验证及现存失败

### 已通过

- 当前源码独立 Vite 生产构建输出到 `/tmp`，未覆盖仓库 dist；隔离页面/传输观察无 pageerror。
- `settings-loading.check.ts`：模型/字体目录按需、跨标签草稿、错误重试等。
- `reading-scroll.check.ts`：scroll/RO 先后竞态、layout clamp、未测量DOM、原生wheel。
- `history-handoff.check.ts`：live/archive正文与阅读偏移、懒正文24px定位、pending edge与逐帧覆盖。
- `timeline-performance.check.ts`：窗口化挂载数量、spacer与smooth edge逐帧检查。
- `session-bottom.check.ts`：冷/热/移动切换、输入框伸缩、阅读、选区、提交与stream。
- `history-loading.test.ts`、`session-loading.test.ts`：19项，18通过、1项Windows环境跳过、0失败。
- `session-statistics.test.ts`：2项通过，覆盖跨compaction计数、分支、瞬态消息去重和unknown。
- 隔离计数/索引结构夹具：冷/热打开次数、消息数和无compaction索引断言通过。

### 不能标为通过

`delivery-navigation.check.ts` 原运行及重新委派复跑均退出1：在第117行，同一 JS 任务中连续触发两次“下一交付”后，预期到第二交付却稳定停在第一交付，等待12000ms超时。

诊断中第一目标滚动位置约4383.34、实际scrollTop=4383，第二目标约5890.34；第二目标已在DOM中，连续采样不动。因此不像单纯“正文没来”或超时时间不足。

高可信源码解释（尚未内部状态插桩证明）：[VirtualTimeline.step](../app/src/client/chat/VirtualTimeline.tsx#L239) 第一次只同步写游标并 setReveal，`positioning=true` 要等 layout effect；第二次同任务点击可能尚未识别待提交 reveal 的所有权，丢弃视口外的第一游标，重复选择第一目标。这是压力测试路径，不代表已测得真实鼠标双击一定复现，也不应靠延长超时规避。

第117行之后的归档、短交付和移动分支没有执行到，本测试仅先覆盖 reduced-motion 桌面路径。本轮不修复产品，故保留问题，后续任何涉及正文/滚动的改造应先把这项基线修正并补充真人输入时序。

## 五、证据与尚缺测量

本轮生产观察使用本机 Chrome、1440×900、2000模型合成配置、100条模拟会话消息；计数夹具使用本地临时原生会话。它们证明具体加载路径，不是用户当前设备/网络/真实数据的完整性能trace，也不能提供“优化收益百分比”或唯一瓶颈判断。

临时证据（`/tmp` 可能被系统清理）：

- [生产构建夹具](/tmp/axiom-switch-audit-prod.mjs)、[JSON结果](/tmp/axiom-switch-audit-prod.json)、[日志](/tmp/axiom-switch-audit-prod.log)
- [计数/索引夹具](/tmp/axiom-switch-audit-counts.mts)、[JSON结果](/tmp/axiom-switch-audit-counts.json)
- [导航复跑日志](/tmp/axiom-switch-audit-nav-rerun.log)、[失败几何](/tmp/axiom-switch-audit-nav-rerun/failure-0.json)、[截图](/tmp/axiom-switch-audit-nav-rerun/failure-0.png)
- [导航诊断日志](/tmp/axiom-switch-audit-nav-diagnostic.log)

既有浏览器检查可在 app 目录设置 `AXIOM_TEST_BROWSER='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'` 后执行 `npx tsx tests/<name>.check.ts`；导航复跑另设 `AXIOM_NAV_ARTIFACTS` 到持久临时目录。

如后续进入实施，先记录 click → select → 首个标题/壳 → 正文可读 → 权威同步的分段耗时；区分真实鼠标/键盘、冷/热缓存和首访/回访，至少覆盖移动端与目标WebView。只有这些数据才能决定固定等待、服务端读盘、传输、JS执行、渲染各占多少，避免把 Vite 开发模式首次编译或单项测试时间误当作生产瓶颈。
