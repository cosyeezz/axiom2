# 当前官方 CLI：OAuth / endpoint 契约（只读静态核验）

## 结论
1. **新 Kiro runtime 不是仅桌面存在**：当前 CLI 自身包含 `https://runtime.us-east-1.kiro.dev`、EU/Gov/隔离区 runtime 映射、`api.krs.service`/`api.cps.service` 设置及 V3/KAS 入口；V3 还明确把 endpoint/region override 转成 agent 参数。**但不能据此宣称当前所有默认 CLI 请求都走新 runtime**；V1/V2/V3 并存，二进制保留旧 CodeWhisperer streaming SDK。未做运行时请求，未证明每个引擎的实际 endpoint/operation 路由。
2. **OAuth 导入入口仍未证实**。公开 root/login/profile/chat help 无 token import；`KIRO_API_KEY` 是独立身份。新增发现 `_kiro/auth/getAccessToken` ACP covenant 和 `get-kas-token` 内部 CLI wire description：这是从官方存储加载/按需刷新后供 KAS 使用，不是接受外部 OAuth 的导入入口。不要调用其正文：会读真实凭据，且可能刷新/写数据。
3. `generateassistantresponse`/`generateAssistantResponse` HTTP 路径在当前原始 binary 中均无 literal 命中；却有 **`AmazonCodeWhispererStreamingService.GenerateAssistantResponse`、`application/x-amz-json-1.0`、`x-amz-target`**。这是当前 CLI 保留 Smithy AWS JSON/event-stream 实现的证据，不可把桌面新 REST path 直接套到该实现，也不可因同名 operation 认为协议一致。

## 当前产物与证据
- Binary `/tmp/kiro-cli-static.Bz5akg/binaries/kiro-cli-chat-arm64`，196434336 bytes，SHA256 `1061c72fc190e0772ab74202c9ce1acbb83e11e8ab7e6a68a3aa3cf2e41a19d4`，help `--version` 为 `kiro-cli-chat 2.33.1`。
- 本目录 [cli-contract-evidence](cli-contract-evidence/) 保存本轮原始 help 和 raw byte excerpt JSON；旧 [REPORT.md](/tmp/kiro-auth-reuse-research/REPORT.md) 仅作背景。旧小体积同版本 binary 的函数地址、三 scope 结论不得迁移。
- 以下地址为当前 Mach-O **静态首选 VA（字符串地址，不是函数入口）**；`__TEXT` fileoff=0，vmaddr=`0x100000000`，故下列 TEXT VA=file offset+该基址。ASLR 未加。LINKEDIT 中压缩符号名碎片只可当搜索线索，不能当函数地址；`nm -nm` 成功但未提供可用 Rust auth 定义符号。

## 主 REA 精确搜索清单
|搜索字串 / 源路径线索|file offset / 首选 VA|用途与证据界限|
|---|---|---|
|`https://runtime.us-east-1.kiro.dev`（字符串从 https 起）|URL 主体 `kiro.dev` 命中 0x8ae85d5 / 0x108ae85d5，见 endpoint-excerpts.json|`chat_cli_v2::api_client::endpoints`，紧邻 `endpoints.rs:176`；EU、Gov 及 management 映射同簇|
|`api.krs.service` / `api.cps.service`|0x47e859d / 0x1047e859d；0x47e85ac / 0x1047e85ac|设置描述明确 KRS/CPS endpoint override 是 JSON object；不要臆造其 schema|
|`KIRO_KAS_ENDPOINT` / `KIRO_KAS_CONTROL_PLANE_ENDPOINT` / `KIRO_KAS_REGION`|0x8abe3fc / 0x108abe3fc 起|`launch/kas_endpoint_overrides.rs:51,68,76,115`；V3 region 应用于两服务；单 region 不一致有告警|
|`--endpoint=` / `--control-plane-endpoint=` / `--region=`|0x41f3c00 左右 / 0x1041f3c00 左右|格式化字串：runtime 必须 HTTPS 或 loopback HTTP；control-plane 因携 token，仅允许 loopback override。精确分支需 REA|
|`AmazonCodeWhispererStreamingService.GenerateAssistantResponse`|operation 名后缀 0x477820e / 0x10477820e|完整 target 在此前的 `AmazonCodeWhispererStreamingService.` 起；`operation/generate_assistant_response.rs:229`|
|`GenerateAssistantResponseRequestSerializer`|0x47770e5 / 0x1047770e5|追踪 POST/path/content-type/target、body serializer 与 event-stream response；不能由附近 InvokeMCP target 推导 generate 请求|
|`GenerateAssistantResponseInput`|0x4777813 / 0x104777813|附近 `profileArn`, `agent_mode`, `additional_model_request_fields`, `system_prompt`；邻接不等于完整 wire schema|
|`kirocli:odic:token`（odic 原拼写）|0x8ae9303 / 0x108ae9303|`auth/builder_id.rs:431..520` load/refresh；另一簇 0x47c3a1f|
|`BuilderIdToken`|0x8ae9b55 / 0x108ae9b55|`access_token`, `expires_at`, `telemetry_generation`, `start_url`, `oauth_flow`, `scopes`；8 字段序列化元数据，region/refresh_token 的归属及 optional/default 需反序列化代码确认|
|`kirocli:odic:device-registration`|紧邻 BuilderIdToken 前|client_id/client_secret/client_secret_expires_at；必须原注册；不是随机生成客户端|
|`kirocli:social:token`|0x8aea221 / 0x108aea221|`auth/social.rs:86,191..296`；`SocialToken` 六字段；无 profile ARN 视为 invalid|
|`/refreshToken`|0x41e1d9a / 0x1041e1d9a|当前 social refresh，附近 `refreshToken`/`User-Agent`；默认 auth base 在 0x8aea92a 的 kiro.dev 命中，完整 `https://prod.us-east-1.auth.desktop.kiro.dev` 从此前开始|
|`kirocli:external-idp:token`|见 static-excerpts.json|新增 external IdP loader/refresh：`token_endpoint`, `issuer_url`/`issuer`, form-urlencoded, `grant_type`；不能混作社交/BuilderID|
|`get-kas-token` / `_kiro/auth/getAccessToken`|0x47bf7c9 / 0x1047bf7c9；后者见 0x8ad7461 附近|`GetKasTokenArgs` 含 reason、current-expires-at（ISO8601 informational）、force-refresh；401 recovery 可强制网络刷新|
|`handle_kas_auth_ext_method`, `social_callback_token`, `builder_id_callback_token`, `external_idp_callback_token`, `parse_force_refresh`|LINKEDIT 符号碎片，见 contract-excerpts.json 与 static-excerpts.json|REA 按名字搜索；输出字段邻接 `accessToken`, `expiresAt`, `authMethod`, `profileArn`。不是外部注入 API|
|`get_profile_for_api_key`|0x47c3776 / 0x1047c3776|`Using custom endpoint for API key`, `Trying GetProfile`, `GetProfile failed on all endpoints`，需查 endpoint 尝试顺序|
|`TokenTypeInterceptor` / `modify_before_signing`|0x8ae5374 / 0x108ae5374；完整方法符号碎片见 contract-excerpts.json|CLI API client 独立 token type 分类；不要只用 telemetry header 推断模型 header|
|`x-kiro-profile-arn`, `API_KEY`, `EXTERNAL_IDP`, `x-kiro-token-type`|后者 0x8c7c88c / 0x108c7c88c|该簇明确属于 `kiro-telemetry/src/delivery.rs`，**不是模型传输头的直接证据**|

## profile / region / scopes 与 refresh 契约
- **Profile**：社交当前有 `social token has no profile ARN, treating as invalid`，登录和刷新缺 ARN 均有拒绝/回退检查字串；刷新提示“no profile ARN and no existing ARN available”，说明需核验保留已有 ARN 的分支。IdC 是 ListAvailableProfiles/选择 profile；`api.codewhisperer.profile` 是存储键/选择线索，不证明能任意 override 服务授权。当前 binary 亦含示例/测试/疑似 fallback ARN，不应复制为用户 profile。
- **Region**：IdC login help `--region`；当前消息明确 managed `idc_region`、flag、remembered region 只 seed interactive prompt，stdout 非终端会丢弃，应从 terminal sign-in。`auth/partition.rs:159` 明确拒绝不支持区域，返回 `https://oidc.invalid`。runtime/management 商业区表有 us-east-1、eu-central-1，另有 Gov/isolated partition；这不证明每个登录方式/账户都支持全部区域。V3 KRS/CPS 共用一个 region，不能随意拆分。
- **Scopes**：当前能确认保存 `scopes`，存在 `api.oidc.scopePrefix`（描述 string）、默认独立 `codewhisperer:` 字面量、social ` offline_access` 格式化字串。**当前完整三 scope 名称的合并 literal 未命中**；不能以旧 q-source 三 scope 或桌面五 scope 作为当前事实。旧 scope.rs 的“集合精确相等”也仅历史 contract。REA 应追 portal/builder_id 注册 scope 构造及设备注册有效性检查。`openid` 大量命中属于 MCP/external IdP discovery，不能归因官方 BuilderID scopes。
- **Refresh**：BuilderID 当前诊断直接要求 token 与 registered client 的 `oauth_flow` 匹配；无 registered client 拒绝刷新。存在 `invalid_grant but peer token in store; returning peer’s token`、refresh lock、store changed 后拒绝写 stale token：官方实现已有跨进程刷新协调/轮换保护。不要并行拥有同一 refresh token，也不要绕过 store/import 限制。
- **OAuth 配置注入**：当前 `KIRO_ACCESS_TOKEN`, `KIRO_REFRESH_TOKEN`, `KIRO_TOKEN` 未命中；这只排除这些字面名称，不是穷尽入口证明。`KIRO_HOME`/`KIRO_DATA_DIR`/测试 DB 名称是路径/测试入口，不是公开凭据导入。`api.kiroauth.service` + `KIRO_AUTH_PORTAL_URL` 仅 auth 服务/门户覆盖，不是 OAuth token 接收参数。设置 help 确认可写 KEY/VALUE，但本轮仅 help，未读或写任何用户设置。

## 执行记录 / 未验证
工作目录 `/Volumes/D_Work/axiom2`。对目标逐项 `--help`, `login --help`, `profile --help`, `chat --help`, `settings --help`, `serve --help`, `--version` 均 exit 0。探测 `internal --help`、`get-kas-token --help` 均 exit 2（未识别），因此不能把嵌入内部命令说明说成公开 root 命令。静态 Python hash/byte extraction 和 `nm -nm <binary>` exit 0；一个全文件 URL regex 扫描超时 20s，已改成有界 literal 搜索完成，不把超时当成功。

未读真实 token、DB、秘密日志；未执行 token getter/登录/刷新正文，未写 CLI 数据，未发模型/网络请求，未调用 REA。尚需主 REA 以当前 hash 跟踪：engine→endpoint resolver→request serializer；API-key 与 OAuth identity precedence；KAS token covenant caller 和 store loader；current scope 构造/registration validity。本报告是当前产物的静态契约和定位证据，不是服务接受性或 live routing 证明。
