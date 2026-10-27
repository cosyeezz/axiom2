# Axiom 网络访问接入调研与方案

> 调研日期：2026-10-27。范围：成熟项目源码、官方服务文档、Axiom 当前工作树核对及公开网页小样本。**本文是设计建议，不代表网络功能已实现、插件已安装，或付费服务已通过实测。**
>
> Axiom 基线：工作树 HEAD `f9e68b140d20edb79ece463c1632c51ca9d7afc8`，包含原有未提交修改；依赖 `@earendil-works/pi-coding-agent 1.1.0`、Node `>=22.19.0`。研究不修改既有业务代码，不使用现有服务密钥调用付费 API。
>
> 追加调研：[主流 Coding Agent 的实际实现对比](mainstream-agent-web-access.md)。已补 OpenCode 正式版、Claude Code、Codex、Gemini CLI、Cline，区分托管 MCP、供应商原生能力与额外模型提取；下文相应修订搜索候选与版本边界。

> **后续实施方案已定稿**：[专用联网能力实施方案](axiom-web-access-design.md)。本文件保留早期选型与研究证据；默认搜索来源、能力归属、工具命名与首期范围以实施方案为准：同机、Google 优先、专用联网子代理、原生 `web_search`／`web_read`，保留登录态 Bridge 站点通道，不默认增加其他搜索 MCP。下文的 Brave／托管 MCP 等推荐不代表当前默认接入决策。

## 1. 决策摘要

**建议做成 Axiom 原生网络访问能力，而不是原样捆绑某个 Pi 插件。**

- 模型看到两个稳定入口：`web_search`（找来源）与 `web_fetch`（读来源），不跟随供应商更名。
- 搜索与抓取分离：搜索返回原始结果和摘要，默认不生成第二份 AI 答案、不自动抓取全部结果。
- 抓取默认本地完成：受控 HTTP → 内容类型识别 → 正文提取 → Markdown → 分页证据。动态网页、登录态和云抓取都是显式可选增强。
- 搜索 adapter 同时考虑用户可控的 BYOK/自建服务与显式选择的无 key 托管 MCP 体验模式。OpenCode 正式版已采用后者；不能把必须付费 key 当技术必然，也不承诺 keyless 的长期额度或 SLA。
- 搜索供应商、网页内容、浏览器会话是不同的信任边界。更换供应商、上传 URL 到云端、使用已登录 Chrome，都不能当成无感 fallback。
- 网络服务集中在 Axiom 后台，统一预算、并发、取消、缓存和凭据；Pi 工具只是薄适配层。

## 2. `pi-web-access`：最接近的参考，但不是完整产品底座

核对版本：`0.45.0`，commit `d95fb1eb4350b90bd4285cbc84958085d136aa43`，MIT。它已分离宿主无关的 `createWebToolCore`，同时支持 Pi extension 和 MCP，不只是几个联网脚本。源码使用新 `@earendil-works/*` 包名，开发依赖 Pi `1.0.4`；Axiom 为 `1.1.0`，**不能据此判不兼容，也尚未实际加载验证**。[源码与许可证](https://github.com/nicobailon/pi-web-access/tree/d95fb1eb4350b90bd4285cbc84958085d136aa43)。

### 2.1 已核实的能力

| 方面 | 源码事实 | 对 Axiom 的价值与限制 |
|---|---|---|
| 工具 | `web_search`、`fetch_content`、`get_search_content`、`source_check`；有独立结构化契约 | 借鉴搜索/正文/续读/来源验证的分层，不必照搬四个名字 |
| Provider | resolved search provider 枚举 40 项（另有 `auto/all` 模式），fetch provider 枚举 14 项；包含 API、自建、网页抓取、登录模型等不同路线 | 这是代码支持面，不是 54 个已实测可用服务，也不代表相同质量、费用或隐私边界 |
| 搜索调度 | 默认 `auto` 链及配置的顺序路由按可用性/结果质量 fallback；另有 `all` 或显式 provider 数组的并行模式，不能混为一谈 | 借鉴错误分类与可配置选择；Axiom 不应静默跨供应商披露 query |
| 无 key 路径 | Exa 内置 `https://mcp.exa.ai/mcp`；无 API key 时调用托管 MCP，`isExaAvailable()` 返回 true | 确有零用户配置路径，不能说必须自己部署 MCP。本次单次无 key 请求也成功，但没有限额、SLA 或长期可用性结论 |
| 正文提取 | 普通静态 HTML 路径先 Readability，必要时 RSC 提取，再 Defuddle；另有多种专用路由 | 借鉴“同一 HTML 本地 fallback”，不是直接复制复杂的全功能抓取平台 |
| 模型工作流 | 默认 `workflow: "none"`，摘要/策展等额外模型处理为可选 | 与“不默认再生成一份 AI 答案”的目标一致；登录模型路线须另核认证与条款 |
| 远程提取 | `fetchRouting.allowRemoteHostedProviders` 显式控制托管服务 | 可借鉴隐私开关，但 Axiom 还要做每次调用的宿主权限与预算校验 |
| 运行管理 | 有取消信号、并发限制、缓存 TTL/容量和受限文件权限 | 是起点；还不能替代 Axiom 跨 worker 的全局限额、lease 归属和持久化策略 |

### 2.2 哪些值得复用，哪些必须重做

**优先借鉴**：host-neutral core、provider adapter、结构化结果、取消传播、同一 HTML 上提取降级、缓存容量约束、远程服务 opt-in，以及“不把摘要生成与检索绑死”。MIT 允许在满足通知义务下复用适用代码。

**不原样搬入默认产品**：全部 provider、视频/转录/仓库克隆/策展、隐式读取 Pi 登录凭据、插件自己的 UI 和全局配置。它们会扩大依赖、权限、费用与维护面；Axiom 已有自己的运行管理、资源身份和前端。

**安全尤其要重审**：`ssrf-protection.ts` 有地址检查与逐跳重定向验证，但预解析后传 URL 给 `fetch`，未见把检查结果绑定到实际连接的地址约束，存在 TOCTOU 风险；`trustEnvProxy` 可将 DNS 信任交给配置的代理。源码检查不等于已验证漏洞利用，但足以说明**不能把它称为完整防 DNS rebinding 的安全层直接移植**。`offtopic-judge` 是相关性分类，不是提示注入防护。[安全实现](https://github.com/nicobailon/pi-web-access/blob/d95fb1eb4350b90bd4285cbc84958085d136aa43/ssrf-protection.ts)。

**采用方式建议**：产品实现自己的薄 Pi 工具与后台服务，选择性借鉴 MIT 模块，而不是默认加载整个包。若用户自行安装插件，应作为第三方实验路径：检查工具重名、配置优先级、请求归属与是否绕过原生预算，不宣称天然受 Axiom 网络策略管控。

## 3. 搜索选型：检索优先，后端可替换

### 3.1 成熟项目的架构经验

| 项目 | 值得借鉴 | 不应照搬 |
|---|---|---|
| SearXNG | 引擎适配、地区语言映射、结果统一化；已有 `/search?format=json` 接口 | Python/独立服务，不随桌面打包；JSON 必须由管理员启用，公共实例可能禁用或限流。自建不等于匿名、无限或免除上游条款 |
| Open WebUI | `SearchResult(link,title,snippet)` + 独立 provider；将 Perplexity Search 与 Sonar 分开 | 当前许可有品牌限制，不当作无条件 MIT/BSD 代码库复制；借鉴结构即可 |
| LibreChat | 每个 provider 独立 Tool、显式参数与环境配置 | 不必为两个工具引入整套 LangChain、RAG 或聊天平台 |
| OpenCode | 正式版内建 websearch/webfetch；Exa/Parallel 无 key 托管 MCP、JSON/SSE解析；core另有bounded body | 原取样为dev重构；正式版CLI与core限制不同，不能把core的流式上限与总期限套到CLI；无key不保证SLA |
| Cline | SDK 中内建 fetch executor 的流式上限、外部取消传播；丰富参数的搜索插件示例 | `sdk/examples/plugins/web-search.ts` 是示例，不是所有 Cline 会话默认启用的搜索后端；模型原生搜索与独立 Search API 应分开 |

固定源码与许可见 §13。选型依据是契约、安全和运行边界，不按 provider 数量或 GitHub 热度排名。

### 3.2 服务对比与计费快照

以下是 **2026-10-27 官方文档快照，不是实测排名，也不是对未来价格的保证**。所有托管服务都会获得发给它的 query；请求全文/云提取时还会披露 URL 和相应内容需求。

| 路线 | 原始结果与模型关系 | 费用模型/本次核实 | 定位 |
|---|---|---|---|
| **Brave Search API** | 官方 web search 返回 URL/标题/snippet，不要求额外回答模型 | 普通 Search **$5/千请求**；控制台文档列每月 $5 credits，营销页另有 up to $20，不能混为一个保证额度 | **BYOK 路线首个验证候选**。结构清楚，但存储权与质量须先过门槛 |
| **Tavily Search** | 返回 results；答案、raw content 等选项可关闭 | Basic 1 credit、Advanced 2；PAYG $0.008/credit，免费 API key 每月 1000 credits。现有 keyless 文档为免费限流体验，不等于可用性承诺 | 最直接的替换候选；显式锁 basic/关闭 answer，避免自动升级成本 |
| **Exa Search** | Search 与 Answer/Agent 是不同产品；可只用原始搜索与 highlights | Lite $4/千请求、Auto $7/千请求（基础含最多10结果）；额外结果/摘要/Contents有不同计费。API free credits 与无 key MCP 限额不是同一概念 | 语义/技术资料检索候选，实际中文与相关性待测 |
| **Perplexity Search API** | **独立 `POST /search`，返回 `results[]`，不是 Sonar/Agent 的生成答案** | 标准 $5/千成功请求、Fast $1/千；文档明确无额外 token 费，空结果的成功响应仍计费 | 应参与原始搜索候选横评，不能因为品牌有 Sonar 就排除 |
| **Gemini + Google Search grounding** | 模型调用内附搜索与引用，不是同形态的通用原始 SERP API；结果仍可被其他宿主模型消费 | Gemini 3及更新模型按其实际搜索 query 计费；当前文档列共享每月5000免费搜索、之后 $14/千；模型 token 另计，旧模型规则不同 | 可选增强，非默认基础搜索；要处理模型依赖、引用展示与可变 fan-out |
| **用户自建 SearXNG** | 聚合引擎，无强制额外回答模型 | 运维/出网/上游成本，不是统一按 API 次数收费；仍受引擎可用性、封禁与条款限制 | 支持自建诉求，作为可选 endpoint，不依赖随机公共实例 |
| **Exa/Parallel 托管 MCP 等无 key 路线** | OpenCode正式版确有无需用户key的产品路径；不代表本地或无第三方 | 依赖远端限流、服务与条款；前轮只单次验证Exa，未实测Parallel | 零配置体验的正式候选，但需显式选择/披露，不作稳定额度保证 |
| **免费 SERP HTML 抓取** | DOM/反爬变化、地区结果差异、验证码与访问条款均需处理 | 无显式 API 账单不等于无维护成本或获准使用 | 不作生产默认；不笼统断言所有站点均违法，须按具体条款核对 |

**首版选择建议（追加研究后修订）**：实现可替换的搜索 adapter，把 OpenCode 式 Exa/Parallel 托管 MCP 列为低配置体验候选；BYOK原始Search API路线仍优先验证 Brave，若套餐存储权或中文质量不达标则比较 Tavily、Exa、Perplexity。两条路线均须审条款、质量、数据披露与限额；不通过“只关缓存”绕过历史持久化问题。未选择/授权搜索模式时 fetch 可用，search 返回 `NOT_CONFIGURED`；无key模式也须明确启用，不暗用模型账户或任意公共服务。具体对比与取舍见[追加报告§8](mainstream-agent-web-access.md#8-对-axiom-原方案的具体修正)。

**上线前条款门槛**：Brave FAQ 明确要求存储全部或部分 API 结果须订阅授予 storage rights 的计划；本次不足以证明哪一个具体基础套餐有/无该权利。聊天记录、导出与跨会话证据也可能构成存储，不仅是性能缓存。其他供应商同样需要审查缓存、保留、再分发、终端用户用途与 query 保留政策，不能默认更宽松。

价格原文：[Brave 控制台](https://api-dashboard.search.brave.com/documentation/pricing)、[Brave FAQ](https://brave.com/search/api/)、[Tavily credits](https://docs.tavily.com/documentation/api-credits)、[Exa pricing](https://exa.ai/docs/admin/pricing)、[Perplexity pricing](https://docs.perplexity.ai/docs/getting-started/pricing)、[Perplexity Search schema](https://docs.perplexity.ai/api-reference/search-post)、[Gemini grounding](https://ai.google.dev/gemini-api/docs/google-search)。免费额度不作为商业选型的主要理由。

## 4. 抓取选型：轻量本地提取，重能力外置

### 4.1 项目比较

| 项目 | 实际职责与许可 | 对 Axiom 的建议 |
|---|---|---|
| **Defuddle** | kepano/Obsidian 生态，MIT；正文/元数据提取、专用站点处理、Markdown转换；Node入口可接受已下载DOM | **P1 提取器候选首选**，必须 `useAsync:false`、关闭远程补全；通过技术文档质量门槛后采用 |
| **Mozilla Readability** | Firefox Reader View 提取核心，Apache-2.0；输入 DOM，输出文章 HTML/元数据，不自行联网 | 成熟且轻量的替代/第二提取器；配 Turndown+GFM，补 base URL、代码语言及DOM兼容处理 |
| **Turndown + GFM plugin** | MIT；HTML→Markdown 转换，不负责发现正文或 URL 安全 | 不应单独当成 fetch，也不把默认 Turndown 当成已有完整表格支持；原版或维护 fork 需锁版本实测 |
| **MCP Fetch server** | Python/MIT；网络、提取、分页等参考 | 借鉴分页和地址分类，不增加 Python 常驻依赖。预解析hook仍有实际连接/代理局限，不能当完整安全实现 |
| **Jina Reader** | Apache-2.0；浏览器/内容转换服务，Node22及Puppeteer等依赖 | 可选自建/云 Reader；与Axiom Node版本不冲突，但完整服务不是轻量函数库 |
| **Firecrawl** | AGPL-3.0主体及独立SDK/服务边界；包含渲染、队列、抓取平台与PDF等能力 | 用户配置的云/自建增强，不把整套多服务平台绑进桌面。复制、修改、分发与单纯调用API的许可责任不同 |
| **Crawl4AI** | Python/浏览器抓取框架；固定源码 LICENSE 为 Apache-2.0 **另附 Attribution 要求** | 适合已有Python服务的用户，不作为默认Node依赖；不能简写为MIT或忽略附加署名条款 |

提取器不是网络安全层。Readability/Turndown不发请求，因此其“没有SSRF guard”不是缺陷；网络由 Axiom 控制。Readability 输出的正文 HTML **不等于可安全执行的消毒 HTML**，不能直接注入前端。npm unpacked size 也不等于最终桌面包增量，本次不以未经打包验证的 MB 数字作决策。

### 4.2 为什么不是直接接一个云 Reader

本地提取不把所有 URL 再发给第二家公司，边际成本和网络路由可控；但不解决 JS、验证码、登录、PDF等所有问题。云服务覆盖更广，却增加披露、供应商限额、费用与远端安全依赖。二者应是**不同授权级别**，不是无感的等价替换。

小样本验证两条本地链均可提取静态正文并通过受控代码/表格/链接检查，但都不能保证复杂技术页面代码保真。Defuddle暂列首选是因为一体化Markdown与站点适配便利，**不是实验已证明其质量全面胜出**。如果P0技术文档测试不达标，允许改选Readability或增加同HTML的第二提取器；不以输出最长或耗时最短判优。

### 4.3 从成熟 Agent 实现借鉴时的额外核验

- 原核对的 OpenCode dev `websearch/mcp.ts` 有流式上限及JSON/SSE解析；`codemode/web.ts`是通用runtime fetch，不代表产品webfetch。追加核对正式v1.19.4：CLI已有独立webfetch，search body未见工具层显式cap，fetch读完整body后检查5MiB且timeout未包body；同tag core才有bounded streaming和body deadline。详见[正式版分路径对比](mainstream-agent-web-access.md#33-同一项目的两条实现安全限制不能混称)。
- Cline SDK 的 fetch executor 有5MB body上限和50k字符输出上限，但当前源码在收到headers后 `clearTimeout`，**不能据“30s timeout”宣称覆盖慢body的总期限**；HTML→text为简化实现，不适合作为保留代码/表格的默认提取链。
- MCP Fetch 的 request hook覆盖重定向并分类私网/NAT64等，但未绑定实际连接，且DNS失败路径可放行；借鉴地址分类不等于照搬完整防护。
- 本次只审核列出的源码路径，不对这些项目整个产品作“完全没有安全措施”或“已经安全”的泛化判断。

## 5. 为什么不能直接照搬插件到 Axiom

以下是当前工作树已核对的事实，而不是未来平台能力的假设：

| 事实 | 接入影响 | 当前代码 |
|---|---|---|
| 主会话通过资源 loader、内联 extension 和 `customTools` 装配工具 | 使用 Pi 公开 `defineTool/registerTool`，不修改 Pi 安装文件 | [agent-worker.ts](../app/src/server/agent-worker.ts) |
| 子代理 `input.task` 禁用外部扩展，`customTools` 为空，另有工具白名单 | 要给调研子代理提供网络，必须明确加入受信任内建工具及工作阶段白名单；不能依赖自动继承 | [agent-worker.ts](../app/src/server/agent-worker.ts) |
| worker 用 `setGlobalDispatcher` 和 `undici.install()` 设置模型网络 | **不能在 worker 内裸用全局 `fetch`**；必须使用独立 dispatcher，最好把联网执行放在后台服务 | [model-proxy-env.ts](../app/src/server/integrations/model-proxy-env.ts) |
| MCP 传输使用恢复后的工具网络环境 | 可以借鉴代理隔离方式，但现有 MCP transport 不是通用 SSRF 防护层 | [model-proxy-tools.ts](../app/src/server/integrations/model-proxy-tools.ts) |
| worker 与后台已有带执行身份的工具 RPC | 可参考记忆工具链路，新增专用 `web-call/web-cancel/web-reply` 协议；不把所有网络行为硬塞进 `TaskTool` | [memory-tool.ts](../app/src/server/memory-tool.ts)、[agents.ts](../app/src/server/agents.ts)、[execution-protocol.ts](../app/src/server/execution-protocol.ts) |
| 会话资源有身份摘要、配置漂移检查与 reload 流程 | 新增 web capability/policy revision 要参与绑定与重载；不能只更新一个配置文件就声称所有会话已生效 | [execution-profile.ts](../app/src/server/execution-profile.ts)、[capability-resources.ts](../app/src/server/capability-resources.ts) |
| UI 已识别 `web_search/fetch_content/get_search_content` 等显示名 | **这只是展示兼容，不等于后端已有网络工具。** 新的 `web_fetch` 还需补名称映射 | [tool-summary.ts](../app/src/shared/tool-summary.ts) |
| 聊天传输是安全、有限的展示投影，不透传任意 `details` | 来源卡片应增加白名单 DTO，不能把完整供应商响应、headers 或凭据传给前端 | [transcript.ts](../app/src/server/transcript.ts)、[agent.ts](../app/src/shared/agent.ts) |
| OpenCLI 当前以技能和 launcher 环境接入 | 适合浏览器和登录态增强，不是默认正文提取服务 | [opencli-resources.ts](../app/src/server/integrations/opencli-resources.ts) |

Pi 1.1.0 的工具契约支持 `outputSchema + structuredContent`。模型仍读 `content`；codemode 等程序调用可以读结构化结果；`details` 用于持久化与状态。失败必须抛出或设置 `isError: true`，不能只返回一段写着“失败”的成功文本。应保留原生工具描述与提示词，只追加网络工具的使用规则。[Pi SDK](../app/node_modules/@earendil-works/pi-coding-agent/docs/sdk.md)、[扩展契约](../app/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md)。

## 6. 推荐架构

```text
主代理 / 获授权的调研子代理
          │
          ├─ web_search ─┐
          └─ web_fetch ──┤  Pi 原生 ToolDefinition：参数/结构化输出/取消信号
                        │  web-call / web-cancel / web-reply
                        ▼
                Axiom WebAccessService
                ├─ 执行身份与权限检查
                ├─ provider 配置 / 凭据引用 / 网络策略
                ├─ 全局与会话并发、限流、预算预留
                ├─ deadline / 取消 / 重试 / 熔断
                ├─ 缓存、single-flight、不可变文档快照
                ├─ 搜索适配器 → 托管 MCP / 官方 Search API / 用户自建服务
                └─ 抓取路由
                    ├─ 安全 HTTP → 静态 HTML 提取 worker → Markdown
                    ├─ 文本 / JSON / Markdown → 直接规范化
                    ├─ 可选云 Reader / Firecrawl
                    └─ 显式浏览器增强 → OpenCLI / 隔离浏览器
                        （登录态和交互不属于默认 web_fetch）
```

### 6.1 后台负责什么

建议新增 `app/src/server/web-access/`，内部划分 `service`、`providers`、`safe-http`、`extractor`、`documents`、`budget`、`policy`；类型定义放 `app/src/shared/web-access.ts`，Pi 适配放 `web-tools.ts`。这些是**拟新增位置**，不是现有文件。

- service 由后台拥有，避免每个模型 worker 各自持有 key、连接池、预算和重复缓存。
- HTML 解析与 Markdown 转换在可终止的受限 worker 中运行，防止 CPU/内存消耗阻塞 HTTP/WebSocket 主循环；“不执行 JS”不代表 HTML parser 没有资源风险。
- IPC 每次调用绑定 `workspaceId/sessionId/runId/toolCallId/lease`；这些身份由宿主产生和校验，不能相信模型参数。跨运行晚到回复不得回填给新执行。
- `stop`、worker 断开、run settled、后台 shutdown 均取消所属请求；取消的网络请求仍可能已计费，不宣称撤销了远端调用。
- 工具暴露策略进入 capability/profile revision；**禁用、撤销凭据和预算限制在服务端每次调用立即校验**，不能等待旧 worker 自行重载后才限制出网。
- 纯 Node 搜索与静态抓取复用 Axiom 运行环境，无需新增私有 Node、Python、Docker 或常驻浏览器。自建抓取服务才单独管理生命周期。

### 6.2 不做统一工具大杂烩

`web_search/web_fetch` 保持单一职责；批量查询由模型并行调用，后台统一控制并发。不在首版同时加入 `crawl/map/extract/agent/research/video/transcribe` 等全部工具。

浏览器继续走单独技能/能力入口。第一阶段 fetch 失败可以返回“需 JS/登录态”，建议使用浏览器，而不是工具自己偷偷打开用户 Chrome。第二阶段可以提供经授权的浏览器提取 adapter，但仍与普通 HTTP 结果区分。

## 7. 建议工具契约

以下为产品设计草案，实施时以 Pi 1.1.0 实际类型核对。

### 7.1 `web_search`

```json
{
  "query": "TypeScript narrowing official documentation",
  "maxResults": 5,
  "language": "en",
  "country": "US",
  "freshness": "month",
  "includeDomains": ["typescriptlang.org"],
  "excludeDomains": []
}
```

- 必填 `query`；其余可选；`maxResults` 建议 1–10，默认 5。查询长度、域名个数和最终输出均由服务端限额。
- `language` 与 `country` 不是一回事；`freshness`、域名过滤必须声明 provider 能力。不支持的过滤不能悄悄忽略，应拒绝或返回 `unsupportedFilters`；本地过滤后不足条数要如实说明。
- 不允许模型传 key、任意 provider base URL、代理 URL、请求头或“取消安全检查”。供应商由用户设置选择。
- 返回 `searchId/provider/retrievedAt` 和 `items[{sourceId,title,url,displayUrl,snippet,publishedAt?}]`，另有 `warnings/filtersApplied/partial`。
- `publishedAt` 只在上游提供可靠字段时使用；抓取时间不能冒充发布时间。供应商分数不应伪装成跨供应商可比的统一相关性分数。
- 结果标注 `evidenceLevel: "search_snippet"`；**搜到不等于读过**。默认不开启服务商的答案生成或全文抓取。
- 正常空结果是成功，鉴权失败、配额耗尽、网络错误是失败，两者不能混淆。

### 7.2 `web_fetch`

首次读取：

```json
{ "url": "https://www.typescriptlang.org/docs/handbook/2/narrowing.html", "maxChars": 12000 }
```

继续读取同一快照：

```json
{ "documentId": "doc_opaque_id", "startLine": 180, "maxChars": 12000 }
```

- `url` 与 `documentId` 恰选其一。续读快照不再次联网，避免分页途中内容变化；快照过期返回 `DOCUMENT_EXPIRED`，不得偷偷重新抓成另一版。
- 返回 `sourceId/documentId/requestedUrl/finalUrl/title/contentType/retrievedAt/extractor/method/contentHash`，正文为带稳定行号的 Markdown 切片，另有 `startLine/endLine/totalLines/truncated/nextStartLine/warnings`。
- `method` 区分 `http/cloud/browser`；`extractor` 记录版本；`evidenceLevel` 区分实际正文与搜索摘要。第三方 Reader 返回的是转换文本，不应声称本地核对过原始 HTML 字节。
- `maxChars` 只是模型输出预算。网络字节、解压后体积、解析 CPU、文档总长和缓存容量另行限制。对超长单行不能无界输出，应生成可追踪分段或明确硬截断。
- 默认不接收任意 headers/cookies，不保留登录态，不跟随网页指令下载附件；PDF/图片/音视频初期返回明确的内容类型提示，不当 HTML 硬解析。
- 对 401/403/429、验证码、登录页、JS 空壳返回可恢复的原因，不把“请启用 JavaScript”当成目标正文成功交付。

### 7.3 结果与引用

- 原始供应商响应只在受控服务端临时处理，不默认落盘或保留整份响应；只在必要且许可允许时持久化脱敏的规范化数据，不把原始响应直接塞入模型上下文。
- `content` 放可读结果、真实 URL 和简短证据；`structuredContent` 放有 schema 的同一份规范化数据；`details` 只保存经过脱敏的审计、来源和恢复信息。
- `sourceId` 的所有权绑定工作空间/会话；禁止靠猜测 ID 跨会话读取。调研子代理引用转交主代理时，由宿主产生授权的来源映射，不能只在子进程内存里留 ID。
- 普通 Markdown `[标题](https://...)` 首版即可使用；来源卡片是增强，不阻塞 MVP。后续可加入已搜索/已读取状态、抓取时间、提取方式、引用行范围和原文入口。
- 搜索候选 URL 不先标为“安全 URL”；每次真的 fetch 仍完整校验。
- 不把网页原文整份追加进记忆。记忆只记录需要长期复用的结论与来源，完整证据由文档存储负责。

## 8. 抓取与降级策略

建议按**预授权范围**路由，而不是一个全自动无条件 fallback 链：

1. URL 和策略校验通过，执行受控 HTTP，按 MIME 分流。
2. 静态 HTML 用本地正文提取器；解析失败或质量不足可在同一已下载 HTML 上尝试第二提取器，不增加外部披露。
3. 本地仍失败，返回具体原因。只有用户启用“允许云提取”时，才向已配置的云服务发送 URL；签名 URL、私有域名或包含敏感 token 的 URL 默认不得外发。
4. 需要 JS/登录时，提示单独浏览器能力。使用用户已登录 Chrome 必须明确选择 profile/session，不能自动跨站读取其登录数据。
5. 不做无限逐级兜底，不默认解决验证码，不承诺绕过站点访问控制；总期限和费用预算贯穿整条链。

站点访问策略也要显式设计：Agent自主抓取默认遵守适用robots规则和站点条款；用户提供URL不自动等于授权绕过限制。P0按RFC9309明确robots状态码、缓存及失败语义；robots请求同样走安全HTTP、重定向检查和总预算，不形成绕过SSRF或无限额请求的旁路。robots允许也不代表获得登录/付费内容访问权。

可将错误规范化为 `NOT_CONFIGURED/AUTH_REQUIRED/RATE_LIMITED/BUDGET_EXCEEDED/TIMEOUT/CANCELLED/NETWORK_UNAVAILABLE/HTTP_ERROR/SSRF_BLOCKED/ROBOTS_DENIED/NEEDS_BROWSER/UNSUPPORTED_CONTENT/EXTRACTION_FAILED/DOCUMENT_EXPIRED`。是否重试由错误类型决定：无结果不重试；401 不转成匿名抓取；403 不自动换成用户登录态；429 尊重 Retry-After；超时不无限重发收费请求。

## 9. 安全与隐私：首版门槛，不是后续优化

### 9.1 SSRF 和网络路由

- 只接受 `http/https`，拒绝 URL userinfo、非法转义、控制字符、异常长度；拒绝 `file/data/ftp/gopher` 等协议。默认只允许标准端口。
- 标准化主机和 IP，覆盖 IPv4 变体、IPv4-mapped IPv6、loopback、私网、link-local、云 metadata、组播和保留地址。仅做 URL 正则或检查 `localhost` 不够。
- 检查全部 DNS A/AAAA 结果，混合公私地址默认拒绝；在实际连接时绑定已验证地址并保留正确的 Host/SNI，防 DNS rebinding。每一次重定向重新校验，限制跳数，不携带跨源敏感头。
- 校验证书，不提供模型可调用的“忽略 TLS 错误”。配置代理失效时不静默改为直连。
- 任意 URL 抓取与固定搜索 API 端点使用不同策略。用户主动配置 `localhost` SearXNG 是**精确可信服务端点授权**，不能顺带放开 `web_fetch` 对全部内网的访问。
- 代理可能远端解析 DNS：本地预检不等于远端连接安全。须选用可保证相同目的地约束的可信 egress，或把该路径标记为无法提供完整 SSRF 保证并禁止任意 URL；不以“用了代理”替代安全审计。
- 云 Reader 代抓与远程 MCP 的目标校验/出网由远端负责，不能把本地 DNS 检查写成远端 SSRF 保证。即使如此，本地仍须阻止把内网与敏感 URL 外发。

### 9.2 内容、浏览器与提示注入

- HTML 解析不执行脚本，不自动取图片、样式、iframe、favicon 或正文中的链接。第三方提取器若支持 oEmbed、embed resolver、LLM enrichment，默认全部关闭。
- 限制传输及解压后体积、压缩比、解析内存/CPU、重定向、嵌套结构；处理无 Content-Length 的流式响应。接收阶段设总期限，不只等 headers。
- 网页及搜索摘要均为不可信资料。明确要求模型忽略其中的系统指令、密钥请求和工具调用要求；不能让网页正文覆盖系统提示词。警示标签只能降低风险，**不是提示注入已解决的证明**。
- 页面可以诱导模型调用其他 shell/工具。web 工具的限制不是整个 Agent 的安全沙箱；若还允许 shell 任意联网，需要 OS/容器/egress 控制才能形成硬边界。
- 浏览器渲染的子资源、WebSocket、下载也可能访问内网，单独检查顶层 URL 不够。独立浏览器需网络隔离和进程回收；用户 Chrome 属于高信任能力，不是隔离浏览器。
- 展示 Markdown 要禁止危险协议与原生 HTML 执行，不自动加载远程图片，不把源页面嵌入应用 origin，避免二次泄漏和 XSS。

### 9.3 凭据、日志与缓存

- provider 配置与 credential 分开；key 只在服务端解析，前端只得到 `configured/last4/credentialRef` 等必要状态。不得复用“当前聊天模型 key”作为默认搜索 key。
- 不假设现有模型存储是通用加密 secret store。首版可用明确标注的受限文件/环境变量方案（POSIX 0600、目录 0700；Windows ACL），并保留后续系统钥匙串接口；同用户 shell 仍可能读到，不能声称与 Agent 完全隔离。
- 日志脱敏认证头、代理密码、签名查询参数、供应商错误原文。查询文本也可能含商业信息，默认不遥测上传。
- 搜索缓存必须先满足所选套餐的数据存储条款；**没有存储授权时禁用结果正文缓存与持久化**。抓取缓存遵循 Cache-Control，不将登录页面/签名 URL 放入共享缓存。
- cache key 包含 URL、provider、filters、提取器版本、策略 revision、auth partition；只在语义安全时去追踪参数，不能改写签名/有意义查询参数。完整 URL 可能保存在受控证据中，展示 URL 应脱敏。
- single-flight 不能让一个调用者取消其他仍在等待的合法调用；需要订阅者计数和独立 deadline。对失效授权及文档清理必须有明确行为。

## 10. 配置、费用与可观测性

设置页建议只有一张“网络访问”卡，内部区分搜索与抓取：

- 搜索 provider、连接方式、凭据、端点测试；清楚显示“未配置/可用/限流/鉴权失败”。
- 抓取默认“本地 HTTP”，可选“允许向指定云服务发送 URL”，浏览器另行授权。
- 网络路由独立于模型代理，可选直连/原工具代理/明确选择的代理；诊断只显示脱敏路由。
- 全局/工作空间/运行的调用次数限制、并发、超时；第三方每日/月度消费限制及 provider 控制台入口。
- 缓存用量、清理、隐私策略、来源证据保留期限。
- 新配置影响新调用；旧调用的策略快照、立即撤销边界与需要 reload 的工具暴露状态必须明确展示。

首版可设保守初值（待基准校准）：搜索每次 5 条、fetch 正文每次 12k 字符、普通抓取总期限 30 秒、每 host 并发 2、全局并发 4。**这些是设计初值，不是实测吞吐承诺。**传输/解压/解析上限应按目标设备资源单独测定。

计费必须分开：模型 token 费、Search API 调用费、Reader/浏览器服务费、可选摘要模型费。已有 Pi `usage` 只能承载语义正确的模型调用用量；不能伪造 token 来记录网页 API 成本。

后台在出网前原子预留配额，结束后对账。标注 `estimated/actual/unknown`：网络超时后费用可能未知，不能记为 0；重试也可能再次收费。价格表只是估算，不能承诺本地美元预算等于供应商账单硬上限，应同时配置 provider 侧限额。

至少记录：provider、调用数、HTTP 状态类别、总延迟、缓存命中、提取方法与失败原因、截断率、取消后存活请求数、估算和实际费用差异。不要在诊断日志默认记录完整页面/查询/凭据。

## 11. 分阶段落地与验收

### P0：接口与质量门槛

- 固化威胁模型、工具输出 schema、来源所有权、默认出网策略和密钥存储方案。
- 用代表性中文/英文/技术文档/新闻/动态/受限站点建立公开测试集。明确静态、JS、PDF、登录页的预期结果，错误类型也是验收对象。
- 比较候选搜索服务的 relevance、来源覆盖、时效、中文和地区表现；付费 API 基准需用户提供授权凭据及预算，不能用文档宣称替代。
- 核对搜索缓存/持久化和产品用途条款；解决 Pi 包名/API 兼容与工具重名策略。

### P1：可正式使用的最小版本

- 一个经验证的搜索 adapter（显式选择的托管MCP体验模式，或BYOK原始Search API）+ 本地静态 fetch + 一套安全 HTTP 层；不因无key免除质量、条款与可观测门槛。
- 两个原生工具、配置卡、明确错误、取消/总期限/限流/预算、结构化数据与分页快照。
- 主代理及明确获授权的调研子代理可用；记忆检索、标题生成等后台模型任务不自动联网。
- 基本 URL 引用和现有工具卡可用。无需先做自建 crawler、登录浏览器或复杂来源 UI。

### P2：质量与可替换性

- 根据 P0 对比加入第二搜索 adapter 与自建 SearXNG；筛选与降级语义不丢失。
- 可选云 Reader/Firecrawl、PDF 文本提取、来源卡、缓存生命周期、provider 健康与成本展示。
- 增加本地第二提取器，但只在质量门槛触发，不机械选择“最长输出”。

### P3：高权限增强

- 显式 OpenCLI 登录态读取和隔离浏览器提取；只启用必要的只读动作。
- 批量抓取、站点 map/crawl、OCR、视频/音频等另立能力和预算，不扩大两个基础工具的默认权限。

不建议先承诺工期天数：安全 HTTP、质量测试和来源恢复是实际工作量主体，不能把“接上 API”当成整个功能完成。

### 必测清单

| 类别 | 必须验证的行为 |
|---|---|
| HTTP 安全 | 私网/metadata/IPv6/混合DNS/重绑定/重定向到内网/非HTTP协议/异常端口/错误TLS |
| 资源约束 | 无Content-Length、慢body、压缩炸弹、超大HTML、复杂DOM、取消后提取worker确实终止 |
| 搜索 | 401/429/5xx/超时/空结果/不支持过滤/地区语言/截断/去重/真实发布时间 |
| 提取 | 代码块、表格、相对链接、中文、编码、正文与导航、验证码/登录页识别、SPA空壳 |
| 工具与运行 | 主子代理白名单、工作/总结阶段、撤销授权、配置reload、旧lease晚到回复、并发single-flight取消 |
| 凭据和费用 | key不入前端/会话/日志、预算竞争、重试计费、未知费用、禁用后不能再出网 |
| 来源与历史 | document分页一致、过期不重抓、分支/恢复/重启、子代理来源交接、会话间ID隔离 |
| UI | 展开按需读、320字符预览不丢引用、恶意链接与HTML不执行、远程图片不自动加载 |
| 平台 | macOS/Windows/Linux；直连/工具代理/模型代理不同配置；离线/代理失效不静默改路由 |

## 12. 实测证据与结论边界

### 12.1 提取小样本

在独立临时npm环境测试，没有向Axiom安装依赖。最终有效口径为：**Defuddle `defuddle/node` 的 `markdown:true,useAsync:false`** 对比 **Readability+Turndown+GFM**，各自使用同一份已下载HTML；linkedom设置文档URL及必要DOM兼容，Readability链另规范化相对链接。版本与完整SHA256见[实验结果](evidence/web-access/extraction-results.json)，方法和可复跑脚本见[实验说明](evidence/web-access/README.md)。

| 公开静态样本 | 输入UTF-8字节 | Defuddle输出字节 / 单次ms | Readability链输出字节 / 单次ms |
|---|---:|---:|---:|
| example.com | 577 | 156 / 4.8 | 156 / 0.8 |
| MDN Promise | 201392 | 34018 / 140.4 | 36603 / 49.1 |
| TypeScript narrowing | 334926 | 25874 / 200.9 | 37422 / 75.4 |
| Python asyncio（中文） | 26623 | 3812 / 34.3 | 3262 / 8.8 |
| React useEffect | 601984 | 45517 / 362.0 | 48588 / 171.7 |

- 五个公开URL在取样时均HTTP200；最终对保存HTML离线跑提取，不把下载时间混入解析时间。耗时含DOM和Markdown转换，是单机单次观测，无冷热/顺序随机化/统计置信结论。
- 自有fixture检查：代码文本和fence、GFM表格、`../`链接、根相对链接、导航/页脚剔除；两条链共 **10/10断言通过**，提取期间被监控的global fetch尝试次数为0。这不是整个解析进程已经网络隔离的证明。
- 手工抽查TypeScript输出：Defuddle虽保留fence，仍有`tsfunction`、交互诊断和`Try`混入，部分代码语言标记成markdown；Readability基础转换也未可靠恢复这些复杂代码块。不能把“有代码fence”说成“代码保真”。
- 较早两轮用Defuddle核心HTML再Turndown，且第一轮缺GFM、字节口径有误；**不用于本表与选型结论**。所谓“Defuddle markdown选项损坏”实际是入口/输出字段使用不当，正确Node入口已跑通。
- 不从字节长度判质量，不从单次耗时得出普遍倍速，不外推到SPA/登录/PDF/大规模站点。未把第三方整页正文提交进仓库，只保存方法、受控fixture、统计和哈希。

### 12.2 无 key 搜索体验

对Exa托管MCP发出一次公开研究查询“Mozilla Readability official GitHub repository”，请求2条结果，**无用户key、无现有凭据**；HTTP200，JSON-RPC结果含两条来源文本（不是仅HTTP成功）。[请求元数据](evidence/web-access/exa-mcp-sample.json)。这支持“该零配置路径本次可用”，不证明长期限流额度、稳定性、内容时效或所有地区可用；也不等于收费Search API已完成横评。

### 12.3 仍待实施前验证

1. 授权预算下的中文/英文搜索质量、时效与p50/p95延迟横评；本次没有调用带key收费API。
2. 具体套餐对聊天历史、缓存、导出与终端用户场景的存储/使用权；供应商数据保留和跨境要求。
3. Pi1.1.0真实主/子代理加载、codemode结构化返回和工具重名；本次只核对类型/当前代码，没有装插件运行。
4. Axiom实际代理/TUN/fake-IP/远端DNS下的SSRF与连接约束，以及停止/重启/lease迟到结果；安全建议不等于已通过攻击测试。
5. 提取器在目标设备的包增量、CPU/内存、恶意HTML及代表性动态/受限页面；没有把小样本包装成上线验收。

## 13. 固定来源与许可证据

源码使用固定commit；官方服务文档属于会变化的日期快照。许可列用于选型提示，不替代具体分发方式的法律审查。

| 项目 | 固定源码与重点路径 | 许可核对 |
|---|---|---|
| pi-web-access | [`d95fb1eb4350b90bd4285cbc84958085d136aa43`](https://github.com/nicobailon/pi-web-access/tree/d95fb1eb4350b90bd4285cbc84958085d136aa43)：`web-tool-core.ts`、`gemini-search.ts`、`exa.ts`、`extract.ts`、`ssrf-protection.ts`、`storage.ts` | [MIT/package](https://github.com/nicobailon/pi-web-access/blob/d95fb1eb4350b90bd4285cbc84958085d136aa43/package.json)；其依赖Defuddle0.19.3，与本次实验0.19.6不同 |
| SearXNG | [`54ca1d9cfb08674f66261d7f351b063558dfcc62`](https://github.com/searxng/searxng/tree/54ca1d9cfb08674f66261d7f351b063558dfcc62)：`searx/engines/`；[Search API](https://docs.searxng.org/dev/search_api.html) | [AGPL-3.0](https://github.com/searxng/searxng/blob/54ca1d9cfb08674f66261d7f351b063558dfcc62/LICENSE) |
| Open WebUI | [`33c1978d5bad52a31df75ea55143025dfad18d16`](https://github.com/open-webui/open-webui/tree/33c1978d5bad52a31df75ea55143025dfad18d16/backend/open_webui/retrieval/web) | [含品牌限制的Open WebUI License](https://github.com/open-webui/open-webui/blob/33c1978d5bad52a31df75ea55143025dfad18d16/LICENSE)，不直接标MIT/BSD |
| LibreChat | [`8d3da9bbb220a0a96be9330a2e1cbd385fb786d5`](https://github.com/danny-avila/LibreChat/tree/8d3da9bbb220a0a96be9330a2e1cbd385fb786d5/api/app/clients/tools/structured) | [MIT](https://github.com/danny-avila/LibreChat/blob/8d3da9bbb220a0a96be9330a2e1cbd385fb786d5/LICENSE) |
| OpenCode | 原dev取样 [`dae4077a96243257ea0a2086068504b791629f10`](https://github.com/anomalyco/opencode/tree/dae4077a96243257ea0a2086068504b791629f10/packages/core/src/plugin/websearch)；追加正式v1.19.4 实际tag commit [`148842ef7cb1bc34192b3fff57d0f9721ab9c801`](https://github.com/anomalyco/opencode/tree/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/opencode/src/tool)，分清CLI/core | [MIT](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/LICENSE) |
| Cline | 前轮取样 [`c35b729049c7bb26c340df63ea9235c40b32dd29`](https://github.com/cline/cline/blob/c35b729049c7bb26c340df63ea9235c40b32dd29/sdk/packages/core/src/extensions/tools/executors/web-fetch.ts)；追加正式v4.1.26 [`a459f1d04dea030833b558be645011ab739c463b`](https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/core/src/extensions/tools/executors/web-fetch.ts)，生产装配见[追加报告§7](mainstream-agent-web-access.md#7-clinesdk正文抓取与模型原生搜索是两件事)；搜索示例在`sdk/examples/plugins/web-search.ts` | [Apache-2.0](https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/LICENSE) |
| Defuddle | [`3e8bde9f5f855bc968e95837a750c5968a9fe639`](https://github.com/kepano/defuddle/tree/3e8bde9f5f855bc968e95837a750c5968a9fe639)：`src/node.ts`、`src/defuddle.ts`、`src/markdown.ts` | MIT |
| Readability | [`ab4027a8b37669745016869a37a504727992b2ba`](https://github.com/mozilla/readability/tree/ab4027a8b37669745016869a37a504727992b2ba)：`Readability.js` | Apache-2.0 |
| Turndown | [`aa84dfa3e2361edea8c43acbfc2b7a9363494bfd`](https://github.com/mixmark-io/turndown/tree/aa84dfa3e2361edea8c43acbfc2b7a9363494bfd) | MIT |
| MCP Fetch | [`ef9808f71090d0db3eda99e2af2ba78f1086f4fb`](https://github.com/modelcontextprotocol/servers/blob/ef9808f71090d0db3eda99e2af2ba78f1086f4fb/src/fetch/src/mcp_server_fetch/server.py) | MIT |
| Firecrawl | [`088afa503a8a421ceed7a23e7c65275a4ed0a2a4`](https://github.com/mendableai/firecrawl/tree/088afa503a8a421ceed7a23e7c65275a4ed0a2a4) | 主体AGPL-3.0；使用SDK/API另核边界 |
| Jina Reader | [`1574bfd380d249c86c82db4dace0d9c8fe17e2b1`](https://github.com/jina-ai/reader/tree/1574bfd380d249c86c82db4dace0d9c8fe17e2b1) | Apache-2.0 |
| Crawl4AI | [`888299fb5f0b82181897dc0e61bfb4b036f0aea5`](https://github.com/unclecode/crawl4ai/tree/888299fb5f0b82181897dc0e61bfb4b036f0aea5) | [Apache-2.0 + Attribution](https://github.com/unclecode/crawl4ai/blob/888299fb5f0b82181897dc0e61bfb4b036f0aea5/LICENSE) |

Axiom/Pi本地架构链接在§5；它们指当前工作树，不冒充纯HEAD源码。详细工具、资源绑定、前端投影和网络代理均须在实施时重新核对。
