# Axiom runtime / tools / resources：Pi 耦合只读审计

## 结论与边界

- 当前安装 `@earendil-works/pi-coding-agent` **1.1.0**（技能定位脚本实际解析）；Axiom 宿主拥有任务、能力选择、资源维护、记忆流水线及标题策略；Pi 拥有工具契约/原生工具、资源解析、扩展生命周期、会话 reload 与模型调用。
- 最强耦合不是 import 数量，而是 **私有 prompt bridge、resource-loader/package-manager bridge、MCP config/validation/OAuth bridge、SettingsStorage 原型补丁**，以及 Pi JSONL 消息/事件语义。纯宿主文件仍可能经 Agents/MemoryRunner/CapabilityRuntime 传递依赖。
- 只审计 `/Volumes/D_Work/axiom2/app/src` 当前工作树及安装依赖；不使用 test-results 下副本，不改项目源码/测试/配置/锁文件，不运行测试/模型/资源加载。唯一生成文件为本 `/tmp` 报告。定位命令仅执行技能自带 documentation-paths.mjs（退出0），其他 Python 仅读文件统计/写本报告。没有用 git reset/checkout/stash 或修改脏工作树。
- 以下是静态契约/入口证据，不证明运行连接、权限隔离、热重载成功或测试通过。为避免递归范围无限，Agents/worker/pool/integrations 只追踪关联接入点，不宣称全仓穷尽。

## 能力完整表

| 能力 | 宿主入口与证据行 | 原生依赖 / 接口 | 归属 | 语义、限制及抽象注意点 |
|---|---|---|---|---|
| 系统提示词生成/预览 | [server/axiom-prompt.ts:1–36](/Volumes/D_Work/axiom2/app/src/server/axiom-prompt.ts#L1) | pi-agent-core.AgentMessage；pi-ai.SystemMessage/getCurrentSystemMessage/getSystemMessageText；coding-agent.BuildSystemPromptOptions；私有 core/system-prompt.js | 混合：Pi 分节/差分，Axiom 品牌/文档处理 | 非 customPrompt 时仅替换默认 preamble、删除默认 docs；不覆盖不透明扩展 force prompt。 |
| 会话提示词桥接 | [server/axiom-prompt.ts:38–65](/Volumes/D_Work/axiom2/app/src/server/axiom-prompt.ts#L38) | AgentSession 私有 _baseSystemPromptOptions/_runSystemPromptOptions/_preparePromptAndToolLoadout；重定义 systemPrompt getter | Axiom 版本绑定适配 | WeakSet 幂等；先原生工具 loadout，再差分适配 sections；不支持 API 则拒绝。属于高耦合，不是公开 SDK 接口。 |
| 已安装资源只读发现 | [server/installed-resource-loader.ts:1–25](/Volumes/D_Work/axiom2/app/src/server/installed-resource-loader.ts#L1) | DefaultResourceLoader/DefaultPackageManager；反射 packageManager、私有 parseSource；替换 resolve/resolveExtensionSources | Axiom 安全策略 + Pi 发现语义 | resolve 缺包返回 skip；临时远程扩展被过滤，只保留 builtin: 与 local；加载发现不执行安装。不能等同于扩展运行沙箱。 |
| 资源目录/范围/包技能发现 | [server/resources.ts:188–260](/Volumes/D_Work/axiom2/app/src/server/resources.ts#L188) | SettingsManager.create / DefaultPackageManager.resolve(skip)/listConfiguredPackages / loadSkills | 混合：Axiom 目录/所有权，Pi 解析规则 | 应用 root/pi/settings.json；项目 .pi/settings.json；MCP 全局来自 sharedPiDir（models.dir），项目 .pi/mcp.json。不要把 app piDir 与共享 modelDir 混为一处。 |
| 资源管理命令 | [server/resources.ts:520–624](/Volumes/D_Work/axiom2/app/src/server/resources.ts#L520) | Axiom Command/ResourceState/ResourceJob；依赖 Pi 包和技能接口 | Axiom 管理面，不是模型工具 | resources.get/detail/install/update/remove/rename/save/move/copy；revision、授权、作用范围、并发资源键、内置只读、清理确认。异步作业入队后返回 acceptedJobId，成功提示已有会话需重载。 |
| 资源显式安装/更新 | [server/resources.ts:788–829](/Volumes/D_Work/axiom2/app/src/server/resources.ts#L788)；[server/resources.ts:1159–1291](/Volumes/D_Work/axiom2/app/src/server/resources.ts#L1159) | runPiPackage；loadSkills；私有 validateMcpServerConfig | 混合 | Pi 包仅 npm:/git:；独立 npm skill/MCP 安装 --ignore-scripts/--no-audit/--no-fund，独立缓存；本地技能复制 50 MB/10000 项，拒绝链接；MCP bin 校验、命名空间冲突、项目 auth 限制。此为审计对象能力，本审计未执行安装。 |
| 资源改名/编辑/移动/卸载 | [server/resources.ts:659–787](/Volumes/D_Work/axiom2/app/src/server/resources.ts#L659)；[server/resources.ts:920–1158](/Volumes/D_Work/axiom2/app/src/server/resources.ts#L920)；[server/resources.ts:1318–1396](/Volumes/D_Work/axiom2/app/src/server/resources.ts#L1318) | loadSkills；Pi 风格 settings/mcp JSON；Axiom 锁/补偿/引用更新 | Axiom 生命周期/所有权 | 移动复制限独立项目↔全局；共享/排除/同名需验证；默认偏好和选择按身份迁移；历史消息/运行快照不重写；不能宣称跨 SQLite 与文件系统是统一原子事务，存在补偿失败提示。 |
| MCP 配置/凭据私有桥 | [server/resources.ts:26–32](/Volumes/D_Work/axiom2/app/src/server/resources.ts#L26)；[server/resources.ts:1292–1316](/Volumes/D_Work/axiom2/app/src/server/resources.ts#L1292) | core/mcp-servers.js.validateMcpServerConfig；core/auth-storage.js.FileAuthStorageBackend；extensions/mcp/oauth.js.McpOAuthCredentialStore | Pi 原生验证/OAuth + Axiom 管理 | 以 server namespace + URL 身份共享 mcp-auth.json；移除凭据需显式选项且保留其他引用；重命名同步凭据键。 |
| 配置脱敏投影/恢复 | [server/resource-config.ts:1–36](/Volumes/D_Work/axiom2/app/src/server/resource-config.ts#L1) | 无直接 Pi 依赖；通用 JSON | Axiom | token/key/credential、env、headers、全部 args、含认证或 query/hash URL 字符串脱敏；占位符只能恢复 revision 绑定原对象的同一路径。 |
| 跨宿主配置/路径互斥 | [server/resource-file-lock.ts:1–57](/Volumes/D_Work/axiom2/app/src/server/resource-file-lock.ts#L1) | node:sqlite DatabaseSync；BEGIN IMMEDIATE | Axiom | 永久锁文件位于共享配置旁；规范化真实父路径、排序拿锁、拒绝链接，busy_timeout=0；OS 退出释放，不按时间抢活锁。 |
| npm 崩溃恢复日志 | [server/resource-npm-operation.ts:7–118](/Volumes/D_Work/axiom2/app/src/server/resource-npm-operation.ts#L7) | Axiom 物理锁 + fsync/目录 dev/ino；无 Pi 直接依赖 | Axiom | running→ready、not-started/tree-cleaned 证明；generation/domain/identity 校验；不确定时 retainUnknown 保留目录/阻止重复维护。 |
| 能力引用变更 | [server/resource-references.ts:5–47](/Volumes/D_Work/axiom2/app/src/server/resource-references.ts#L5) | Store/CapabilityItem/CapabilitySelection | Axiom | 按类型+名称+resolve(source) 身份改偏好/会话选择/目录；同名其他来源不动；调用方负责事务。 |
| 会话能力状态与锁定 | [server/capabilities.ts:6–80](/Volumes/D_Work/axiom2/app/src/server/capabilities.ts#L6)；[server/capabilities.ts:124–172](/Volumes/D_Work/axiom2/app/src/server/capabilities.ts#L124) | Store SQLite；discoverCapabilities/capabilityRuntime（间接 Pi） | Axiom | 全局 defaults 与每会话 revision、legacy、selection/catalog；旧会话 skills=null、mcp=[]，升级不会自动连 MCP；首轮 admission 锁选择。 |
| 能力准备/应用并重载 | [server/capabilities.ts:82–122](/Volumes/D_Work/axiom2/app/src/server/capabilities.ts#L82)；[server/capabilities.ts:146–236](/Volumes/D_Work/axiom2/app/src/server/capabilities.ts#L146) | CapabilityPlan/CapabilityRuntime；AppError/Command | Axiom | 目录 hash、偏好/会话 revision 冲突检查；失效资源和必需不可读文件拒绝；成功原生重载才 commit 选择；get/save/defaults.save。 |
| 能力共享 DTO | [shared/capabilities.ts:1–39](/Volumes/D_Work/axiom2/app/src/shared/capabilities.ts#L1)；[shared/resources.ts:1–52](/Volumes/D_Work/axiom2/app/src/shared/resources.ts#L1) | 无 Pi import；但 source/path、MCP/Skill 语义源自 Pi | Axiom 协议层 | skills=null 表 legacy；skills 选择仅自动发现，显式使用仍允许；MCP 选择表示要连接的 servers；ResourceState 不是连接成功状态。 |
| 能力目录发现（关联入口） | [server/capability-resources.ts:1–125](/Volumes/D_Work/axiom2/app/src/server/capability-resources.ts#L1) | SettingsManager/DefaultPackageManager/loadSkills；私有 extensions/mcp/config.js.loadMcpConfig | 混合、高语义耦合 | 发现不执行扩展、不安装包；共享 skills 补扫保留排除规则；内置 OpenCLI/REA 优先；Pi projectTrusted:true；mcp 配置错误仅摘要，防止泄露片段/URL/凭据。 |
| 运行时能力解析（关联入口） | [server/capability-resources.ts:128–139](/Volumes/D_Work/axiom2/app/src/server/capability-resources.ts#L128)；[server/environment-resources.ts:20–47](/Volumes/D_Work/axiom2/app/src/server/environment-resources.ts#L20) | CapabilityRuntime → loader.skillsOverride/loadSkills | 混合 | 保留全部有效技能供 /skill:name/结构化引用；disableModelInvocation 根据自动选择设置；MCP 仅 selected servers，enabled=true。 |
| MCP/Codemode/Tool Search 工厂 | [server/capability-resources.ts:140–166](/Volumes/D_Work/axiom2/app/src/server/capability-resources.ts#L140) | createCodemodeExtension({mode:on})/createToolSearchExtension/createMcpExtension；ExtensionFactory/McpExtensionOptions | Pi 原生执行 + Axiom 选择/传输/REA 策略 | 无所选 MCP 时不启用这组工厂；reload 重跑工厂并读取 mutable runtime；getMcpServers 被置空，registerCommand 被忽略，updateConfig 拒绝（要求面板），不应说已完整暴露原生 /mcp 或扩展 registerMcpServer 接入。 |
| MCP 宿主传输（关联入口） | [server/integrations/model-proxy-tools.ts:1–67](/Volumes/D_Work/axiom2/app/src/server/integrations/model-proxy-tools.ts#L1) | @earendil-works/pi-mcp.StdioTransport/StreamableHttpTransport；coding-agent.getShellConfig；undici | 混合 | 工具代理环境与模型代理隔离；env/header 支持 $ 变量和 !command（实际可执行 shell）；HTTP dispatcher；REA 已解析值走 literal 分支。 |
| 执行资源/提示词追加 | [server/environment-resources.ts:20–47](/Volumes/D_Work/axiom2/app/src/server/environment-resources.ts#L20) | DefaultResourceLoaderOptions.skillsOverride/appendSystemPromptOverride | Axiom 策略注入 Pi | 加文件 Markdown 链接、记忆使用说明、主代理委派工作流或子代理 policy；SYSTEM/APPEND/AGENTS/模板等基础发现归 Pi loader。 |
| 无会话环境预览 | [server/session-environment.ts:49–96](/Volumes/D_Work/axiom2/app/src/server/session-environment.ts#L49) | DefaultResourceLoader/SettingsManager.fromStorage/8 个 create*ToolDefinition/buildAxiomSystemPrompt | 混合 | packages=[]，noExtensions/noPromptTemplates/noThemes；不建 session、不开 MCP、不推理；工具为静态预览，明确动态扩展/MCP 需实际加载后更新。 |
| 运行时环境声明 | [server/session-environment.ts:22–46](/Volumes/D_Work/axiom2/app/src/server/session-environment.ts#L22) | AgentSession.getActiveToolNames/getAllTools/resourceLoader/settingsManager | 混合 | 输出有效 systemPrompt、active tools 名称/description/parameters、skills、MCP 名称/来源、retry/warnings；不输出 MCP command/args/env/header/URL；不完整暴露 native exposure/annotations/outputSchema。 |
| 资源快照/诊断 | [server/reload-resources.ts:1–37](/Volumes/D_Work/axiom2/app/src/server/reload-resources.ts#L1) | AgentSession.resourceLoader/getAllTools/getActiveToolNames/settingsManager | 混合 | 7 类：skills/extensions/prompts/themes/instructions/tools/settings；sha256，只输出名字/摘要；MCP config hash 并入 settings；工具 hash 包含 description/parameters/active。不是完整 tool contract hash（未含 outputSchema/exposure 等）。 |
| 热重载调用/安全点 | [server/agent-worker.ts:230–276](/Volumes/D_Work/axiom2/app/src/server/agent-worker.ts#L230)；[server/session-reloads.ts:17–174](/Volumes/D_Work/axiom2/app/src/server/session-reloads.ts#L17) | AgentSession.reload；Pi lifecycle / safe-point + Axiom job/IPC | 混合 | 热会话等待自有安全点、暂停当前请求，prepareReload 后 native reload；skills-only 可仅更新发现；120s 超时停止；失败明示旧扩展不保证可继续；状态/baseline 仅成功更新。 |
| 冷重载（关联入口） | [server/session-reloads.ts:182–251](/Volumes/D_Work/axiom2/app/src/server/session-reloads.ts#L182) | SessionManager/create；ExecutionPool.acquire/ensureReady；WorkerInput.reloadId | 混合 | 无人工聊天 run/无模型请求，但确实创建/绑定原生 session、执行扩展，可能连 MCP；cold ≠ 纯只读预览。 |
| 资源身份/池复用补充 | [server/agents/resource-identity.ts:95–240](/Volumes/D_Work/axiom2/app/src/server/agents/resource-identity.ts#L95) | node fs/hash + built-in integrations；间接 axiom-prompt | Axiom | AGENTS/SYSTEM/APPEND/extensions/skills/prompts；沿祖先 .pi 扫描；5000项、1MiB/文件、8 并发读取，拒绝链接，before/after/final 元数据复核；代码明确不是原子 FS snapshot。与热重载 ResourceSnapshot 不同用途。 |
| 设置文件并发补丁（关联入口） | [server/pi-settings-storage.ts:6–76](/Volumes/D_Work/axiom2/app/src/server/pi-settings-storage.ts#L6) | 私有 core/settings-manager.js.FileSettingsStorage.prototype.withLock/acquireLockSyncWithRetry；proper-lockfile | Axiom 对 Pi 1.1.0 monkey patch | 严格 metadata.version===1.1.0；首次写也先锁后读；原型补丁对应用进程全局生效；外部未补丁 Pi 进程不在保证内，是独立高风险升级边界。 |
| 宿主任务工具定义 | [server/task-tools.ts:1–89](/Volumes/D_Work/axiom2/app/src/server/task-tools.ts#L1) | coding-agent.defineTool；TypeBox Type.Object/String/Array/Optional | Axiom 业务，Pi 工具契约 | 4工具 delegate/append/cancel_task/read_result；additionalProperties:false；execute(id,params,signal) → call→content text(JSON projection)+details 完整返回；未声明 outputSchema/structuredContent。 |
| 宿主记忆工具定义 | [server/memory-tool.ts:1–39](/Volumes/D_Work/axiom2/app/src/server/memory-tool.ts#L1) | defineTool + TypeBox；MemoryQueryResult | Axiom 业务，Pi 工具契约 | memory_query({question:string minLength:1})；content 只含答案/未完成原因，details 留审计元数据；无源路径/revision 元数据拼入模型内容；未声明 outputSchema。 |
| 工具 IPC 端到端 | [server/agent-worker.ts:447–474](/Volumes/D_Work/axiom2/app/src/server/agent-worker.ts#L447)；[server/tasks.ts:103–149](/Volumes/D_Work/axiom2/app/src/server/tasks.ts#L103)；[server/agents.ts:236–257](/Volumes/D_Work/axiom2/app/src/server/agents.ts#L236) | AbortSignal；task-call/memory-call/task-reply；Pi customTools | Axiom | worker 不直接执行业务；key/run/call id 绑定宿主回执；memory-cancel 终止查询；主会话 customTools=4任务+1记忆，子会话 customTools=[]。 |
| 任务门面/接入 | [server/tasks.ts:16–58](/Volumes/D_Work/axiom2/app/src/server/tasks.ts#L16)；[server/tasks/commands.ts:27–117](/Volumes/D_Work/axiom2/app/src/server/tasks/commands.ts#L27) | Agents/TaskRecords/TaskScheduler/TaskDelivery；无直接 Pi import | Axiom 编排层 | 任务是 Axiom 自建，不是 Pi 内置子代理；user/model 命令共用校验和外部请求幂等回执；子会话递归管理直接拒绝。 |
| 委派限额与 schema 差异 | [server/task-tools.ts:25–65](/Volumes/D_Work/axiom2/app/src/server/task-tools.ts#L25)；[server/tasks/commands.ts:117–185](/Volumes/D_Work/axiom2/app/src/server/tasks/commands.ts#L117) | Axiom 参数校验/SQLite 容量，间接 Pi AgentSession | Axiom | 一次1–8，父会话活动/排队≤32；title≤30；task/context≤12000。描述要求 context≤200 但未在 schema maxLength/服务校验落实；append 描述summary≤30，服务 brief 上限40。报告≤2000也是 policy，不是存储截断。 |
| 子任务预算/并发 | [shared/tasks.ts:16–23](/Volumes/D_Work/axiom2/app/src/shared/tasks.ts#L16)；[server/tasks/commands.ts:183–215](/Volumes/D_Work/axiom2/app/src/server/tasks/commands.ts#L183)；[server/tasks/scheduler.ts:360–394](/Volumes/D_Work/axiom2/app/src/server/tasks/scheduler.ts#L360)；[server/tasks/scheduler.ts:520–574](/Volumes/D_Work/axiom2/app/src/server/tasks/scheduler.ts#L520) | Axiom SQLite/计时器/ExecutionPool admission；task-budget.ts | Axiom | 默认全局并发4/工作600000ms；设置 concurrency1–16、workMs1000–86400000；FIFO 启动；到期转无工具总结，180000ms 强停；追加明确新要求可重置工作时钟（scheduler:227–229），恢复保留原截止时间。 |
| 子任务执行权限 | [server/agent-worker.ts:81–91](/Volumes/D_Work/axiom2/app/src/server/agent-worker.ts#L81)；[server/agent-worker.ts:769–826](/Volumes/D_Work/axiom2/app/src/server/agent-worker.ts#L769)；[server/agent-worker.ts:889–904](/Volumes/D_Work/axiom2/app/src/server/agent-worker.ts#L889) | 原生 read/grep/find/ls/bash 或 powershell；SettingsManager.fromStorage；noExtensions/noPromptTemplates | Axiom 强工具门 + 自然语言政策 | 硬限制：allowlist、tool_call 拦截、summary 不允许任何工具、无 task/memory/MCP custom tools、packages=[]；软限制：shell 仍有宿主 OS 权限，禁止写源码/装依赖主要靠 policy，非文件系统沙箱/不可证明副作用隔离。 |
| 任务独立入场 | [server/tasks/admission.ts:1–37](/Volumes/D_Work/axiom2/app/src/server/tasks/admission.ts#L1) | AbortSignal/Promise 队列；无 Pi import | Axiom | 允许并行准备，只序列化同步 pool enqueue；等待 lease/writer 时不占 turn，避免资源死锁。 |
| 任务持久关系/输入队列 | [server/tasks/records.ts:39–105](/Volumes/D_Work/axiom2/app/src/server/tasks/records.ts#L39)；[server/tasks/records.ts:197–358](/Volumes/D_Work/axiom2/app/src/server/tasks/records.ts#L197) | Store SQLite；Run/Selection（宿主DTO） | Axiom | 子会话单独 sessions/agent_sessions；初始 body 仅显式 context/task，不继承主代理历史；持久 tN/rN 别名，真实 UUID 仍作所有权检查；receipt 防重放；只有 proven binding rejection 才允许原始输入重试。 |
| 任务追加/恢复/取消 | [server/tasks/scheduler.ts:186–315](/Volumes/D_Work/axiom2/app/src/server/tasks/scheduler.ts#L186)；[server/tasks/scheduler.ts:576–678](/Volumes/D_Work/axiom2/app/src/server/tasks/scheduler.ts#L576) | Agents.command/signal/stop；TaskRecords/TaskDelivery | Axiom 调度，底层 Pi 会话 | 仅 steer，待处理输入≤32；finished 可重新排队；恢复队列保留身份；父会话 stop/freeze、provider/退出取消；不能把追加当轮询。 |
| 任务结果/通知/转录读取 | [server/tasks/delivery.ts:83–189](/Volumes/D_Work/axiom2/app/src/server/tasks/delivery.ts#L83)；[server/tasks/delivery.ts:190–279](/Volumes/D_Work/axiom2/app/src/server/tasks/delivery.ts#L190) | Pi SessionManager 类型/getEntries；openTranscript；native role/stopReason/custom_message 分支 | Axiom 交付层 + Pi 转录语义 | final=completed 且最后 assistant.stopReason=stop；否则 partial/system；完整结果 immutable 保存，read_result(taskId,resultId)精确归属；通知只带refs/status，实际结果另读；交付 receipts/JSONL 标记协调 unknown 防重复请求。 |
| 模型结果投影/显示分离 | [shared/task-output.ts:1–21](/Volumes/D_Work/axiom2/app/src/shared/task-output.ts#L1)；[server/task-output.ts:1–11](/Volumes/D_Work/axiom2/app/src/server/task-output.ts#L1) | TaskResult/TaskTool；无 Pi import | Axiom | delegate content仅短taskRefs/status；append/cancel仅status；read_result投影report/outcome/unfinished/stop；UI用details原契约，持久报告不按2000截断。 |
| 记忆/标题共享后台执行器 | [server/memory-runner.ts:54–105](/Volumes/D_Work/axiom2/app/src/server/memory-runner.ts#L54) | MemoryRunner/MemoryExecution；ExecutionProfiles/ExecutionPool；ModelService（间接 Pi） | Axiom 资源编排 | query/organize/title 使用共享物理池，租约隔离；含排队总 deadline；owner 复核；query 可带 parentLease；无直接 Pi import 不代表无 Pi 依赖。 |
| 记忆配置 fingerprint / IPC | [server/memory-runner.ts:27–52](/Volumes/D_Work/axiom2/app/src/server/memory-runner.ts#L27)；[server/memory-runner.ts:106–167](/Volumes/D_Work/axiom2/app/src/server/memory-runner.ts#L106) | models/auth/models-store；sameLease；memory_usage；MemoryExecutionResult | Axiom | 配置按所选供应商/模型内容计算；使用量在取消后仍归原租约；completed 后必须 cleaned clean=true 才 release；read/revision IPC直接拒绝；provider 停用需确认，未确认不杀后台工作。 |
| 后台原生单次推理 | [server/memory-worker.ts:16–34](/Volumes/D_Work/axiom2/app/src/server/memory-worker.ts#L16)；[server/memory-worker.ts:56–110](/Volumes/D_Work/axiom2/app/src/server/memory-worker.ts#L56) | coding-agent.ModelRuntime；pi-ai.cleanupSessionResources/getSupportedThinkingLevels；runtime.completeSimple | Pi 模型执行 + Axiom 输入/预算/拒绝策略 | 不是 AgentSession，不加载工具/扩展/技能；每请求新完整 Context（systemPrompt+单 user）；复用仅transportId；websocket/short cache/maxRetries:0；错误/abort失败，429标retryable；toolCall拒绝；长度/不完整显式标记，organize不截断发布。 |
| 记忆组织流水线 | [server/memory-pipeline.ts:17–162](/Volumes/D_Work/axiom2/app/src/server/memory-pipeline.ts#L17) | Memories/MemoryTreeStore/MemoryRunner；无直接 Pi import | Axiom 算法/持久化 | 读取完整文本、revision+actual path校验；purpose定位、claim、tree snapshot、阈值重整；仅目录文本+原标题进入模型，bindings只留审计；最终复核来源后原子发布，无效目的挂起。 |
| 记忆查询流水线 | [server/memory-pipeline.ts:163–257](/Volumes/D_Work/axiom2/app/src/server/memory-pipeline.ts#L163) | MemoryRunner.execute→Pi completeSimple；projectMemoryTree/MemoryDocumentRef | Axiom 算法 | 一次捕获目录及引用→全树一次匹配→程序扩展后代→批量全文与链接→归纳→权限/纠正复核；文本-only，未绑定 details 链接拒绝；模型无任意文件 read。 |
| 后台标题生成 | [server/session-titles.ts:11–210](/Volumes/D_Work/axiom2/app/src/server/session-titles.ts#L11)；[server/agents.ts:215–262](/Volumes/D_Work/axiom2/app/src/server/agents.ts#L215) | Memories.runner.execute(kind:title)→Pi ModelRuntime；Store.generatedTitle | Axiom 元数据服务 | 主请求每3次及完成检查，最多3次实际尝试；优先 MEMORY/details，无有效记忆则首用户run起30秒后早期正文回退；资料≤128000 chars、deadline30s；标题≤13 Unicode点；best-effort 不改主会话history，不阻塞主run，失败可审计。 |
| 标题标记/显示投影 | [server/session-title.ts:1–44](/Volumes/D_Work/axiom2/app/src/server/session-title.ts#L1) | 纯字符串/Unicode；无 Pi import | Axiom | validSessionTitle≤13点；首非空行<title>标记抽取≤10点；流式不完整标记暂隐；strip 只显示，不回写 Pi history。与后台13点纯文本标题是两条路径。 |

## 原生工具与宿主工具 schema / result 对照

主会话并非固定13个 active tools：8个原生工具是可注册目录，通常默认 Unix read/bash/edit/write，Windows read/powershell/edit/write，另加5个宿主工具；settings/扩展/MCP 会动态改变有效声明。子代理实际仅5个 allowlist 工具（平台shell择一）。

| 工具 | 输入 schema（?可选） | 执行/结果契约 | 证据 |
|---|---|---|---|
| read | path:string, offset?:number, limit?:number | text/image content；有 outputSchema 与 structuredContent（string 或 image描述）；details 可携 truncation | [dist/core/tools/read.js:10–29,57,178](/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-coding-agent/dist/core/tools/read.js#L10) |
| bash | command:string, timeout?:number | content+details；structuredContent={output,truncated,full_output_path?,exit_code,wall_time_seconds}；outputSchema；大输出尾部截断与临时全文路径 | [dist/core/tools/bash.js:28–45,286–303](/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-coding-agent/dist/core/tools/bash.js#L28) |
| powershell | 同 bash | 复用 createShellToolDefinition；UTF8 prefix、独立 PowerShell operations | [dist/core/tools/powershell.js:1–27](/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-coding-agent/dist/core/tools/powershell.js#L1) |
| edit | path:string, edits:Array<{oldText:string,newText:string}> | 精确多段替换；默认文件 mutation queue；兼容单次旧参数转换 prepareArguments；Axiom 覆盖 operations 保护记忆 | [dist/core/tools/edit.js:10–21,38–45](/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-coding-agent/dist/core/tools/edit.js#L10) |
| write | path:string, content:string | 原生 write operations；Axiom 覆盖记忆 operations | [dist/core/tools/write.js:8–11](/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-coding-agent/dist/core/tools/write.js#L8) |
| grep | pattern:string, path?,glob?:string,ignoreCase?,literal?:boolean,context?,limit?:number | 原生搜索/截断 details；respect gitignore | [dist/core/tools/grep.js:11–19](/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-coding-agent/dist/core/tools/grep.js#L11) |
| find | pattern:string,path?:string,limit?:number | 原生 glob 搜索结果 | [dist/core/tools/find.js:17–23](/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-coding-agent/dist/core/tools/find.js#L17) |
| ls | path?:string,limit?:number | 原生目录列表 | [dist/core/tools/ls.js:8–11](/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-coding-agent/dist/core/tools/ls.js#L8) |
| delegate | context:string,tasks:Array<{title:string,task:string}>；均additionalProperties:false | content JSON只有taskIds（短ref）/status，details保留budgets/UUID等 | [server/task-tools.ts:25–45](/Volumes/D_Work/axiom2/app/src/server/task-tools.ts#L25)；[shared/task-output.ts:4–7](/Volumes/D_Work/axiom2/app/src/shared/task-output.ts#L4) |
| append | taskId,summary,text:string；additionalProperties:false | content仅status，details完整收据 | [server/task-tools.ts:46–60](/Volumes/D_Work/axiom2/app/src/server/task-tools.ts#L46) |
| cancel_task | taskId:string,reason?:string；additionalProperties:false | content仅status，details完整 | [server/task-tools.ts:61–74](/Volumes/D_Work/axiom2/app/src/server/task-tools.ts#L61) |
| read_result | taskId,resultId:string；additionalProperties:false | content结果投影，details完整TaskResult；读取确定版本不是“最新/进度” | [server/task-tools.ts:75–87](/Volumes/D_Work/axiom2/app/src/server/task-tools.ts#L75)；[server/tasks/delivery.ts:173–189](/Volumes/D_Work/axiom2/app/src/server/tasks/delivery.ts#L173) |
| memory_query | question:string,minLength:1；additionalProperties:false | content答案/未完成原因，details完整MemoryQueryResult | [server/memory-tool.ts:30–39](/Volumes/D_Work/axiom2/app/src/server/memory-tool.ts#L30) |

原生通用契约证据：[dist/core/extensions/types.d.ts:448–521](/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts#L448)；[AgentToolResult](/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-agent-core/dist/types.d.ts#L370)。`ToolDefinition` 含 parameters(TypeBox)、execute(toolCallId,params,signal,onUpdate,ctx)、outputSchema、exposure、namespace、annotations、defaultActive、prepareLoadout、executionMode；`AgentToolResult` 含 content(text/image)、details、structuredContent?、usage?、isError?、terminate?。宿主5工具当前只用子集，建议抽象接口别丢掉可编程结构化结果/增量更新/错误/usage/嵌套调用元数据。

## MCP / extensions 的代码位置及原生能力归属

| 层/目录 | 证据位置 | 责任与边界 |
|---|---|---|
| Axiom（没有独立 src/extensions 或 src/mcp 目录） | [server/capability-resources.ts:140–166](/Volumes/D_Work/axiom2/app/src/server/capability-resources.ts#L140)；[server/integrations/model-proxy-tools.ts:1–67](/Volumes/D_Work/axiom2/app/src/server/integrations/model-proxy-tools.ts#L1) | MCP 在 capability-resources 的 inline factories 和 integrations 传输实现；worker 统一注册生命周期/权限 hooks；资源面板在 resources.ts。 |
| Pi 扩展运行时 | [dist/core/extensions/types.d.ts:448–521](/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts#L448)；[dist/core/extensions](/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions) | native ExtensionAPI/runner/loader/types：hooks、工具/命令/provider 注册、上下文变换、session lifecycle。任意JS扩展具有宿主OS权限，不是 sandbox。 |
| Pi 内置 MCP 扩展 | [dist/extensions/mcp/index.js:968–1118](/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/index.js#L968)；[MCP目录](/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp) | session_start后台连接、before_agent_start拼mcp_servers提示、session_shutdown断连；tools.js schema/results/命名；resources.js list/read resources；config.js merge；oauth.js凭据；runtime.js/懒加载 runtime。 |
| Pi MCP 验证及传输 | [dist/core/mcp-servers.js:1](/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-coding-agent/dist/core/mcp-servers.js#L1)；[@earendil-works/pi-mcp](/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-mcp) | stdio/streamable HTTP、protocol/OAuth基础；Axiom使用公开transport factory覆盖代理/env策略，不自行重写协议。 |
| Codemode / Tool Search | [dist/extensions/codemode](/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-coding-agent/dist/extensions/codemode)；[dist/extensions/tool-search](/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-coding-agent/dist/extensions/tool-search) | Pi原生执行/工具检索/动态声明；MCP direct/codemode/deferred/hidden曝光、嵌套调用工具hook及结构化CallToolResult语义归Pi。Axiom仅有选择工厂与REA包装。 |
| 文档校验（均完整读取） | [README](/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-coding-agent/README.md)、[SDK](/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-coding-agent/docs/sdk.md)、[extensions](/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md)、[MCP](/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-coding-agent/docs/mcp.md) | SDK不会自动加载CLI内置MCP/Codemode/Search，需extensionFactories+bindExtensions；支持stdio/HTTP，不支持legacy SSE；MCP还支持resource tools，不能仅统计mcp__业务工具。以上文档能力不代表Axiom面板全部暴露。 |

## 建议抽象接口能力（建议，并非现有实现）

| 接口边界 | 应保持的能力 | Pi 适配层内部保留 / 避免泄漏 |
|---|---|---|
| ToolCatalog / ToolExecutor | id/name/schema、input normalization、direct/deferred/hidden/codemode、namespace/annotations、active/registered区分、AbortSignal/增量、content/details/structured result/error/usage、nested call lineage | TypeBox→通用JSON schema适配；Pi ToolDefinition/AgentToolResult 与生命周期事件转通用DTO；不能只抽 name+description+params。 |
| ResourceCatalog / ResourceRuntime | scope/source/identity/version/digest、发现与显式安装分离、诊断、技能自动发现与显式使用区别、预览与真实环境区别、settings/instructions/prompts/themes/extensions | DefaultPackageManager/DefaultResourceLoader/SettingsManager、MCP config 私有导入、项目trust和precedence由Pi adapter统一处理。 |
| PromptComposer | base/custom/append/context/skills/tools/native sections、force覆盖、预览和执行一致、增量prompt声明 | 私有_build/prepare/diff桥集中、版本能力探测；禁止业务层读 _baseSystemPromptOptions。 |
| ExtensionHost / McpGateway | lifecycle/shutdown、工具/命令/provider/hooks、连接状态/exposure/resource tools/OAuth/代理/env、policy与权限、可重载工厂 | 明示Axiom禁用了getMcpServers与MCP registerCommand/updateConfig的部分原生通路；沙箱/授权不能以“hook”替代。 |
| ResourceReload | 安全点/暂停恢复、冷/热/skills-only、revision乐观提交、before-after/warnings、deadline/cancel、失败不可保证旧runtime继续 | AgentSession.reload/bindExtensions和native session创建由adapter完成；业务只消费状态机。 |
| TaskService | 显式背景/任务、持久refs/所有权、幂等回执、并发/FIFO/预算、append/cancel/read immutable result、通知deliveries、无工具summary | Pi仅提供会话/工具/转录事件；子代理为Axiom业务，不能封成“Pi native delegate”。 |
| BackgroundInference / MemoryPipeline / TitleService | 单次complete完整Context、模型/思考精确选择、deadline/parent lease/usage/cleanup/无工具契约；记忆snapshot来源校验；标题best-effort/不改history | ModelRuntime/pi-ai清理、transport identity复用仅留adapter；记忆/标题算法本身无需依赖Pi会话。 |

## 优先风险 / 未验证

1. **升级敏感 P0**：提示词私有方法/section渲染、loader.packageManager/parseSource、MCP config/validation/OAuth、FileSettingsStorage 原型补丁。应统一为版本绑定 adapter，并给发现/预览/重载/并发写入建立契约校验（本次未运行）。
2. **权限表述 P0**：子代理工具 allowlist 和无外部扩展是硬门，但 bash/powershell 不是只读沙箱；禁止源码写入/装依赖及2000字符报告是提示政策。额外要求不能越权属于policy，不等于OS阻断。
3. **契约完整性 P1**：当前环境 toolDefinitions 和 snapshot 只收部分字段；若作为跨engine抽象，需保留 outputSchema/exposure/annotations/namespace/usage/isError 与动态 callable vs declared 差异。
4. **静态约束差异 P1**：delegate context描述≤200但服务≤12000；append summary描述≤30但服务≤40；报告建议≤2000而保存完整不截断。审计不推断为漏洞，需产品确定是提示建议还是硬限制。
5. **状态/隔离 P1**：selected MCP ≠ connected；预览≠执行；冷reload会执行扩展但不调用模型；同名同URL OAuth跨项目共享。`projectTrusted:true` 由宿主授权前提承担，不是Pi交互信任询问。
6. 未执行任何测试、模型、MCP连接、扩展运行、安装、热/冷reload或并发验证；未给现有脏工作树做清理。行为结论均为代码静态推导。

## 指定文件范围静态统计（不等于全仓Pi耦合统计）

直接出现 `@earendil-works/` 的文件数只统计显式源码字符串，不把“无直接引用”当作“解耦”。

| 文件 | 行数 | 直接Pi引用行 | 归属判定 |
|---|---:|---|---|
| [server/agents/resource-identity.ts:1](/Volumes/D_Work/axiom2/app/src/server/agents/resource-identity.ts#L1) | 222 | 无；见能力表的间接边界 | Axiom业务/协议/策略；可能间接依赖Pi |
| [server/axiom-prompt.ts:1](/Volumes/D_Work/axiom2/app/src/server/axiom-prompt.ts#L1) | 65 | 2, 3, 4, 12 | Pi契约/适配或转录边界 |
| [server/capabilities.ts:1](/Volumes/D_Work/axiom2/app/src/server/capabilities.ts#L1) | 236 | 无；见能力表的间接边界 | Axiom业务/协议/策略；可能间接依赖Pi |
| [server/installed-resource-loader.ts:1](/Volumes/D_Work/axiom2/app/src/server/installed-resource-loader.ts#L1) | 25 | 1 | Pi契约/适配或转录边界 |
| [server/memory-pipeline.ts:1](/Volumes/D_Work/axiom2/app/src/server/memory-pipeline.ts#L1) | 257 | 无；见能力表的间接边界 | Axiom业务/协议/策略；可能间接依赖Pi |
| [server/memory-runner.ts:1](/Volumes/D_Work/axiom2/app/src/server/memory-runner.ts#L1) | 170 | 无；见能力表的间接边界 | Axiom业务/协议/策略；可能间接依赖Pi |
| [server/memory-tool.ts:1](/Volumes/D_Work/axiom2/app/src/server/memory-tool.ts#L1) | 39 | 1 | Pi契约/适配或转录边界 |
| [server/memory-worker.ts:1](/Volumes/D_Work/axiom2/app/src/server/memory-worker.ts#L1) | 110 | 2, 4 | Pi契约/适配或转录边界 |
| [server/reload-resources.ts:1](/Volumes/D_Work/axiom2/app/src/server/reload-resources.ts#L1) | 37 | 3 | Pi契约/适配或转录边界 |
| [server/resource-config.ts:1](/Volumes/D_Work/axiom2/app/src/server/resource-config.ts#L1) | 36 | 无；见能力表的间接边界 | Axiom业务/协议/策略；可能间接依赖Pi |
| [server/resource-file-lock.ts:1](/Volumes/D_Work/axiom2/app/src/server/resource-file-lock.ts#L1) | 57 | 无；见能力表的间接边界 | Axiom业务/协议/策略；可能间接依赖Pi |
| [server/resource-npm-operation.ts:1](/Volumes/D_Work/axiom2/app/src/server/resource-npm-operation.ts#L1) | 118 | 无；见能力表的间接边界 | Axiom业务/协议/策略；可能间接依赖Pi |
| [server/resource-references.ts:1](/Volumes/D_Work/axiom2/app/src/server/resource-references.ts#L1) | 47 | 无；见能力表的间接边界 | Axiom业务/协议/策略；可能间接依赖Pi |
| [server/resources.ts:1](/Volumes/D_Work/axiom2/app/src/server/resources.ts#L1) | 1396 | 9, 28 | Pi契约/适配或转录边界 |
| [server/session-title.ts:1](/Volumes/D_Work/axiom2/app/src/server/session-title.ts#L1) | 44 | 无；见能力表的间接边界 | Axiom业务/协议/策略；可能间接依赖Pi |
| [server/session-titles.ts:1](/Volumes/D_Work/axiom2/app/src/server/session-titles.ts#L1) | 210 | 无；见能力表的间接边界 | Axiom业务/协议/策略；可能间接依赖Pi |
| [server/task-tools.ts:1](/Volumes/D_Work/axiom2/app/src/server/task-tools.ts#L1) | 89 | 2 | Pi契约/适配或转录边界 |
| [server/tasks/admission.ts:1](/Volumes/D_Work/axiom2/app/src/server/tasks/admission.ts#L1) | 37 | 无；见能力表的间接边界 | Axiom业务/协议/策略；可能间接依赖Pi |
| [server/tasks/commands.ts:1](/Volumes/D_Work/axiom2/app/src/server/tasks/commands.ts#L1) | 316 | 无；见能力表的间接边界 | Axiom业务/协议/策略；可能间接依赖Pi |
| [server/tasks/delivery.ts:1](/Volumes/D_Work/axiom2/app/src/server/tasks/delivery.ts#L1) | 280 | 3 | Pi契约/适配或转录边界 |
| [server/tasks/records.ts:1](/Volumes/D_Work/axiom2/app/src/server/tasks/records.ts#L1) | 358 | 无；见能力表的间接边界 | Axiom业务/协议/策略；可能间接依赖Pi |
| [server/tasks/scheduler.ts:1](/Volumes/D_Work/axiom2/app/src/server/tasks/scheduler.ts#L1) | 678 | 无；见能力表的间接边界 | Axiom业务/协议/策略；可能间接依赖Pi |
| [shared/capabilities.ts:1](/Volumes/D_Work/axiom2/app/src/shared/capabilities.ts#L1) | 39 | 无；见能力表的间接边界 | Axiom业务/协议/策略；可能间接依赖Pi |
| [shared/resources.ts:1](/Volumes/D_Work/axiom2/app/src/shared/resources.ts#L1) | 52 | 无；见能力表的间接边界 | Axiom业务/协议/策略；可能间接依赖Pi |

合计 **24 文件 / 4918 行**，其中 **8 文件有直接Pi引用**。关联追踪另含 capability-resources/environment-resources/session-environment/agent-worker/agents/tasks/session-reloads/pi-settings-storage/model-proxy-tools 等，不并入上述指定范围数字，避免双算。

### 直接 Pi 引用分类补充（上面8文件口径）

| 文件 | 运行时导入/加载 | type-only / 非运行时依赖 |
|---|---|---|
| [axiom-prompt.ts](/Volumes/D_Work/axiom2/app/src/server/axiom-prompt.ts#L2) | pi-ai 系统消息 helper；coding-agent 私有 system-prompt.js 动态加载 | AgentMessage/AgentSession/BuildSystemPromptOptions/SystemMessage |
| [installed-resource-loader.ts](/Volumes/D_Work/axiom2/app/src/server/installed-resource-loader.ts#L1) | DefaultPackageManager/DefaultResourceLoader；私有实例桥 | ConstructorParameters 派生选项 |
| [resources.ts](/Volumes/D_Work/axiom2/app/src/server/resources.ts#L9) | DefaultPackageManager/SettingsManager/getAgentDir/loadSkills；MCP validation/auth-storage/OAuth 3个私有动态模块 | McpExtensionOptions 与派生 McpConfig |
| [task-tools.ts](/Volumes/D_Work/axiom2/app/src/server/task-tools.ts#L2) | defineTool | TaskTool为宿主类型 |
| [memory-tool.ts](/Volumes/D_Work/axiom2/app/src/server/memory-tool.ts#L1) | defineTool | MemoryQueryResult为宿主类型 |
| [memory-worker.ts](/Volumes/D_Work/axiom2/app/src/server/memory-worker.ts#L2) | pi-ai cleanupSessionResources/getSupportedThinkingLevels；经ModelService绑定ModelRuntime实际执行 | coding-agent.ModelRuntime 是 type-only |
| [reload-resources.ts](/Volumes/D_Work/axiom2/app/src/server/reload-resources.ts#L3) | 无直接运行时 Pi import；通过传入对象执行Pi methods | AgentSession |
| [tasks/delivery.ts](/Volumes/D_Work/axiom2/app/src/server/tasks/delivery.ts#L3) | 无直接运行时 Pi import；经openTranscript运行，仍强耦合Pi转录语义 | SessionManager |

因此8是显式引用文件数，不能写成“8个运行时依赖”；其中2个文件只直接import type。关联入口 capability-resources、pi-settings-storage、model-proxy-tools 的运行时依赖未包含在这8文件中。

报告生成与检查：工作目录 `/Volumes/D_Work/axiom2`；`python3` 静态路径/行数统计与 Markdown 本地链接校验退出码均为0；生成时126个既有路径链接全部存在且起始行合法（本补充新增链接同指已读文件）。未运行测试/构建/模型，故不报告任何测试通过。
