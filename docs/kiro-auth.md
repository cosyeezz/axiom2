# Kiro 账号认证（原生、仅认证）

Axiom 新增独立的 `kiro` 提供商。它不依赖运行 Kiro CLI、kiro.rs 代理或读取其他应用的凭据文件。

**当前范围是登录、令牌保存、刷新及本地退出，不包含 Kiro 模型目录或推理协议。** 登录后不会出现可聊天的 Kiro 模型；不要把它配置成 OpenAI 兼容接口。源码更新需经过正常构建、重启后台才会生效，本次未部署或重启服务。

## 登录方式

在模型设置中添加 OAuth 提供商 **Kiro（仅认证）**，选择：

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

- `providers/kiro-auth.ts`：认证、刷新及协议校验。
- `providers/kiro-callback.ts`：短生命周期 loopback 回调与手动回填。
- `providers/kiro.ts`：空模型目录和拒绝误调用推理的护栏。
- `model-runtime.ts`：只有配置、凭据或主动登录需要 Kiro 时才加载；添加菜单只列元信息。

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

Portal URL 参数、刷新请求字段及响应解析已有当前 CLI 的函数级证据；Social 首次换码的完整调用链仍未恢复，其字段主要参考 kiro.rs。详见[认证静态对照](kiro-protocol-audit.md)。**未进行真实账号验证，不宣称 IDE 与 CLI 所有调用语义一致**。不伪造个人 profile ARN、机器指纹或未证实的客户端身份头。

## 证据及对照边界

### 参考项目

- [hank9999/kiro.rs](https://github.com/hank9999/kiro.rs/tree/22f36e692ad387c46581a84daf0d563347e330a3)：固定版本主要提供导入及刷新，不含完整首次登录。
- [ZyphrZero/kiro.rs](https://github.com/ZyphrZero/kiro.rs/tree/4cac2a8b887eacf4c8119558d3c1906e43f8cbd4)：基于前者，增加 OIDC device 与 Social Portal PKCE。参考 `src/kiro/auth/{idc,social}.rs`、`src/admin/service.rs`、`src/kiro/token_manager.rs`。
- 两者采用 MIT（Copyright 2026 hank9999）。本实现独立编写，参考协议与请求字段，不运行其项目代码。

### 官方发布包

- 官方安装入口：<https://cli.kiro.dev/install>；仅静态读取，未执行脚本。
- 固定版本：**Kiro CLI 2.33.1**，来自官方 stable manifest。
- 发布包：<https://prod.download.cli.kiro.dev/stable/2.33.1/Kiro%20CLI.dmg>
- DMG 346,514,290 字节，SHA-256 `f544b4f9de51a457e1ed0849ffdf2be7b6b70af491330006b01cb71fa2111f44`，与 manifest 匹配。
- 提取的 CLI arm64：35,976,848 字节，SHA-256 `e8e64f78c9067b0a8f977ed3ca8b81167c02c61f800bb442f8d8d2448c7f16a6`。
- 官方当前 CLI 非完整开源；`aws/amazon-q-developer-cli` 的 1.19.7 是历史参考，不能当作 2.33.1 对应源码。

### REA 状态

Hopper 6.6.0-demo 已从官方发布渠道安装，哈希、macOS 代码签名和系统公证检查通过，但进程停在启动阶段，未建立分析桥接。已安装并校验 Ghidra 12.1.4 与 JDK 21，通过独立无界面 REA 通道避开宿主固定 60 秒超时。默认分析在 Decompiler Switch Analysis 阶段超过 900 秒；改用禁用该分析器及 Non-Returning Functions - Discovered 的有限分析配置后分析成功。该配置会限制自动控制流推断，不能视作完整默认分析。**本轮有限范围的函数级对照已完成，Social 完整换码链等仍有证据缺口**；已核验项、失败项和完整 Evidence ID 见[认证静态对照](kiro-protocol-audit.md)。

REA `inspect_rust_binary` 已核验上述 CLI 文件身份，证据 `ev_15f2ef8549957c48d13cbe887dcc93556189588e7382a898368fec21071a9789`。该工具未发现 `.dep-v0`，仅提取到 Rust 编译器路径线索，**不恢复认证函数或运行行为**。普通 shell 字符串摘录与参考源码阅读不是 REA 反编译证据；出现同一端点字符串不能证明对应分支已执行。

### 公开标准与官方说明

- [Kiro Authentication](https://kiro.dev/docs/getting-started/authentication/)
- [AWS RegisterClient](https://docs.aws.amazon.com/singlesignon/latest/OIDCAPIReference/API_RegisterClient.html)
- [AWS StartDeviceAuthorization](https://docs.aws.amazon.com/singlesignon/latest/OIDCAPIReference/API_StartDeviceAuthorization.html)
- [AWS CreateToken](https://docs.aws.amazon.com/singlesignon/latest/OIDCAPIReference/API_CreateToken.html)
- [RFC 8628 §3.5](https://www.rfc-editor.org/rfc/rfc8628#section-3.5)

## 验证

Kiro 专项 **11/11** 通过；受影响的运行时、OAuth、网络 worker、CodeBuddy 和并行 Qoder 回归 **26/26** 通过；全量与 server TypeScript 检查通过。此前冷 snapshot 回归在恢复动态目录时被发现，已修复并重跑：静态/auth-only 提供商不刷新，动态提供商仅恢复存在的缓存，不创建冷缓存。

离线测试覆盖身份分流、OIDC/Social 请求差异、PKCE/state、轮询退避、注册过期、刷新锁、失败保留凭据、取消/超时、错误脱敏、回调端口释放，以及真实 worker 的登录/重开/空目录/其他 OAuth 隔离。fixture 禁止实际网络连接；只有回调单元测试使用本机随机 loopback 端口。

真实账号登录、企业策略、权限、计费、动态 profile 与模型调用均未验证。当前实现应视为待联调的认证适配；有限范围的静态对照与离线测试不代表官方支持或线上可用性保证。
