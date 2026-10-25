# Kiro CLI 2.33.1：认证静态对照

## 结论与范围

Axiom 的个人/企业认证适配已实现并完成离线验证；本次 REA 对照取得了 **Portal URL 构造、OIDC PKCE 查询参数、默认 scopes、Social 刷新及响应解析**的函数级证据。它不是完整认证协议恢复，也不是线上可用性证明。使用方式、参考项目固定版本及验证结果见 [Kiro 认证](kiro-auth.md)。

只分析官方公开发布产物，未运行目标 CLI、读取本机真实凭据或进行真实登录。以下“观察”指静态产物观察，不表示实际网络请求已发生。

## 目标与分析条件

- 官方发布包：<https://prod.download.cli.kiro.dev/stable/2.33.1/Kiro%20CLI.dmg>。
- 提取的 arm64 Mach-O：35,976,848 字节，SHA-256 `e8e64f78c9067b0a8f977ed3ca8b81167c02c61f800bb442f8d8d2448c7f16a6`。
- REA + Ghidra **12.1.4**，JDK 21；通过独立 MCP 文件队列规避宿主 60 秒超时。
- 默认分析超过 900 秒；成功配置禁用 `Decompiler Switch Analysis` 与 `Non-Returning Functions - Discovered`，不是完整默认分析。
- 分析 profile digest：`5186a0b786d023ad8b8e8fb3e86333c71df08c25040e95af823592db3f9ebd82`。
- Rust 异常展开可能使伪代码包含邻接函数；结论限于相关正常路径，scopes 另用函数边界和汇编核对。精确字符串地址的空 xrefs 不代表未使用：Rust 格式串引用可能指向前缀元数据。

## 函数级观察与实现对照

| 对象 | 官方产物观察 | Axiom 对照与边界 |
| --- | --- | --- |
| Portal 入口 | `fig_auth::portal::get_auth_portal_url` (`0x1007d8360`) 默认 `https://app.kiro.dev`，支持 `KIRO_AUTH_PORTAL_URL` 覆写；`build_auth_url` (`0x1007d7990`) 引用 `/signin?state=`、`code_challenge`、`code_challenge_method=S256`、`redirect_uri`、`redirect_from=kirocli` 格式串。[P] | 同一默认入口与基础参数；不跟随任意环境变量覆写。官方附加的组织/external IdP 参数不等于本次均已支持。 |
| OIDC PKCE 查询 | `PkceQueryParams::as_query_params` (`0x100780dc8`) 构造七项：`response_type=code`、`client_id`、`redirect_uri`、**`scopes`（复数）**、`state`、`code_challenge`、`code_challenge_method`；动态值经过百分号编码。[Q] | 当前查询字段一致。该函数不证明注册与换码完整调用链。 |
| 默认 scopes | `fig_auth::scope::get_scopes` (`0x1007d7694`) 默认前缀 `codewhisperer`，遍历三个 string slice：`completions`、`analysis`、`conversations`，映射函数以冒号连接。前缀可由官方设置覆写。[S] | Axiom 请求这三项默认 scopes，不把参考项目额外的 transformations/taskassist 当成必需条件；不保证企业一定授权这些 scopes。 |
| Social 刷新 | `FUN_100dffeac`（xref 种子 `0x100e01444`）等路径调用 `get_kiro_auth_endpoint`，拼接 `/refreshToken`，构造 JSON 键 `refreshToken`，设置 JSON Content-Type；成功路径检查 2xx 后解析响应。[R] | Axiom 使用 `/refreshToken` 和 `{refreshToken}`。本次未闭环恢复端点配置的所有取值、完整 HTTP method 构造及客户端头语义；POST 与默认域名还参考 kiro.rs。 |
| Social 响应 | `FUN_100d6732c` 解析 `TokenResponse` 四个字段，分支常量与字段表相互印证：`accessToken`、`refreshToken`、`expiresIn`、`profileArn`。刷新函数中 profile 非空采用响应，否则回退旧值。[T] | Axiom 保存相应信息，刷新缺失 profile 时保留旧值；显式空字符串被严格校验拒绝，**并非完全复制 CLI 的空值回退行为**。Axiom 还兼容参考项目的 RFC3339 `expiresAt`，不能把这一兼容能力称为该 CLI 响应契约。 |

源码：[kiro-auth.ts](../app/src/server/providers/kiro-auth.ts)、[kiro-callback.ts](../app/src/server/providers/kiro-callback.ts)、[kiro.ts](../app/src/server/providers/kiro.ts)。

## 部分回答与未解决项

1. **Social 首次换码未完整反编译。** `/oauth/token`、`/oauth/device/authorization`、`/oauth/device/poll` 和 callback/state 错误消息已取得 REA 内存字节证据 [M]；主入口 `0x100c749a0` 的伪代码因 `Response buffer size exceeded` 失败，替代汇编的函数 body 不完整。原始 Mach-O 的 ADRP/ADD 扫描仅辅助定位，不冒充 REA 函数证据。Axiom 的 `code/code_verifier/redirect_uri` 主要依据固定版本 kiro.rs，不能宣称当前 CLI wire 字段全部确认。
2. `0x1003b4e78` 的 `code_verifier` 引用位于 AWS `CreateTokenInput` 的 **Debug 格式化函数**，不能用调试字段推断 Social JSON，也不能据此把 AWS JSON camelCase 改成 snake_case。
3. **时间语义未完全恢复。** `expiresIn` 字段存在已确认；CLI 如何换算/提前刷新、与 `expiresAt` 的关系及 Social device interval 单位未闭环。本实现的秒到毫秒转换采用标准/参考实现，非这次反编译独立证明。
4. **Social device flow 能力有官方文档依据，但本次不实现。** [官方 Remote machine authentication](https://kiro.dev/docs/getting-started/authentication/) 明示 Builder ID、IAM Identity Center、Google、GitHub 支持远程设备流程；仅凭端点字符串不足以编造轮询字段及状态。
5. 企业 profile 策略、external IdP 直连、GovCloud 实际可用性、真实账号权限/计费及任何模型推理行为均未验证。个人 Builder ID 与企业 Identity Center 分流是实现设计，并结合官方文档与参考源码，不仅凭符号名称作判断。

未发现上述已核验字段与当前实现需要纠正的冲突；这不意味着未知部分已证明兼容。本记录仅覆盖认证子集。后续已增加实时模型目录，见[目录静态对照](kiro-catalog-audit.md)；后续原生文本/工具聊天实现见[推理静态对照](kiro-inference-audit.md)，仍待真实账号联调；本认证证据不能替代推理协议或服务接受性验证。

## 可追溯证据索引

完整 Evidence ID 如下，同组应联合阅读，不能用一个字符串读数替代调用链：

- **[P] Portal**：`ev_24d488f1b09498fb398f46891a9cac484dac8b024780eb36fa65d74885517acc`（build_auth_url）；`ev_6151d300b4fba3a423ad6610514cbb2254d951808b33feda175b69d41ecb9dcd`（格式串内存）；`ev_2e24b5c36ff70aee6a7de0d8ee1c1039df89834fb5b1fd99fe66dcd7faab0c12`（默认入口）。
- **[Q] OIDC 查询**：`ev_f50b857fd90cf0785747512c0cd5e2916f75c271c43b00f490135a1f1e2d2bf7`（函数）；`ev_09db7d5c12a8ac79903d4c3baabe3a4b7da322e8d7e61f4561dad1fa84028fd8`（查询格式串内存）。
- **[S] scopes**：`ev_6da53bccd581d11609883ea21526368afd99cd95769fa4c3a0fa279e35642cd4`（get_scopes）；`ev_558c8dfd620ce9b63a3bd00d69425795f38913bd43e36d5f02fd2f5d2ceb7e68`（三项 slice 表）；`ev_5b8114875e22bc68b86f9f63234eb988ce4c88133942f72d899f76b543139e7e`（文本）；`ev_bf1a1ea8f0864e59138094e602834ecce0004381b4513b6756c70bb2aa679f5d`（映射函数）；`ev_85b4c9f9a45ef7961448b47798182a1feaad575427e0a74e8ba4c645fd752aac`（汇编）。
- **[R] 刷新**：`ev_f29ce3c11ff34abab3a6c1894cd2f5490a1c1a168bd8baa05f706e0d91eabfa7`（批量反编译，包含部分失败项）；`ev_e96420b94802d870225411aa13ba53f79674c26568f2a52e366500ac85c6b17b`（JSON helper）。
- **[T] 响应**：`ev_886df357993732bd2315203c3c77f6d322613cf853a888ae5fab4dc13b04dfcb`（解析函数）；`ev_71a2a9885f65b4c8c9447ff76da2122fd5d9f00d2b8f81b88e4178af8877397f`（42 字节字段表）。
- **[M] Social 端点字符串簇**：`ev_64ff70b1f64b19247ddf221c19fb892a071e6590de056ab98f7c028df7223176`。

该认证阶段原环境的临时证据包：`/tmp/kiro-cli-static.Bz5akg/rea-ghidra-evidence.json`，44 条记录，2,487,524 字节，SHA-256 `e5c547775ce471431bc934d1e86bfbc91aac92324a111f654fa93c8b6c91d4ba`。完整查询响应及派生 C 文件当时位于 `/tmp/kiro-cli-static.Bz5akg/rea-ghidra`。这些是原认证分析环境的临时文件，不随仓库分发；当前 Windows 推理复核无法访问，不能把它们当作仓库内可用链接或本轮重新验证的文件。原环境应在系统清理前另行保留需要复核的产物。导出结果的 `unknowns=0` 仅是账本字段，**不消除本文列出的分析未知项与失败记录**。
