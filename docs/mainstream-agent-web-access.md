# 主流 Coding Agent 的搜索与网页读取实现对比

> 调研日期：2026-10-27。重点回答“产品实际怎么做”，而不是只列搜索服务商。开源项目优先核对最新正式发布 tag；闭源项目以官方披露为准，不反推未公开内部实现。本轮仅公开文档与静态源码研究，没有运行这些产品的联网功能，没有使用现有密钥调用付费 API。
>
> 本文补充 [Axiom 网络访问接入方案](axiom-web-access-research.md)。特别修正前轮对 OpenCode 主要取样开发分支的局限：**正式版已有独立 `websearch` 和 `webfetch`，且托管 MCP 搜索允许无 key 使用。**

## 1. 结论先看

主流项目并没有采用同一种网络底座，但有三条清晰路线：

1. **宿主工具型**：Agent 自己接搜索服务，再由客户端 HTTP 读页面。OpenCode 最典型，模型供应商不必提供搜索能力。
2. **供应商托管型**：模型 API 提供搜索、读页及引用。Codex 默认走此路线；Claude Code 的搜索也依赖 Anthropic 后端。
3. **模型委托型**：工具再发一次模型请求，让另一个模型负责搜索/阅读并整理答案。Gemini CLI 很典型；Claude Code 的 WebFetch 多数也包含独立模型提取。

这些路线可以混用。**“工具名字叫 fetch”不代表返回原始正文，“没有用户 API key”不代表没有远端服务或长期无限免费。**

| 产品 | 搜索实际由谁执行 | 网页读取实际怎么做 | 工具层是否额外生成/提取内容 | 关键依赖与边界 |
|---|---|---|---|---|
| **OpenCode v1.19.4** | Exa / Parallel 托管 MCP | 本机 HTTP；HTML 用 Turndown 转 Markdown，或提取 text / 返回 HTML | 所查 fetch 实现不额外调用模型；搜索返回 MCP 服务提供的文本 | 无 key 路径明确存在；非 OpenCode/OpenCode Go provider 通常需 flag 才暴露搜索 |
| **Claude Code** | Anthropic web search 后端，不可配置替换 | `WebFetch(url, prompt)`；HTML→Markdown；多数再独立调用模型提取 | **是，多数 fetch 返回提取结果而非原页** | 搜索后端、提取库/模型不是宿主可替换模块；另有组织策略与域名预检 |
| **Codex rust-v0.164.0** | 默认 Responses API hosted `web_search` | 同一工具支持 search / open page / find in page | 搜索/页面工具结果由服务端提供，最终由主模型作答；未见客户端本地正文提取链 | 默认 cached；live/disabled/indexed 可配；与 shell 网络许可不是同一通道 |
| **Gemini CLI v0.65.0** | 额外 Gemini 请求 + Google Search grounding | 默认 Gemini URL Context；失败后本机抓取，再发模型合成 | **是，返回合成内容与来源** | 强依赖 Gemini API；本机 fallback 与云端主路径是不同网络执行位置 |
| **Cline v4.1.26** | 支持且启用时使用所选模型 provider 的原生搜索 | SDK `fetch_web_content` 调本机 fetch executor，返回正文片段及分析请求 | 所查默认本地 executor **不单独调用模型做摘要** | 原生搜索取决于 provider/model 能力；Exa 搜索插件示例不是默认后端 |

## 2. 取样版本：正式版、开发分支与闭源披露分开

| 项目 | 本轮正式版取样 | 固定源码 commit |
|---|---|---|
| OpenCode | [v1.19.4](https://github.com/anomalyco/opencode/releases/tag/v1.19.4)，2026-10-22 | `148842ef7cb1bc34192b3fff57d0f9721ab9c801` |
| Codex | [rust-v0.164.0](https://github.com/openai/codex/releases/tag/rust-v0.164.0)，2026-10-23 | `6aaac694803004a63c6f393d153c96d22521a6b9` |
| Gemini CLI | [v0.65.0](https://github.com/google-gemini/gemini-cli/releases/tag/v0.65.0)，2026-10-20 | `6006c14a4decfe4b891c6263ad6ad5992e404b5b` |
| Cline | [v4.1.26](https://github.com/cline/cline/releases/tag/v4.1.26)，2026-10-26 | `a459f1d04dea030833b558be645011ab739c463b` |
| Claude Code | 当日官方 tools reference / data usage | 核心实现非公开源码；文档中新增行为另有版本条件，不能当所有旧安装的默认行为 |

固定 commit 按实际 tag 解析结果核对；annotated tag 使用 peeled commit，不把 release API 的 `target_commitish` 当作 tag commit。

前轮 OpenCode commit `dae4077a96243257ea0a2086068504b791629f10` 属开发分支，含五供应商插件、配置 UI 与 CodeMode fetch 重构。它可以作为架构参考，**不能替代正式版的默认产品行为**。同一个正式 tag 下 `packages/opencode` 与 `packages/core` 也有不同执行路径，不能混用限额与超时结论。

## 3. OpenCode：最接近模型无关宿主的参考

### 3.1 搜索：宿主内建工具直接调用托管 MCP

正式版 CLI 注册的名字是 **`websearch`**，不是依赖模型 API 的 native search 才能使用。

```text
模型调用 websearch(query, ...)
  → 工具权限规则
  → 选择 Exa 或 Parallel
  → HTTP POST，JSON-RPC tools/call
  → 解析 JSON 或 SSE 中的 MCP 文本
  → 将服务返回文本交给主模型
```

- Exa：`https://mcp.exa.ai/mcp`，远端工具 `web_search_exa`。没有 `EXA_API_KEY` 就用裸端点；有 key 时添加 `exaApiKey` 参数。
- Parallel：`https://search.parallel.ai/mcp`，远端工具 `web_search`。有 `PARALLEL_API_KEY` 才添加 Bearer header；没有也会发起调用。
- 官方文档明确写 **“No API key is required”**。不是先启动一个本地 MCP server，也不是要求用户自己搭建搜索系统。
- 工具可见性有门槛：OpenCode/OpenCode Go provider 自动提供；其他 provider 可用 `OPENCODE_ENABLE_EXA=1` 或 `OPENCODE_ENABLE_PARALLEL=1` 开启；全局 `OPENCODE_EXPERIMENTAL=1` 也会启用 Exa。**“无 key”与“所有会话默认可见”是两回事。**
- provider 选择优先显式 `OPENCODE_WEBSEARCH_PROVIDER`，再看 provider flags；均无指定时按 sessionID checksum 在两者间稳定分配，**不是失败后自动换另一家**。
- Exa 参数包括 `query`、`numResults`（默认8）、`type`（默认auto）、`livecrawl`（默认fallback）、`contextMaxCharacters`。Parallel 映射为 `objective/search_queries`；CLI 另发送 `session_id/model_name`，同 tag core 只发送 `session_id`，不发 `model_name`。两家服务及 CLI/core 的披露内容不是完全相同。
- 工具路径未见自有正文缓存，但 Exa 的 `livecrawl: fallback` 允许供应商使用已有内容；不能因此声称每次都实时抓原站。

源码：[CLI websearch](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/opencode/src/tool/websearch.ts)、[MCP helper](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/opencode/src/tool/mcp-websearch.ts)、[注册门禁](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/opencode/src/tool/registry.ts)、[运行 flags](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/opencode/src/effect/runtime-flags.ts)；官方：[tools](https://opencode.ai/docs/tools/)。

### 3.2 读网页：HTTP + 格式转换，不默认再请模型摘要

正式版 **`webfetch`** 接收 `url`、`format`、`timeout`；format 默认 Markdown，也支持 text / html。

```text
模型调用 webfetch(url, format)
  → 工具权限规则
  → 本机 HTTP GET，按 format 设置 Accept
  → HTML：Turndown 转 Markdown，或 htmlparser2 提取文本
  → 直接返回转换结果
```

这里的 Turndown 是格式转换，不等于 Readability/Defuddle 的文章主体发现。所查代码不默认启动浏览器，也不为了 fetch 另发一次模型请求。CLI 对部分图片可返回附件；core 的相应文本工具路径会拒绝图片/非文本内容。

支持 Markdown 内容协商；普通请求使用浏览器样式 UA，特定 Cloudflare challenge 会换 `opencode` UA 重试一次。它不是完整动态浏览器渲染或验证码解决方案。

**不要只凭工具提示词推断实现。** 比如该版本 CLI 的描述文件说会自动将 HTTP 升 HTTPS，但所查 execute 直接使用传入 HTTP URL，不能据描述宣称已经强制升级。权限也是先交给规则系统判断，不是代码出现 `ctx.ask` 就必定每次弹窗；官方工具文档说大部分工具默认允许，仍可按工具/URL pattern 配置 ask/deny。

源码：[CLI webfetch](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/opencode/src/tool/webfetch.ts)、[工具描述](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/opencode/src/tool/webfetch.txt)；官方：[permissions](https://opencode.ai/docs/permissions/)。

### 3.3 同一项目的两条实现，安全限制不能混称

| 限制 | `packages/opencode` CLI 工具 | `packages/core` 对应工具 |
|---|---|---|
| search 超时 | 25s 包住 HTTP execute；随后读 body 不在该 timeout 范围 | 25s 包住请求、body读取及解析 |
| search body | helper 使用 `response.text`，未见此层显式大小上限 | 256 KiB bounded streaming |
| fetch 大小 | 5 MiB；先查 Content-Length，读完整 arrayBuffer 后再查大小 | 5 MiB bounded streaming |
| fetch 超时 | 默认30s、上限120s；所查 timeout 包住 execute/重试，不覆盖后续 body读取 | 默认30s、上限120s；覆盖 execute 与 body读取，后续同步转换另论 |

这不是整产品漏洞利用结论，而是**明确的代码作用域差异**。不能把 core 的防护写成 CLI 已具备，也不能用“设置了30s”替代总 deadline 验证。

源码：[core search](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/core/src/tool/websearch.ts)、[core fetch](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/core/src/tool/webfetch.ts)、[bounded body](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/core/src/tool/http-body.ts)。

## 4. Claude Code：搜索固定后端，Fetch 是任务导向的有损提取

### 4.1 WebSearch

官方披露的流程：

```text
WebSearch(query, allowed_domains 或 blocked_domains)
  → Anthropic web search backend
  → 内部可能反复优化搜索（每次工具调用最多8次后端搜索）
  → 返回标题和URL
  → 需要读页面时再调用 WebFetch
```

- 内置搜索后端不可改成 Brave/Exa。要用其他服务，应另接 MCP 搜索工具。
- allowed/blocked domains 不能同时使用；权限规则用整个 `WebSearch`，没有域名 specifier。结果域名过滤与是否允许执行搜索是两层配置。
- 当前官方文档列交互会话默认200次 WebSearch 调用，主对话与子代理共享。可提高上限；较新版本支持按小时补充额度。headless / Agent SDK 按 turn 计，不是交互式会话的相同重置边界。
- 支持情况取决于模型接入平台；例如官方明确 Amazon Bedrock 不暴露该 server-side search 能力。不能因为能用 Claude 模型，就保证该接入方式一定有搜索。

**已知后端是 Anthropic web search，不知道它内部具体使用哪家搜索引擎或混合索引；不能断言是 Google、Bing 或 Brave。**

### 4.2 WebFetch

```text
WebFetch(url, prompt)
  → 权限/组织策略与域名安全预检
  → 获取页面，HTML 转 Markdown
  → 多数请求：独立模型调用，按 prompt 提取
  → 主模型收到提取结果，不是完整原始页面
```

官方直接说明 **“lossy by design”**：结果说“没找到某项内容”，可能只是提取 prompt 没有要求它找，而非网页真的不存在。不能把这种返回值当完整证据副本。

其他已公开行为：

- HTTP 自动升级 HTTPS；拒绝 localhost 与无点 hostname。
- 每次最多读取100,000字符；较新版本会告知长文未读部分。
- 内容缓存默认15分钟；下载 deadline 默认5分钟，包含所跟随重定向；相关环境变量可调整，均有最低版本条件。
- 跨 host redirect 不直接跟过去：返回目标 URL，让 Claude 另发一次 WebFetch。
- `User-Agent` 以 `Claude-User` 开头；Accept 优先 Markdown，能直接协商到 Markdown 就不必先收 HTML。
- Manual / acceptEdits 中受 allow/ask/deny 与预批准文档域名共同控制。域名规则可以保存，但不意味着所有外网或 shell 流量自动受同一边界限制。

**预检也是一次额外披露**：WebFetch 默认先向 `api.anthropic.com` 发送 hostname 检查安全黑名单，通过结果缓存5分钟；不发送完整 URL/path/页面内容。该预检不因换模型 provider 或关闭 nonessential traffic 而自动关闭，可以显式设置 `skipWebFetchPreflight`。这是产品安全/联网依赖的取舍，不是“本地 fetch 从不联系 Anthropic”。预检所述披露范围也不能套到后续模型提取阶段。

官方：[工具行为](https://code.claude.com/docs/en/tools-reference#webfetch-tool-behavior)、[WebSearch](https://code.claude.com/docs/en/tools-reference#websearch-tool-behavior)、[域名安全预检](https://code.claude.com/docs/en/data-usage#webfetch-domain-safety-check)。

### 4.3 不要混同 Anthropic API 的同名工具

API 的 `web_search_...`、`web_fetch_...` 是 **server tools**，有独立版本、参数和响应块。当前版本支持代码执行中的动态过滤；API fetch 可以返回文档/PDF并提供引用。**这些事实不能直接证明 Claude Code 的 WebFetch 内部就是该 API 工具。**

同理，API 公开搜索价为 $10/千次加 token，API fetch 无额外工具费用但有 token；它们不是 Claude Code 各订阅计划的工具收费承诺。WebSearch 一次工具调用还可能 fan-out 成多个后端搜索，不能把UI调用次数等同账单请求数。

具体提取模型、HTML→Markdown库、缓存所在介质、完整 DNS/代理安全实现，本轮公开文档不足以确认。

API官方：[web search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)、[web fetch](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool)；产品计费：[Claude Code costs](https://code.claude.com/docs/en/costs)。

## 5. Codex：默认用服务端搜索/读页，不是在本机维护 scraper

正式版默认主要是 **Responses API hosted `web_search`**。协议中可观察的动作包括 `Search`、`OpenPage`、`FindInPage`：发现来源、打开页面、页内查找都可以属于同一工具体系，不要求额外暴露一个本地 `web_fetch`。

```text
Codex配置/托管策略
  → 给模型请求注册 hosted web_search
  → OpenAI服务端执行搜索、打开/查找页面
  → 返回调用事件、引用等内容
  → CLI投影为可见搜索活动
```

### 5.1 缓存与实时访问是显式产品模式

- **cached 默认**：使用 OpenAI 维护的索引；源码将 `external_web_access=false`。
- **live**：允许外部实时访问；`--search` 映射为 `web_search="live"`。
- **disabled**：不注册工具。
- **indexed**：该正式版也有此模式，传 `external_web_access=true, indexed_web_access=true`；官方描述为由索引 gate 允许的外部访问，不能把它与 cached 简单合并。
- full-access 模式默认优先 live，但仍受 managed allowed modes 限制；不是高权限就能覆盖组织策略。

cached 是远端索引策略，**不是本机15分钟URL缓存**；也不表示结果不含提示注入风险。

### 5.2 搜索网络与 shell 网络分离

官方明确 hosted search 不走本地 sandbox 的 proxy / domain allowlist；因此禁掉 sandbox 命令联网，搜索仍可能可用。**这不意味着离线可用或绕过操作系统防火墙**：CLI 到模型/搜索 API 的通道仍须可达。

搜索域名过滤也不限制 shell、MCP、应用连接器等其他出网。源码可确认把 allowed domains 传给服务端，不能据此证明服务端每一次读页都满足本地 egress 白名单语义。

新 CLI 配置使用 `tools.web_search.context_size / allowed_domains / location`；不要把下游 API 的 `search_context_size / filters / user_location` 直接当作当前 CLI 配置键。

### 5.3 默认 hosted 与实验 standalone 分开

同一版本还有 standalone `web.run` 扩展，但 feature 默认关闭、标为 UnderDevelopment，能力声明不能代表所有默认安装。自定义 provider 的 `supports_standalone_web_search` 也不等于任意模型可直接获得相同搜索能力；还要满足 provider、模型、runtime 与组织限制。

官方：[web search](https://learn.chatgpt.com/docs/web-search)。固定源码：[模式/CLI配置类型](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/protocol/src/config_types.rs)、[hosted tool构造](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/core/src/tools/hosted_spec.rs)、[search/open/find动作](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/protocol/src/models.rs)、[默认关闭的standalone](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/features/src/lib.rs)。

## 6. Gemini CLI：真正的“联网任务再委托给模型”

### 6.1 google_web_search

代码发起额外的 `generateContent({model:'web-search'}, ...)`，提取生成文本与 `groundingMetadata`，为来源插入引用编号，返回正文及 Sources。`web-search` 是逻辑模型别名；此 tag 默认继承 `gemini-3-flash-base`，对应 `gemini-3-flash-preview`，并配置 `{googleSearch:{}}`。`web-fetch` 配置 `{urlContext:{}}`，fallback 则不启用这些工具。这是可配置的 utility 模型调用，不是把 `web-search` 当成真实模型 ID。[默认模型配置](https://github.com/google-gemini/gemini-cli/blob/6006c14a4decfe4b891c6263ad6ad5992e404b5b/packages/core/src/config/defaultModelConfigs.ts)。

它不是返回原始 SERP JSON 的普通 search API adapter，而是 **Google Search grounding 后的合成回答**。所以即使主 Agent 只想找几个链接，工具也有模型处理、token及对应接入条件。

### 6.2 web_fetch

默认参数是含 URL 和处理指令的 prompt；官方说明最多20个 URL，但所查解析器未见相同的显式数量截断，不能把文档约定当硬性请求限额：

```text
解析/规范化URL、权限及目标检查
  → Gemini URL Context模型请求
  → 文本 + grounding来源
失败
  → 本机HTTP抓取
  → HTML转text、按需截断/跨URL分配预算
  → 再发一次Gemini请求完成内容合成
```

源码有 GitHub blob→raw URL 转换；fallback 使用 `html-to-text`。它不是“云失败就原样返回本机Markdown”，而是仍有一次模型合成。另有 `directWebFetch` 分支的直接 URL 读取模式，不能拿该分支替代默认 URL Context 流程。

源码：[search](https://github.com/google-gemini/gemini-cli/blob/6006c14a4decfe4b891c6263ad6ad5992e404b5b/packages/core/src/tools/web-search.ts)、[fetch](https://github.com/google-gemini/gemini-cli/blob/6006c14a4decfe4b891c6263ad6ad5992e404b5b/packages/core/src/tools/web-fetch.ts)；官方：[search](https://geminicli.com/docs/tools/web-search/)、[fetch](https://geminicli.com/docs/tools/web-fetch/)。

### 6.3 可借鉴的工程细节，也要看真正生效的路径

- `safeLookup` 检查全部 DNS 结果，直连 safe agent 将该 lookup 接入 undici connector，不只是请求前解析一次域名。这比单纯预检后把 URL 丢给普通 fetch 更值得借鉴。
- 本地抓取有 body 大小读取限制、私网地址分类、每host请求限流；按条件给多 URL 分配字符预算，避免一份大页面挤掉其余来源。
- 外部文本做 XML escape / untrusted wrapping，有助于维护指令/数据边界；**这不等于已经阻断语义提示注入**。
- 代理分支 `createSafeProxyAgent` 所查代码使用 `EnvHttpProxyAgent`，没有把直连的 safe connector 同样接入；不能沿用直连结论声称代理远端 DNS 也已被客户端 pin。
- `fetchWithTimeout` 的定时器在返回 response 后清理，不能只据该 helper 宣称慢 body 有相同的总 deadline。

官方 fetch 文档概括了验证与连接 pin；本轮源码审查能具体确认上述直连路径，**未做代理/DNS攻击实测，不能给“完整SSRF安全”认证**。

源码：[fetch/network utils](https://github.com/google-gemini/gemini-cli/blob/6006c14a4decfe4b891c6263ad6ad5992e404b5b/packages/core/src/utils/fetch.ts)。

## 7. Cline：SDK正文抓取与模型原生搜索是两件事

本轮正式版的 controller 入口导向 SDK controller。不能继续只凭旧版印象，把 `browser_action` 当成当前所有网页读取的默认实现；遗留 BrowserSession/URL 内容服务的存在也不证明运行时仍暴露同样工具。

### 7.1 fetch_web_content

默认装配已核到生产路径：VSCode session host → runtime builder → `createBuiltinTools` → `createDefaultExecutors` → `createDefaultTools`。Act/Plan preset 开启 `enableWebFetch`；VSCode host 不覆写 `webFetch`，因此未被策略禁用时沿用 SDK 的 `createWebFetchExecutor`，不是仅由示例或导出符号推断。自定义工具与策略仍可改变可用性。证据：[VSCode host](https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/apps/vscode/src/sdk/vscode-session-host.ts)、[runtime builder](https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/core/src/runtime/orchestration/runtime-builder.ts)、[工具工厂](https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/core/src/extensions/tools/index.ts)、[默认executor](https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/core/src/extensions/tools/executors/index.ts)。

参数是 `requests: [{url, prompt}, ...]`，SDK 工具调用 fetch executor：

```text
requests[]
  → 本机fetch，HTTP/HTTPS校验与取消传播
  → 流式body大小检查
  → 简化HTML→text / JSON格式化
  → 返回URL、类型、前50,000字符和原分析prompt
```

**schema 有 prompt，不等于 executor 已调用模型分析。** 所查默认 executor 只是把 prompt 附在 `Analysis Request` 后面返回，后续由上层 Agent 处理；不像 Claude Code WebFetch 那样多数在工具内部另跑提取模型。

- 默认 body 上限5,000,000字节；输出上限50,000**字符**，不能写成50KB。
- 有30s abort定时器，但 headers 返回后立即清理；大小限制不等于总 deadline。
- 该 executor 未见 DNS/IP 分类或连接 pin，不能原样当公网安全抓取层；这不是对 Cline 所有网络通道的整体安全判断。
- VSCode 的 tool policy 把 `fetch_web_content/web_fetch/web_search` 接到“浏览器/网络”自动批准开关，运行中仍可按当前 UI 状态决定是否提示。

### 7.2 web_search

运行时 catalog 明确描述为“所选模型 provider 的原生搜索”。要同时通过 provider/model 的 `supportsModelTool(...,'web_search')` 能力检查和 enabled model tools 选择；不是每个模型都自动具有一套独立 Exa 搜索。

仓库 `sdk/examples/plugins/web-search.ts` 是可安装的 Exa-backed 插件示例，不是产品所有用户默认启用的后端。**示例、catalog声明、实际启用条件必须分开看。**

固定源码：[生产controller入口](https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/apps/vscode/src/core/controller/index.ts)、[SDK runtime catalog](https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/core/src/extensions/tools/runtime.ts)、[fetch executor](https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/core/src/extensions/tools/executors/web-fetch.ts)、[VSCode工具策略](https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/apps/vscode/src/sdk/sdk-tool-policies.ts)、[搜索插件示例](https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/examples/plugins/web-search.ts)。

## 8. 对 Axiom 原方案的具体修正

以下是**设计建议，不是已实施决定**。

### 8.1 搜索：零配置托管 MCP 应当认真考虑，不只看 BYOK

前轮优先验证 Brave raw Search API 的建议偏重可控性；本轮确认 **OpenCode 的正式产品已经采用 Exa/Parallel 无 key 托管 MCP**，不是仅插件或实验猜想。

因此更贴近实际产品的候选应分两档：

- **零配置体验模式**：明确告知第三方与限流边界后，选择一个无 key 托管 MCP 搜索 adapter；Exa 有前轮单次成功证据，Parallel 本轮只核了源码/官方说明，未调用验证。
- **用户可控模式**：BYOK Search API / 用户自建服务，用于需要更明确额度、条款、质量和可观测性的场景。Brave/Tavily/Exa/Perplexity仍须质量与存储权审查，不因有 key 就自动有 SLA。

**这不等于偷偷为用户开启云服务或照搬 session hash 在两家公司间分流。** Axiom 应显式显示所选 provider、凭据来源和已知/未知成本；变更 provider 需要符合披露与授权策略。MCP只是协议，不要求把联网能力都做成外部常驻进程。

### 8.2 网页：保留证据型读取，按需增加任务型提取

- **证据型默认**：更接近 OpenCode，受控 HTTP + 本地提取 + 原文快照/续读，避免默认另一个模型先替主模型筛掉材料。
- **任务型可选**：借鉴 Claude Code / Gemini，提供按 prompt 提取或摘要，但清楚标注有损、所用模型、额外费用/数据流，并保留可回查来源。
- 不必马上因此增加第三个工具；可以先实现可靠的双工具契约，再决定可选提取参数或上层工作流。

### 8.3 工程参考应按职责选，不是照抄一家

| 职责 | 最有参考价值的实现 | Axiom不应直接继承的假设 |
|---|---|---|
| 模型无关、低配置搜索 | OpenCode MCP client / provider adapter | keyless永久免费、随机分流可无感进行 |
| 轻量页面转换 | OpenCode HTTP + format negotiation | 提示词宣称的行为等于代码已实现；所有分支都有同样限额 |
| 权限与主子代理预算 | Claude Code 域名规则、共享搜索上限 | 整个Agent已被网络工具权限隔离；一次toolcall只计一次后端query |
| 搜索/读页动作与引用 | Codex hosted Search/OpenPage/FindInPage | cached等于本机缓存；禁shell联网等于禁搜索 |
| 地址验证与连接绑定 | Gemini直连safe lookup/connector | 代理路径天然获得同等连接约束；XML包装可消除注入 |
| 多provider工具可用性 | Cline capability gate / SDK host policies | tool目录里有文件就代表所有模型与会话可用 |

总体建议仍是 **Axiom后台统一服务 + 薄Pi工具**。但是搜索产品路线不应被写死为“只能用户自备付费 key”；本轮把 OpenCode 式托管 MCP 路线提升为需要正式验证的低配置候选。Claude/Codex/Gemini的供应商专用能力可以作为增强，不能冒充对所有模型天然可用的基础能力。

## 9. 本轮验证边界

- 核查了正式tag源码、工具注册/入口、参数与execute行为、官方说明，并对独立研究中的路径混用与过度推断做了纠正。
- 未运行这些产品的真实工具请求；未比较搜索中文质量、时效、延迟或账单。前轮 Exa 单次无 key 实测只复用其有限结论。
- 未对DNS/代理/重定向实施攻击测试；源码作用域审查不等于漏洞复现或安全认证。
- 闭源产品的提取库、搜索引擎、底层网络实现与未公开额度不做猜测。Cursor本轮可查的浏览器/代码搜索资料不足以支撑其完整Web Search实现结论，因此不以“未找到某页”证明它没有该能力。
- API工具定价、订阅产品权益、keyless额度分别看待；正式接入仍需条款/存储/数据披露审查。
