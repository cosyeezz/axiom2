# Kiro 原生账号、目录与聊天

Axiom 新增独立的 `kiro` 提供商。它不依赖运行 Kiro CLI、kiro.rs 代理或读取其他应用的凭据文件。

**当前实现登录、令牌保存、刷新、本地退出、当前账号实时模型目录，以及原生文本/图片聊天、工具调用与可配置思考等级。** 登录后「拉取模型列表」→加入模型草稿→保存，再在会话中选择该模型。原生协议为 `kiro-chat`，不是 OpenAI 兼容接口；账号令牌不会交给通用或自定义接口。目录存在不代表账号具备推理权限，真实账号/上游服务接受性仍待联调。源码更新需正常构建、重启后台才生效，本次未部署或重启服务。

## 登录方式

在模型设置中添加 OAuth 提供商 **kiro**，选择：

| 身份 | 本次支持的流程 | 需要提供 |
| --- | --- | --- |
| 个人 AWS Builder ID | 浏览器 PKCE（推荐）或设备授权 | 浏览器中的个人账号 |
| 个人 Google / GitHub | Kiro Portal 浏览器 PKCE | 浏览器中的个人账号 |
| 企业 IAM Identity Center | 浏览器 PKCE（推荐）或组织允许的设备授权 | 管理员提供的 Start URL、目录所在 AWS 区域 |

Builder ID 也是 AWS OIDC 协议，但它是**个人身份**，不能把 `idc` 传输等同于企业账号。企业认证区域与模型服务区域不是同一概念。Builder ID 固定使用 `us-east-1`；企业使用输入的目录区域。此适配不支持 AWS 中国区域。

- 本次不支持独立 `external_idp`（如直接连接 Entra 的 Kiro 组织登录），但经 IAM Identity Center 联邦到组织 IdP 的正常登录不受此分类限制。
- [官方认证文档的 Remote machine authentication 章节](https://kiro.dev/docs/getting-started/authentication/)说明 CLI 支持 Google / GitHub 的 device flow；但本次未完成其请求字段、状态及毫秒单位的函数级核验，因此没有猜测实现。
- 企业管理员可能禁止设备授权或限制应用、scope、profile；不要通过切换入口绕过组织限制。请选择组织允许的浏览器登录；本次不实现 profile 列表与其设备授权策略筛选，也不宣称登录成功就获得任何模型访问权。
- GovCloud 仅适用企业身份；本次没有 GovCloud 真实联调，不能据接受区域输入推断账号可用。

浏览器回调仅监听服务端 `127.0.0.1`。远程访问 Axiom 时，如果浏览器不能自动回到该服务端，可将浏览器最终显示的完整 loopback 回调 URL 粘贴回登录提示；**不要粘贴 access/refresh token**。回调含临时授权码，请不要分享到日志或聊天中。

同一 `kiro` ID 仅保存一个账号；重新登录或从个人切换企业会替换该账号。失败或取消不会先删除原凭据。退出仅删除 Axiom 本地凭据，不代表已向上游撤销授权。

## 与其他 OAuth 的隔离

- [kiro-auth.ts](../app/src/server/providers/kiro-auth.ts)：认证、刷新及协议校验；裸 OAuth 不派生通用接口密钥。
- [kiro-callback.ts](../app/src/server/providers/kiro-callback.ts)：短生命周期 loopback 回调与手动回填。
- [kiro-catalog.ts](../app/src/server/providers/kiro-catalog.ts)：固定端点原生模型目录、分页及响应校验。
- [kiro.ts](../app/src/server/providers/kiro.ts)：按账号凭据代次隔离的目录缓存，以及原生聊天提供商接线。
- [kiro-chat.ts](../app/src/server/providers/kiro-chat.ts)、[kiro-chat-protocol.ts](../app/src/server/providers/kiro-chat-protocol.ts)、[kiro-eventstream.ts](../app/src/server/providers/kiro-eventstream.ts)：私有认证交接、消息/工具转换、AWS 流帧与错误处理。
- [model-runtime.ts](../app/src/server/model-runtime.ts)：只有配置、凭据或主动登录需要 Kiro 时才加载；添加菜单只列元信息。

继续复用 Axiom 的登录管理、按供应商隔离的网络 worker、凭据存储锁与取消机制；不修改全局 fetch 或其他供应商的 OAuth 回调。`auth.json` 按 provider ID 分条存储，包含刷新所需的客户端注册信息，不应公开。应用目前一次只允许一个认证流程；Kiro 等待授权时，其他登录需等它完成或取消。

## 协议实现

### AWS OIDC：Builder ID / IAM Identity Center

固定区域端点 `https://oidc.{region}.amazonaws.com`：

1. `POST /client/register`：public client，注册所需 grant 与 scopes。
2. PKCE：注册精确 loopback `redirectUris`，打开 `/authorize`，使用 `scopes`（复数）查询字段；校验 state 后通过 `/token` 发送 `authorization_code`、`codeVerifier`、`redirectUri`。
3. 设备流程：`POST /device_authorization`，展示验证码，按服务端 interval 轮询 `/token` 的 device grant。缺失 interval 默认 5 秒，每次 `slow_down` 对后续间隔累计增加 5 秒。
4. 刷新：`POST /token`，发送 `clientId/clientSecret/refreshToken/grantType=refresh_token`。

`clientSecretExpiresAt` 是 Unix 秒级绝对时间，转换为毫秒保存；到期后要求重新注册登录，不将旧 refresh token 绑定到新客户端。`expiresIn` 为秒；刷新未返回新的 refresh token 时保留旧值。

本次请求三个 scopes：`codewhisperer:completions`、`codewhisperer:analysis`、`codewhisperer:conversations`。REA 已从 Kiro CLI 2.33.1 的 `get_scopes`、映射函数及常量表核验这三项默认值；这不是所有配置下的完整运行契约或账号授权保证。参考 kiro.rs 的五项 scopes 中额外的 transformations/taskassist 不作为本次认证必需条件。

### Google / GitHub Portal

入口 `https://app.kiro.dev/signin`，携带独立随机 state、S256 challenge、loopback origin 和 `redirect_from=kirocli`。回调只接受 Google / GitHub 分支，向 `https://prod.us-east-1.auth.desktop.kiro.dev/oauth/token` 交换授权码，JSON 使用 `code/code_verifier/redirect_uri`；刷新 `/refreshToken` 使用 `{refreshToken}`。

Portal URL 参数、刷新请求字段及响应解析已有此前审查的 CLI 2.33.1 的函数级证据；Social 首次换码的完整调用链仍未恢复，其字段主要参考 kiro.rs。详见[认证静态对照](kiro-protocol-audit.md)。**未进行真实账号验证，不宣称 IDE 与 CLI 所有调用语义一致**。不伪造个人 profile ARN、机器指纹或未证实的客户端身份头。

## 实时模型目录

「拉取模型列表」走原生 `Provider.refreshModels`，不是通用 OpenAI `/models`，也不把内置名单或旧缓存当成实时结果：

- AWS JSON `POST /`，目标 `AmazonCodeWhispererService.ListAvailableModels`，`origin=KIRO_CLI`；`origin`、可选 `profileArn` 和分页 `nextToken` 同时写入 query 与 JSON body，使用当前账号 Bearer access token。
- 固定服务端点：没有 profile 时使用 `q.us-east-1.amazonaws.com`；显式 profile ARN 的区域可选美国或法兰克福 `q.eu-central-1.amazonaws.com`。**SSO 认证区域不是模型服务区域。** 不接受自定义 Base URL，不跨区域或去掉 profile 猜测重试，不伪造个人 profile。
- 每次请求完成所有分页后才发布目录；总超时 15 秒、最多 20 页、每页 2 MiB、最多 1000 个唯一模型。格式错误、循环分页、401/403/429 等均报错，不发布半份列表或显示缓存伪装的成功。
- 仅采用服务返回的模型 ID、名称、有效 token 限额及 supportedInputTypes 声明。未知限额不显示为 0 上下文；含 IMAGE 时展示并传递图片能力，缺少/仅未知输入声明显示待确认，思考等级另按明确的 kiro.rs 兼容配置提供（不是目录声明），零值单价只是 SDK 占位，**不表示免费、已验证能力或可推理权限**。
- 原生图片协议现已接入，`supportedInputTypes`（`TEXT`／`IMAGE`）及其来源随 V2 目录缓存保留；旧 V1 文本能力标记迁移为上游未知，不自动开启图片。`supportsPromptCache` 仍未映射为缓存行为。缺字段不是 false；工具／思考没有本次已核实的对应目录字段。思考采用单独的明确 backend ID 兼容配置，不凭名称子串猜测，详见[思考等级配置](kiro-thinking.md)。用户明确的能力覆盖和主动禁图设置仍保留，详见[图片请求](kiro-images.md)。
- 空目录意味着本次接口确实返回空数组，不用静态条目补齐。企业账号仍可能需要已选定的 profile 和组织授权；本次不提供 profile 枚举/切换界面。

目录成功后以白名单字段缓存到 `models-store.json`，用于离线重开、导入保存和任务快照恢复；磁盘不存该接口的完整响应、原始 token 或 profile ARN。缓存绑定认证方式、认证区域、refresh token、profile 和服务区域的 SHA-256 摘要，并在 OAuth 刷新前后分别校验。换账号、注销、profile 变更、令牌轮换或损坏的缓存不会被恢复成当前账号目录。同一凭据代次请求失败时可保留旧目录供已有配置离线恢复，但拉取操作仍失败；令牌轮换后网络失败时可能暂时无目录，需要再次拉取。摘要用于隔离，不是缓存签名；不提供多进程全局最新写入保证。退出不会清除历史目录文件，但凭据作用域不匹配会阻止恢复。

现代目录协议的官方产物、历史源码和第三方参考差异见[目录静态对照](kiro-catalog-audit.md)；认证证据另见[认证静态对照](kiro-protocol-audit.md)。没有使用真实账号调用受保护接口，因此仍需线上联调。

## 文本、图片与工具调用

- 原生 `GenerateAssistantResponse` 使用 AWS JSON 请求与 AWS event-stream，不走 OpenAI `/chat/completions`。推理固定到 `https://runtime.us-east-1.kiro.dev/` 或显式欧洲 profile 的 `https://runtime.eu-central-1.kiro.dev/`；目录仍使用独立的 `q.*.amazonaws.com`。不采用自定义 Base URL、静默换模型、跨区域试探或制造 profile。
- 完整 Axiom 系统提示放入协议首条用户消息前缀，历史保留文本、原始工具调用 ID 和关联结果；当前消息使用用户选定的模型 ID。名称不符合线格式时进行可逆别名映射，不删改 JSON Schema 或改变工具权限。
- 回复逐块流式显示。正式工具事件需完整结束、合法 JSON 对象、匹配声明工具和本地 schema 才成为成功调用；坏帧、截断、空回复、重复 ID、孤立结果和异常不会伪装为正常完成。字面 `<invoke>` 不创建工具；仅主动启用思考时识别回复起始 `<thinking>` 控制块，正文引用或代码示例保持原样，原生思考事件仍可接收。
- OAuth 刷新继续由 Pi 凭据锁管理；只有原生适配器内部使用 access token。通用交接仅含短期、一次性、不透明凭证，不能作为上游 API Key 使用。退出不撤销上游令牌或已发出的网络请求，沿用 Axiom 活动执行停止流程。
- 支持当前/历史用户图片及工具返回图片，格式为 PNG/JPEG/GIF/WebP，使用原生 images/source.bytes，不走 OpenAI 图片字段，工具结果保留 ID/status 和各文本块；详见[原生图片请求](kiro-images.md)。仍不支持助手预填充，不猜测温度、生成长度等字段；不会伪造签名、机器号或官方客户端身份。思考配置现已按 kiro.rs 接入预算标签或原生 effort，并兼容前导思考标签和原生思考事件；详见[思考等级配置](kiro-thinking.md)。这不是官方 caller 等效或线上接受性证明。完整签名历史续接仍未实现，可见历史思考转为 assistant 上下文，opaque/签名省略并记诊断。
- 请求最多 10 MiB；单帧 16 MiB、全流 64 MiB、100,000 事件、1,024 工具/调用、单工具参数 1 MiB。默认 10 分钟总时限，支持取消；适配器自身对 HTTP/流异常仅一次请求，但 Pi agent 上层仍可能重试，输出后的跨层边界尚待对齐，见[等效审计](kiro-cli-parity-audit.md)。精确 token 用量仅来自服务报告，credits/百分比单独记录，未知费用的零值不是免费保证。

Kiro 执行进程的 HTTP 池默认空闲保留时间现为 60 秒，直连与 HTTPS 代理同用，并仍遵守更短服务端提示、取消及进程隔离；其他供应商默认值不变。连接复用机制、本机 HTTPS/H2 验证及限制见[连接池保活优化](kiro-connection-pooling.md)。这不是活动请求超时或线上免握手保证。

协议来源、官方客户端路由静态链、两份 kiro.rs 的防御措施取舍、验证与未验证项见[推理静态对照](kiro-inference-audit.md)。旧目录 `kiro-auth-only` 缓存可归一化为新协议；显式保存的旧占位 API 或 OpenAI 覆盖不能用于聊天，应重新拉取并添加原生模型。

## 证据及对照边界

### 参考项目

- [hank9999/kiro.rs](https://github.com/hank9999/kiro.rs/tree/22f36e692ad387c46581a84daf0d563347e330a3)：固定版本主要提供导入及刷新，不含完整首次登录。
- [ZyphrZero/kiro.rs](https://github.com/ZyphrZero/kiro.rs/tree/4cac2a8b887eacf4c8119558d3c1906e43f8cbd4)：基于前者，增加 OIDC device 与 Social Portal PKCE。参考 `src/kiro/auth/{idc,social}.rs`、`src/admin/service.rs`、`src/kiro/token_manager.rs`。
- 两者采用 MIT（Copyright 2026 hank9999）。本实现独立编写，参考协议与请求字段，不运行其项目代码。

### 此前认证审查的官方发布包

以下是此前认证审查保留的 macOS 2.33.1 证据，不是本轮 Windows 目录分析的目标，也不代表最新 stable 版本。本轮目录目标为本机 Windows CLI **2.12.0**；查询到的最新 stable manifest 为 **2.34.0**，没有下载或安装该新版。

- 官方安装入口：<https://cli.kiro.dev/install>；仅静态读取，未执行脚本。
- 固定版本：**Kiro CLI 2.33.1**，来自官方 stable manifest。
- 发布包：<https://prod.download.cli.kiro.dev/stable/2.33.1/Kiro%20CLI.dmg>
- DMG 346,514,290 字节，SHA-256 `f544b4f9de51a457e1ed0849ffdf2be7b6b70af491330006b01cb71fa2111f44`，与 manifest 匹配。
- 提取的 CLI arm64：35,976,848 字节，SHA-256 `e8e64f78c9067b0a8f977ed3ca8b81167c02c61f800bb442f8d8d2448c7f16a6`。
- 官方当前 CLI 非完整开源；`aws/amazon-q-developer-cli` 的 1.19.7 是历史参考，不能当作 2.33.1 对应源码。

### 此前认证审查的 REA 状态

以下记录发生在原 macOS 认证审查环境；本机 Windows 的隔离组件和目录函数分析另记于[目录静态对照](kiro-catalog-audit.md)。

Hopper 6.6.0-demo 已从官方发布渠道安装，哈希、macOS 代码签名和系统公证检查通过，但进程停在启动阶段，未建立分析桥接。已安装并校验 Ghidra 12.1.4 与 JDK 21，通过独立无界面 REA 通道避开宿主固定 60 秒超时。默认分析在 Decompiler Switch Analysis 阶段超过 900 秒；改用禁用该分析器及 Non-Returning Functions - Discovered 的有限分析配置后分析成功。该配置会限制自动控制流推断，不能视作完整默认分析。**本轮有限范围的函数级对照已完成，Social 完整换码链等仍有证据缺口**；已核验项、失败项和完整 Evidence ID 见[认证静态对照](kiro-protocol-audit.md)。

REA `inspect_rust_binary` 已核验上述 CLI 文件身份，证据 `ev_15f2ef8549957c48d13cbe887dcc93556189588e7382a898368fec21071a9789`。该工具未发现 `.dep-v0`，仅提取到 Rust 编译器路径线索，**不恢复认证函数或运行行为**。普通 shell 字符串摘录与参考源码阅读不是 REA 反编译证据；出现同一端点字符串不能证明对应分支已执行。

### 公开标准与官方说明

- [Kiro Authentication](https://kiro.dev/docs/getting-started/authentication/)
- [AWS RegisterClient](https://docs.aws.amazon.com/singlesignon/latest/OIDCAPIReference/API_RegisterClient.html)
- [AWS StartDeviceAuthorization](https://docs.aws.amazon.com/singlesignon/latest/OIDCAPIReference/API_StartDeviceAuthorization.html)
- [AWS CreateToken](https://docs.aws.amazon.com/singlesignon/latest/OIDCAPIReference/API_CreateToken.html)
- [RFC 8628 §3.5](https://www.rfc-editor.org/rfc/rfc8628#section-3.5)

## 验证

认证/目录阶段的专项 25/25、通用回归 25/25 和类型检查是历史基线，不替代新增聊天代码验证。本轮聊天、工具及运行时测试记录见[推理静态对照](kiro-inference-audit.md)。冷启动不创建空缓存的既有保护保持不变。

隔离模拟覆盖认证分流、PKCE/state、轮询退避、注册过期、刷新锁、错误脱敏、取消及端口释放；另覆盖 CLI query/body 双写、地区/profile 选择、分页/限额、HTTP 错误、响应体大小、迟到响应释放、账号/令牌轮换隔离、同 scope 损坏缓存清空、失败不发布部分列表、认证竞争导致跳过刷新时不能宣称实时成功，以及 worker 登录/拉取、导入保存、重开与快照恢复。新增原生聊天测试使用合成 AWS 流帧；保存、重开及快照模型通过 Pi 两个完成入口实际到达原生适配器。恶意 API/Base URL 覆盖则在发送账号令牌前失败。供应商网络使用模拟响应，worker fixture 禁止真实 socket；回调和通用网络测试仅使用本机动态端口。

真实账号登录、企业策略、权限、计费、动态 profile 与模型调用均未验证。当前实现是**待真实账号联调的原生认证、目录及聊天适配**；静态对照与隔离测试不代表官方支持或线上可用性保证。
