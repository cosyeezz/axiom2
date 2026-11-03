# OpenAI 新版 ChatGPT 登录与 Codex 登录：使用差异及建议

研究日期：**2026-10-29**。研究阶段基准：升级前 Axiom 工作区依赖的 Pi **1.1.0**；另已复核本机全局 CLI 的 **1.4.0**，二者不是同一份安装，详见第 4.3 节。

> 后续实施说明：用户明确选择以 Codex OAuth 和 WS 作为 Axiom 默认 OpenAI 路径。工作区根／app 的清单、锁和实装依赖已统一到 Pi **1.4.0**；新 OAuth 仍使用 `openai-codex` 身份但显示 OpenAI，额度复用主连接，旧 direct/API Key 不自动迁移。以下“当前实现／本机版本”指研究时点，不应解读为升级后的运行状态。改造契约见 [统一 OpenAI 连接](provider-usage.md#统一-openai-连接)；安装及源码改造不等于已部署，也不代表已真实验证账号或 WS 握手。

## 研究阶段结论（实施前）

**对符合官方接入资格的本地 Axiom，推荐把 OpenAI → Sign in with ChatGPT（direct）作为新配置首选和长期主通道；已有 Codex 配置保留作兼容备用，不必为了“写代码更强”切换到 Codex。**

理由是 direct 有面向开源／本地应用的官方公开集成文档，且 Pi 明确用它取代其继承的旧 provider；**不是**已经证明它模型更多、回答更聪明、速度更快或费用更低。

这个推荐有两条边界：

- 当前 Pi 1.1.0 并不等于完全通过最新 direct Preview 契约验收。本次发现账号模型目录、初始工具声明和模型能力元数据仍有适配风险，详见第 6 节。现有 OpenAI 连接正常可继续使用，但不据此要求将已稳定运行的 Codex 工作流全部迁移。
- 商业付费／远程托管产品不能直接套用 OSS 接入资格；官方要求通过 interest form 联系确认。个人自托管 VM 另有官方指引，不能简单理解为“只能在本机运行”。

**身份账号、授权通道、模型、Agent 客户端是四个不同层次。** 两种 OAuth 可以使用同一个 ChatGPT 账号，却不是同一份可互换的凭据；选 Codex provider 也不等于把 Axiom 换成官方 Codex CLI。

## 1. 先把三条路径区分开

| 路径 | 当前 Pi provider | 凭据与推理入口 | 用量归属 |
|---|---|---|---|
| 新版 ChatGPT direct | `openai`，选择 Sign in with ChatGPT | 动态 OAuth 客户端；`chatgpt.tokens.use.direct`；公共 `api.openai.com/v1/responses` | 经授权的 ChatGPT 套餐用量／credits |
| 继承的 Codex OAuth | `openai-codex`，Pi 标作 legacy | Codex OAuth 客户端；Pi Codex adapter 调用 `chatgpt.com/backend-api` 路径 | ChatGPT 订阅的 Codex／Work 用量 |
| OpenAI API Key | 同样可以是 `openai`，但认证选 API Key | API Key；公共 API，按具体端点和模型授权 | OpenAI Platform 独立的 API 用量计费 |

所以“OpenAI 登录”不一定是 API Key；provider 名字也不足以判断钱记在哪个账本。

**套餐资格也不能直接互推。** direct quickstart 当前明确的是符合资格的 ChatGPT Plus／Pro 用户；不能因为 Codex 产品支持某个其他套餐，就认定该套餐也能走 direct。本次没有验证其他套餐的 direct 资格。

官方 direct 文档明确要求不要把该 grant 指向 ChatGPT `backend-api`。不能复制 token、合并认证文件来互换前两条路径。反过来，官方提供了 **direct token + 自定义公共 Responses provider 驱动 Codex app-server** 的方案，并写明：

> “No separate Codex sign-in is required.”

这是让 app-server 改走适当的公开推理接口，**不是**允许把 direct token 塞入旧 Codex backend，或直接拿它查询旧额度接口。

来源：[direct 模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、[Codex app-server 集成](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)、[Codex 认证](https://developers.openai.com/codex/auth)。

## 2. 登录之后，究竟能用哪些模型

### 2.1 不能用 SDK 模型条目数推断账号权限

本机静态聊天目录中，OpenAI 有 44 项，Codex 有 9 项，后者的 ID 都能在前者找到。但这个比较**只说明 SDK 元数据覆盖范围，不说明订阅登录的模型权限**。OpenAI provider 的目录还同时服务 API Key。

Axiom 当前 OAuth 模型刷新沿 Pi 的内置／缓存目录和匿名 `pi.dev` 公共目录执行，没有使用该 ChatGPT 账号 token 请求官方账号模型目录。公开目录刷新也不是账号权限探测。

官方 direct 已经明确规定真正的账号目录流程：

1. 用后续推理所使用的同一 OAuth token 请求 `GET https://api.openai.com/v1/models`。
2. 读取响应的 `.models[]`，展示 `visibility == "list"` 的条目并保留服务端顺序。
3. 界面显示 `display_name`，请求发送 `slug`。
4. 切换 ChatGPT 账号后刷新。

这仍不是永久授权承诺：工作区策略、地区、发布批次和额度会影响请求，真正完成的推理只能证明那次请求可用。**本次没有请求用户的账号目录或发起模型推理，因此不能提供你的已验真实权限列表。**

来源：[官方账号目录契约](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)；本机 [model-service.ts](../app/src/server/model-service.ts#L444)、[remote-catalog-provider.js](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/remote-catalog-provider.js)。

### 2.2 官方现行模型与旧目录确实存在差距

截至研究日期，官方 Codex／ChatGPT Work 模型页推荐：

- `gpt-6-astra`：最复杂、要求较高的端到端任务。
- `gpt-6.1-sol`：复杂工作与反复执行、长流程的折中选择。
- `gpt-6.1-terra`：较高效率的日常写作、视觉与应用相关任务。
- `gpt-6-luna`：明确、重复、高吞吐任务。

**这些是官方产品的推荐，不是对 Axiom 中任一 OAuth 账号的全量可用保证。** direct 官方示例也使用 `gpt-6.1-sol`，但仍明确要求选当前账号可用的模型。若账号确有权限且当前 adapter 已兼容，Sol 可作为一般复杂工作的起点；选择模型本身比只看登录入口更有意义。

需要纠正前面把旧模型作为使用示例的不足：官方说明 **GPT-5.5 已于 2026-10-14 从 ChatGPT 登录的 Codex 退休**，API Key 会话不受这一退休影响；`gpt-5.3-codex-spark` 已于 2026-09-14 退休。它们仍在某些 SDK 目录里，不应再作为“现在订阅登录就能使用”的证据，也不能据此判断 direct 当前权限。

上下文数字也要区分来源：官方现行 Sol 文档写 Codex／Work 默认 500K；API 模型页写 1.05M；本次查看的官方 Codex bundled catalog 仍有 272K 元数据。**不能将 API 上限、客户端 fallback 元数据、Axiom 实现和 OAuth 实际权限混成一个数字。** 本次没有验证 Axiom 的实际上下文上限。

来源：[Codex 模型及退休说明](https://developers.openai.com/codex/models)、[Sol API 模型页](https://developers.openai.com/api/docs/models/gpt-6.1-sol)、[固定版本 Codex bundled catalog](https://github.com/openai/codex/blob/a3697361dfc0bc438b65ae8a9aa0e598ecd45251/codex-rs/models-manager/models.json)。

## 3. 同名模型会不会表现不同

**没有查到足以证明“两个通道使用不同权重”的公开证据，也没有完全相同后端部署／路由的保证。** 因此既不能说 Codex 登录天生更会编程，也不能保证同名模型逐项完全等价。

可确定的差异主要来自请求与客户端：

- 模型 ID、推理强度、上下文组织、缓存和服务档位。
- 系统／developer 指令、可见工具、工具执行反馈、错误恢复。
- 权限、沙箱、上下文压缩、子代理和整个 Agent 工作流。

官方 Codex CLI 有自己的 base instructions、工具和权限组织；其公开源码允许覆盖 base instructions。Axiom 只借助 Codex OAuth 发送推理请求，**不会自动获得官方 CLI 的完整提示词、沙箱、插件、computer use、子代理策略或云端任务产品能力**。Axiom 的本地工具和子代理仍由 Axiom／Pi 实现。

同理，用新版 direct 登录也不会把 ChatGPT 网页里的历史聊天或 memory 自动带进 Axiom。官方明确说使用套餐不会向应用开放这些内容。

来源：[Codex base prompt](https://github.com/openai/codex/blob/a3697361dfc0bc438b65ae8a9aa0e598ecd45251/codex-rs/models-manager/prompt.md)、[可覆盖的 model instructions](https://github.com/openai/codex/blob/a3697361dfc0bc438b65ae8a9aa0e598ecd45251/codex-rs/models-manager/src/model_info.rs)、[Sign in with ChatGPT 用户说明](https://developers.openai.com/codex/sign-in-with-chatgpt)。

## 4. 实际能力与长会话：direct 不是完整 API Key 的替代品

### 4.1 direct 当前是有明确限制的 Preview

| 能力 | 官方 direct 契约／含义 |
|---|---|
| 流式文本、推理 | 支持，取决于所选模型；HTTP 必须 `store:false`、`stream:true` |
| 图片／文件输入 | 视模型支持；并不意味着 Axiom 已实现所有输入方式 |
| 函数／custom tools | 支持，但需 namespace 分组或 `additional_tools` 声明 |
| 本地 shell、MCP、子代理 | 可由客户端用受支持的函数工具执行；不是托管服务授权 |
| Web search | 受模型及账号／工作区策略限制；不能承诺全部可用 |
| 托管图像生成、file search、Code Interpreter、原生 computer use | direct Preview 不支持 |
| 托管 MCP／connectors、Responses `tool_search` | direct Preview 不支持 |
| 音视频输入、Files upload API、transcription API | 此流程不支持 |
| `temperature`、`top_p`、`max_output_tokens`、`prompt_cache_retention` 等 | 不支持，不能将 API Key 参数原样套入 |

完整限制还包括 `background`、`conversation`、`metadata`、`truncation` 等。某个模型在产品宣传中能使用 computer use 或图像生成，不等于当前 direct 路由开放对应托管工具；也不等于换成 Axiom 的旧 Codex 登录就会自动获得这些集成。

来源：[Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)。

### 4.2 Pi 1.1.0 的两条传输实现确实不同

- **direct adapter** 当前使用 HTTP/SSE，重放必要历史；常规选项路径会省略 `temperature`、`max_output_tokens` 和长缓存控制，但保留会话 cache key。
- **Codex adapter** 默认 auto WebSocket，能够复用连接；在上下文前缀等条件符合时，用 `previous_response_id` 加增量输入，开始输出前可 fallback 到 SSE。

**OpenAI 对 WS 的性能收益有明确官方观察，不只是理论潜力。** [官方 WebSocket mode 指南](https://developers.openai.com/api/docs/guides/websocket-mode)写道：

> “For rollouts with 20+ tool calls, we have seen up to roughly 40% faster end-to-end execution.”

即：在 20 次以上工具调用的执行链中，观察到端到端执行最多约快 40%，收益来自持久连接、增量输入及连接内状态复用。不是所有请求固定提速 40%，也不是 token 生成速度提高 40%。本次**没有做 Axiom 的同账号 A/B**，不能将官方观察直接写成当前 Axiom／Codex／direct 的实测结果，也不由此推断额度、稳定性或模型质量优势。[官方原文与核验快照](evidence/openai-codex-login-20261029/pi14-ws-check.md)。

不能把客户端实现差异写成官方 direct 不支持 WebSocket。官方文档允许同一认证 WebSocket 连接内的 continuation；不允许将它当跨连接的持久会话存储。官方 app-server 示例关闭 WS，是该示例配置的选择。**结论是官方 direct 有 WS 能力，但当前 Pi 1.1.0 的 direct adapter 没有使用它。**

**SSE 是否效率更低，需要区分网络、计算和用量。** SSE 是单次 HTTP 请求内持续推送事件，不是每个 token 发一次 HTTP；HTTP 本身可以复用连接，也不意味着每轮都重新做 TCP/TLS 握手。WS 在频繁多轮工具调用、长上下文或较高网络往返延迟下，连接复用加上下文增量可能减少序列化、上传和轮间开销。但这不是模型生成速度必然提升，也不能在未实测时给出百分比。HTTP 重发历史不等于一定重算全部历史，direct 仍发送会话 cache key；缓存实际是否命中由上游决定。反过来，WS 少传历史也不等于旧上下文不占模型窗口或不计入用量。

因此，推荐 direct 是集成方向建议，不是当前性能升级结论。若重点是长会话和密集工具调用，当前 Codex adapter 已实现的 WS 复用／增量机制是保留并比较它的实际理由；不要仅因为“新登录”就迁移已稳定的工作流。

本机证据：[openai-responses.js](../app/node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js#L236)、[openai-codex-responses.js](../app/node_modules/@earendil-works/pi-ai/dist/api/openai-codex-responses.js#L1122)。

### 4.3 Pi 1.4.0 复核：全局 CLI 与 Axiom SDK 是两份安装

用户指出 Pi 已是 1.4，补查确认：**本机全局 `pi` 确实是 1.4.0**；此前仅检查 Axiom 依赖，不能泛称整台机器的 Pi 都是 1.1.0。

在本节研究时点，Axiom 根／app 清单及安装依赖仍为 1.1.0。观察到运行中的 agent worker 入口为 `app/dist/server/agent-worker.js`，其保留外部 Pi imports；以此入口做 Node ESM 解析，加载目标仍是 `app/node_modules` 中的 1.1.0，不是全局 1.4.0。

同时核验了全局安装与官方 npm 1.4.0：

| Pi 1.4.0 路径 | WS 支持 |
|---|---|
| `openai`／Sign in with ChatGPT direct | **未实现 WS，仍走 HTTP/SSE**；请求调用 `client.responses.create()` |
| `openai-codex` | **已实现 WS**；coding-agent 默认 auto 优先 WS，可条件性降级 SSE；前缀和连接状态匹配时增量续接 |

因此，**升级全局 CLI 不会自动升级 Axiom SDK；即便 Axiom SDK 升到 1.4.0，也不会自动让 direct 使用 WS。** 不能将“Pi 支持 WS”泛化为“Pi 的每个 provider 都支持 WS”，也不能将“支持”当作某次连接确实走了 WS。本次只读核验，没有升级依赖或发起真实推理连接。

证据：[版本解析、源码与官方性能完整复核](evidence/openai-codex-login-20261029/pi14-ws-check.md)、[本机只读检查输出](evidence/openai-codex-login-20261029/pi14-local-check.json)。

## 5. 额度、费用、用量查询与隐私

### 5.1 两种登录不产生两份额外订阅额度

官方用户说明明确：

> “It uses your Codex / ChatGPT work usage included in your plan.”
>
> “Connecting an app does not add a new allowance.”

因此，**同一套餐在不同入口授权，不会凭空多出一份用量**。不能指望 direct 用完后，再登录同账号 Codex 就一定能继续。

- Plus 的五小时额度在使用 ChatGPT plan 的各应用间共享。
- 官方当前说 Pro 没有这一五小时限制，**不等于无限额**；周额度等其他限制仍可能适用。
- 每应用设置的周百分比是上限，不是预留或新增份额。
- 应用自己的额度上限触发，与整个账号／套餐耗尽不是同一回事。
- 官方表格的“消息数”是随模型、上下文、推理、工具和缓存变化的估算，不是固定每条请求的消耗。

这里能确认的是 Codex／ChatGPT Work 订阅用量及 participating apps 的关系，不据此宣称 ChatGPT 普通 Chat 的每个消息窗口也完全等同。

来源：[用户侧连接与应用额度](https://developers.openai.com/codex/sign-in-with-chatgpt)、[Profiles and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)、[Codex pricing](https://developers.openai.com/codex/pricing)。

### 5.2 不因公共 API 地址就自动变成 API Key 计费

- direct 使用用户明确授权的 ChatGPT 套餐／credits，不是自动改走 OpenAI Platform API Key 账单。
- 旧 Codex OAuth 也是订阅路径。API Key 是另一条按 API 费率记账的路径。
- 模型、推理、Fast／Ultrafast 等会影响套餐或 credits 消耗；不能证明只换一个登录入口就更便宜。
- 允许额度用完后消费 credits 的设置可能带来额外 credits 消耗；“有订阅”不等于所有额外使用都免费。
- **Axiom／SDK 依据目录单价计算的 Token cost，不是官方 OAuth 套餐实际扣款或剩余额度。** 不应按 API 单价把订阅请求逐条认定为真实美元费用，也不应把 credits 未经价格依据直接换算成美元。

官方认证说明明确区分 ChatGPT subscription access 与 API key usage-based access，不能静默 fallback 到另一计费路径。

### 5.3 主模型登录与 Axiom 独立额度登录分开看

Axiom 目前对带 direct scope 的凭据明确返回“未提供已核实的额度查询接口”，引导打开官方用量页，**不拿 direct token 去试旧 wham 查询**。

用量页的独立 Codex 授权可以只用于查询额度，不会增加会话模型，也不会将主会话切到 Codex。已有效的独立凭据应复用；这不证明它与主登录必然是同一个真实账号。

因此：**主模型优先 direct；需要旧额度查询时保留单独 Codex 授权，是可以共存的设计。** 但不能把二者不经身份核对当作同一账号账本。

本机证据：[openai-usage.ts](../app/src/server/providers/openai-usage.ts#L84)、[usage-accounts.ts](../app/src/server/usage-accounts.ts)、[ModelUsage.tsx](../app/src/client/pages/ModelUsage.tsx)。

### 5.4 不把 `store:false` 解读成隐私保证

官方 Codex auth 区分 ChatGPT workspace 的权限／保留／驻留策略与 API 组织的保留／数据共享策略。不能将 API Key 的某项政策自动套给个人 ChatGPT OAuth。

官方说明“不开放既有 ChatGPT 对话／memory”，不表示本次发送到模型的提示词、文件、工具结果不会被处理。`store:false` 也不足以证明零保留、无安全日志或不用于训练。

本次部分 Help Center／商业数据政策页返回 HTTP 403，**个人订阅与 direct 的具体保留／训练差异未充分核实**，不能据此宣称某个通道隐私更好。

## 6. 当前 Axiom／Pi 适配中必须保留的风险说明

这些是研究发现，不是本次已经修复或已经线上复现的故障。**这里的风险主要指当前版本的推理协议／目录适配边界，不是已发现 Pi 原生 OAuth 不安全或 Axiom 绕过原生授权。**

已复核实际链路：Axiom 的登录 worker 调用 Pi `runtime.login()`，转发原生认证提示／通知，并提供应用名和稳定设备标识；没有另写一套 OpenAI OAuth 协议。登录成功验证的是凭据已取得并保存，不是所有模型、工具和传输组合都已完成调用验收。Axiom 自己的成功提示也明确写着：“pi 已保存认证；这不代表模型调用已验证。”原生 OAuth 与原生推理 adapter 是 SDK 中的不同职责；以下差异仍可能存在于后者，但不应因此将前者描述为已存在安全漏洞。

授权链路依据：[model-network-worker.ts](../app/src/server/model-network-worker.ts#L45)、[auth.ts](../app/src/server/auth.ts#L176)。

1. **账号目录未接入。** 当前 OAuth 刷新沿匿名公共目录／缓存，无法证明列表中每个模型对所选账号可用。应按官方 `/v1/models` 契约展示账号模型，并将公共能力元数据与账号授权分开。
2. **初始工具声明形状与最新 Preview 文档不一致。** 本机 `convertResponsesTools()` 将初始工具映射为平铺的 `function/custom` 放到顶层 `tools`；官方当前要求 namespace 或 `additional_tools`。`resolveTranscriptTools()` 也明确将初始工具留在顶层。Axiom 普通工具注册和所查 worker wrapper 没有补这个分组。本次证实的是本地构造与文档存在差异，**没有在线请求，不能声称上游一定拒绝或现有工具已经失效**。上线验收应覆盖真实初始工具、后续新增工具和多轮返回。
3. **不要只看 `tool_search` 名字判定兼容。** Pi 的本地同名函数工具与 Responses 原生工具不是一回事。shared adapter 在某些 capability 分支会产生原生 `tool_search_call/output`，而 direct 官方明确禁止这条原生路径。实际是否走到它取决于模型元数据、工具加载方式和用户设置，应逐项核验，不能承诺当前所有配置均可用。
4. **远程目录与 SDK 版本可能失配。** 本次两个公共 shard 均 HTTP 200，响应带 `x-pi-model-catalog-minimum-version: 1.2.1`；当前嵌入的是 1.1.0，所查 loader 未据该 header 拦截。新目录条目／能力不能直接当 1.1.0 已验证支持。没有据此自动升级依赖。
5. **认证／错误恢复仍须按新契约验收。** 额度限制、账号不符合资格、临时服务不可用和凭据失效不是同一种错误；不能全部删凭据、反复登录或静默换成 API Key。本次不是完整 OAuth 安全审计，也没有真实 refresh／revoke 验收。

源码依据：[初始工具转换](../app/node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js#L272)、[工具加载分支](../app/node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js#L91)、[transcript 工具划分](../app/node_modules/@earendil-works/pi-ai/dist/utils/transcript.js#L198)、[Axiom 工具注册](../app/src/server/agent-worker.ts#L799)、[Axiom 会话创建](../app/src/server/agent-worker.ts#L890)。

### 零网络请求的本地验证

本次用完全虚构的凭据、用户输入和工具声明，对比了 direct OAuth、Codex OAuth、API Key control 三种请求形状：

- 在 `onPayload` 捕获构造结果后故意抛错，调用前终止；全局 fetch 也被禁止。
- **3 个案例断言通过，网络调用为 0**。
- direct 常规参数路径省略 `temperature`、`max_output_tokens`、`prompt_cache_retention`；API Key control 保留这些参数。
- Codex 案例保留 `temperature`，使用 `instructions`、`parallel_tool_calls`，未发送 `max_output_tokens`。
- 三者都有 `store:false`、`stream:true` 和函数工具；测试还确认 `service_tier` 进入构造结果，**没有验证上游接受、实际速度或额度费率**。

为了比较同一个本机目录对象，fixture 使用残留的 `gpt-5.5` 元数据，**不是在调用退休模型或证明它当前可用**。脚本中只有虚构身份；不读取真实认证文件。

证据：[脚本](evidence/openai-codex-login-20261029/payload-probe.mjs)、[完整 payload](evidence/openai-codex-login-20261029/payload-probe.json)、[执行结果](evidence/openai-codex-login-20261029/payload-probe.log)。脚本保留本机安装路径，是研究快照，不是产品测试入口。原执行命令：

```bash
cd /Volumes/D_Work/axiom2/app
node /tmp/axiom-openai-codex-research/local/payload-probe.mjs
```

## 7. 为什么仍然推荐 direct，以及什么时候不选它

Pi 的 v0.99.0 发布说明明确：

> “Renamed the inherited OpenAI Codex provider to "OpenAI Codex (legacy)"; Sign in with ChatGPT on the OpenAI provider supersedes it.”

这是 **Pi 对自身 provider 的迁移决策**，不等于 OpenAI 官方宣布 Codex OAuth 下线。当前 SDK 仍保留旧 provider 和传输实现；所查发布说明也没有给出移除日期。

| 使用场景 | 建议 |
|---|---|
| 符合资格的本地 Axiom，新建订阅连接 | **优先 OpenAI → Sign in with ChatGPT direct**，完成当前工具链协议验收 |
| 当前 OpenAI direct 已稳定使用 | **继续用，不为“Codex 更会写代码”而切换** |
| 当前 Codex 已稳定、有特定模型或流程经实际验证 | 可保留，先验证再迁移；不为了清理 legacy 标签牺牲现有工作流 |
| 某个模型／长会话流程在 direct 有明确问题，Codex 实测可用 | 显式选择 Codex 兼容路径；不自动重放未完成的有副作用任务 |
| 只需要 Axiom 的独立额度查询 | 可保留有效的独立 Codex 授权，不必改变主模型通道 |
| 想要官方 Codex CLI／IDE 的完整体验 | 使用对应官方客户端，不能只换 Axiom 的 OAuth provider 名字 |
| 必须依赖 direct 不支持的托管 API 功能、API 参数或独立 API 计费 | 评估 **API Key** 及实际功能集成；不是默认让旧 OAuth 承担所有能力 |
| 付费／远程托管 Axiom 服务或资格不明确的套餐 | 先确认官方接入资格，不从本地 OSS 流程推导商业授权 |

**最终建议：主模型用 direct，旧 Codex 保留兼容与独立用量查询；按账号实际可用模型选型，不按登录名称判断智力、速度或额外额度。**

## 8. 证据、方法与未验证项目

### 官方与上游资料

- [Sign in with ChatGPT quickstart](https://developers.openai.com/siwc/quickstart)
- [开源／本地应用接入范围](https://developers.openai.com/siwc/token-sharing-open-source)
- [账号目录与公共 Responses 推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview 能力与参数限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [账号、会话与共用额度](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Codex app-server + direct token](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
- [Codex 认证](https://developers.openai.com/codex/auth)、[模型](https://developers.openai.com/codex/models)、[价格与额度](https://developers.openai.com/codex/pricing)、[用户侧 ChatGPT 连接说明](https://developers.openai.com/codex/sign-in-with-chatgpt)；采集时均跳转到官方 `learn.chatgpt.com/docs/` 对应页面，HTTP 200。
- [Pi v0.99.0 发布说明](https://github.com/earendil-works/pi/releases/tag/v0.99.0)，迁移结论依据已完整读取的发布正文，而非仅凭 legacy 名字推断。

### 持久证据

- [官方关键原文快照](evidence/openai-codex-login-20261029/official-excerpts.md)：含所摘取全文的哈希、原文行号与 URL。
- [采集源与目录版本响应记录](evidence/openai-codex-login-20261029/sources.json)。
- [Pi 发布正文快照](evidence/openai-codex-login-20261029/pi-release-v0.99.0.md)。
- 上述三种请求的 fixture 脚本、完整 payload 与日志。

公共资料通过只读 curl／Python GET 采集，未携带用户认证。direct 分支 11 页最终均 HTTP 200；Codex 的主要资料也成功返回，个别 Help Center／政策页面 403 与探索中的 404 均未当作证据。当前 Pi 官方源码／文档与安装包相关文件做过身份核对，但不将最新公共目录视作账号权限。

**没有进行**真实登录、真实凭据读取、用户账号模型目录调用、模型推理、套餐账单对账、同账号 A/B、性能或长期稳定性测试。本次未修改产品代码、依赖、授权状态或计费配置，只新增研究文档与隔离证据。结论是有公开文档与本机实现依据的选型建议，不是上游权限和运行质量保证。
