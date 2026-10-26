# Kiro CLI 模型目录静态对照

## 结论与边界

本记录对应的目录阶段将 `kiro` 从仅认证扩展为**认证 + 当前账号实时模型目录**，当时未实现推理。后续原生聊天实现另见[推理静态对照](kiro-inference-audit.md)，不以本目录证据替代聊天验证。目录使用 CLI 的 AWS JSON `ListAvailableModels`，而不是 IDE 的 `GET /ListAvailableModels?origin=AI_EDITOR`，也不返回静态模型名单。

本轮以本机正式 Windows CLI **2.12.0** 的定向反汇编、原始 PE 字节、派生局部 PE 的 REA/Ghidra 函数结果，并结合历史官方 SDK 源码交叉核对。**没有真实账号调用受保护 API，没有完整反编译原始 CLI，也没有证明最新 stable 2.34.0 与本机版本完全一致。** 线上服务接受性、账号权限及组织策略仍需真实联调；本轮未部署或重启服务。

认证流程的历史 macOS CLI 2.33.1 证据继续单独保留在 [kiro-protocol-audit.md](kiro-protocol-audit.md)，不能混作本轮 Windows 目录证据。

## 目标与来源

| 项目 | 本轮核实结果 |
| --- | --- |
| 原始文件 | 本机已安装的 `Kiro-Cli/kiro-cli.exe`；Authenticode `Valid`，AWS 正式签名 |
| 版本 | 在隔离 HOME / USERPROFILE / XDG 目录中仅执行 `--version`：退出 0，`kiro-cli-chat 2.12.0` |
| 大小 | 528,630,968 字节 |
| SHA-256 | `0ff1d24eea11aa2e244524d635e1cfc8f9820522f4c5bc192fb99590d909320a` |
| 官方安装入口 | <https://cli.kiro.dev/install>，仅读取安装脚本，未执行 |
| 当前 stable manifest | <https://prod.download.cli.kiro.dev/stable/latest/manifest.json>，本轮读取为 **2.34.0**，未下载或安装该版本 |
| 历史官方源码 | [aws/amazon-q-developer-cli](https://github.com/aws/amazon-q-developer-cli/tree/15cc8f3cd18c4272925ce1c7053268eedff1ea0a)，commit `15cc8f3cd18c4272925ce1c7053268eedff1ea0a`；不是当前闭源 CLI 的对应源码 |

没有读取其他应用或本机真实账号的凭据文件。第三方参考项目仅静态阅读，没有运行。

## 为什么不照搬 kiro.rs

- [hank9999/kiro.rs](https://github.com/hank9999/kiro.rs/tree/22f36e692ad387c46581a84daf0d563347e330a3) 的 `src/anthropic/handlers.rs` 使用静态模型名单，不能满足实时账号目录要求。
- [ZyphrZero/kiro.rs](https://github.com/ZyphrZero/kiro.rs/tree/4cac2a8b887eacf4c8119558d3c1906e43f8cbd4) 的 `src/kiro/token_manager.rs` 使用 IDE 路线：`GET /ListAvailableModels?origin=AI_EDITOR`，无 CLI AWS JSON body / target / 分页链；另有去 profile、跨区域尝试和静态别名/限额。本实现不照搬这些行为，也不伪造 IDE 身份。
- 历史官方 SDK 提供了 POST、query/body 双写、必需响应字段及分页等可核查结构，但其业务 `Origin::Cli` 序列化为 `CLI`。当前 Windows 产物有新的 `KIRO_CLI` 枚举及实际业务初始化，不能把旧源码的 origin 原样套用。

## 原始 Windows PE 与派生分析

原始文件较大，本轮只定位并分析与目录相关的代码和数据。Microsoft Visual Studio `dumpbin /disasm:nobytes /range:<start>,<end>` 直接读取原始正式 PE。原始汇编及补充字节映射保留于 [evidence/kiro-catalog](evidence/kiro-catalog/README.md)，普通反汇编和字节检查不标记为 REA Evidence。

| 候选函数 / 数据 | 原始 VA | 对照用途 |
| --- | --- | --- |
| operation 内联 query 序列化 | `0x140b0a6f0` 内 | 根路径后拼接 origin / 可选请求字段 |
| body serializer | `0x140af7630`–`0x140af7937` | 请求字段写入 JSON body，包含 origin 枚举分派 |
| operation serializer | `0x140b0a6f0` | HTTP 方法、根路径、AWS JSON headers、query/body 调用链 |
| JSON body wrapper | `0x145acb0e0` | 写入 `{` / `}` 并在 `0x145acb16b` 调用 body serializer；原始汇编补证 |
| cache-miss 业务函数 | `0x1414589e0`–`0x14145b1c7` | 初始化目录请求、profile 及分页调用 |
| 被否定的初始候选 | `0x140af6b40` | 实际字段为 messageId / conversationId / origin，不作为目录 query 证据 |
| origin jump table | `0x145d6c1a8` | 枚举 index 8 指向 `0x140af7891` |
| origin 字符串 | `0x145d6bb67`，长度 8 | `KIRO_CLI` |

请求布局的相关偏移为：`nextToken +0`、`profileArn +0x18`、`modelProvider +0x30`、`origin +0x48`、`maxResults +0x60`。业务指令 `0x1414594f2` 将 `0x8000000000000008` 装入寄存器，随后写入请求 origin 槽；去除枚举 niche 标记得到 index 8。原始表项映射到字符串分支 `0x140af7891`，该分支取 `KIRO_CLI` 的 8 个字节。精确原始 offset、hex 和指令见 [origin-source-bytes.json](evidence/kiro-catalog/origin-source-bytes.json) 与 [origin.asm.txt](evidence/kiro-catalog/origin.asm.txt)。**这是一条静态调用/赋值链，不是对实际网络请求的抓包。**

### REA 分析载体及配置

为保留关键函数和相对 VA，同时避免对 504 MiB 原文件做无关全量分析，构造了 1,364,992 字节的分析专用派生 PE：

- SHA-256：`5fcb5f99e834cea3e8b1572d142c543da9be0b8c9fd2a2c59b30e3e227c50b36`。
- 保留原始区间：`0x140af6000–0x140b0c000`、`0x14139b000–0x14139e000`、`0x141458000–0x14145c000`、`0x145d60000–0x145e90000`。每段原始 offset、VA 和 SHA-256 见 [manifest](evidence/kiro-catalog/catalog-focused-ghidra-manifest.json)。
- PE 头被人为修改，导入、异常、重定位、签名等目录被清除。初版清除 executable-image 标志后被 REA Windows P0 拒绝；实际分析版本为静态导入保留该标志并将入口置零。两个派生文件均**未执行且不得执行**。
- 四个入口及候选名由 [seeds](evidence/kiro-catalog/catalog-focused-seeds.tsv) 人工指定；种子 SHA-256 `f749596a62c46540c14d7614445f22e0b2ac9b8651d7c2c48640f0439f91988c`。不是恢复的官方符号。

使用已安装 **REA 6.7.0** 的独立 CLI，不修改 Axiom 真实 REA 配置或共享 MCP：

```text
node <rea>/scripts/rea.mjs decompile <analysis-only.pe> <VA> --provider ghidra --format json
```

Ghidra **12.1.4** 仅在临时目录准备，官方归档 569,649,598 字节，SHA-256 `ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db`，完成整体哈希校验后才解压和使用；安全解压核查 6,695 个路径、类型、大小及 CRC。首次长路径解压失败，改用短临时根目录后成功，未修改系统长路径策略。Java 使用现成 JetBrains Runtime **25.0.2**，未另行安装 Java。`GHIDRA_INSTALL_DIR`、`JAVA_HOME`、`REA_GHIDRA_SEED_FILE` 仅对子进程设置；禁用 `Non-Returning Functions - Discovered`，其他采用 Ghidra 默认分析。**这不是未经修改的完整默认分析配置。**

完整 REA Evidence 及各次命令记录见 [证据目录](evidence/kiro-catalog/README.md)。四次命令均退出 0、stderr 为空，临时 Ghidra 会话随命令关闭；成功退出不等于恢复了完整控制流。

| Evidence | 结果及严格边界 |
| --- | --- |
| [operation](evidence/kiro-catalog/rea-operation-v2.json) `ev_7d64fbdc95e593a3bed7e6ff9a054c4bbe47f121ce8bfb6c4411e3e81e944f17` | 内联 query 路径可见先写 `/`，随后 `origin`（长度 6）、`nextToken`（9）、`profileArn`（10）及其他可选字段；同函数可见 `POST`（4）、`application/x-amz-json-1.0`（26）、`x-amz-target`（12）与 `AmazonCodeWhispererService.ListAvailableModels`（46），并调用外部 body wrapper `0x145acb0e0`。伪码尾部仍有 invalid-instruction 警告。 |
| [body](evidence/kiro-catalog/rea-body-v2.json) `ev_742ad66af12027369098315bd70e961a5639e047885a238cada8dcbb0a3a0444` | 确认请求布局和字段序列化；origin jump table **未自动恢复**，有类型传播不收敛、间接跳转警告。精确 index 映射由原始汇编和字节补证，不能声称 REA 伪码完整恢复了 switch。 |
| [caller](evidence/kiro-catalog/rea-caller-v2.json) `ev_c6d1ec54c8f99c8d5fcb9ebc227bd90a883a00421d9c688e991c7d8cf3d9eb11` | 可见 `[0x38] = 0x8000000000000008`（8 字节指针索引，即对象 +0x1c0）、请求起点 +0x178、`FUN_14139baa0(...)` 和 `func_0x000140abe6b0(...)`。**多处 bad-instruction / overlap / 未恢复 jump-table 警告，不能将整份伪码当成可靠完整业务控制流**；关键赋值和 call 必须与原始 caller 汇编核对。profile 与分页的语义还结合历史源码，而非仅按函数名断言。 |
| [初始 query 候选](evidence/kiro-catalog/rea-query-v2.json) `ev_c2b9892e9b040df14fc49c0d0d88a3c3e486b2d075386963f422aeca204424de` | **否定结果**：人工标签 `candidate_query_serializer` 不准确；伪码的字符串及传入长度显示 messageId / conversationId / origin，不是 ListAvailableModels 字段。保留原 seed 和 Evidence 供复核，不修改标签来掩盖错误，不把它用于证明目录 query。正确依据是 operation 内联 query。 |

body wrapper 不在派生范围内；[原始 wrapper 汇编](evidence/kiro-catalog/body-wrapper.asm.txt) 补足它在写 `{` / `}` 之间调用 `0x140af7630` 的链路。派生范围外 callee 缺失，仍有调用语义无法仅由局部伪码确定。字符串在 PE 中连续存储，反编译器可能显示后续无关文本（例如 GetUsageLimits）；本表按实际传入长度解释，不能将整串显示文本误当作当前字段或 target。

## 协议对照与实现

历史官方源码的关键位置：

- `crates/chat-cli/src/api_client/mod.rs`：`list_available_models` 设置 origin / 可选 profile，使用 SDK paginator，不主动设置 `maxResults`、`modelProvider`。
- `crates/chat-cli/src/api_client/endpoints.rs`：按显式所选 profile 选择美国或欧洲服务区域；没有 profile 时默认美国，不按 SSO 区域推断，也不在失败后换区/去掉 profile 重试。
- `crates/amzn-codewhisperer-client/src/operation/list_available_models.rs`、`protocol_serde/shape_list_available_models_input.rs`：POST `/`、query 和 body 字段双写、AWS JSON target。
- `types/_model.rs`、`protocol_serde/shape_token_limits.rs` 及输出 builder：`modelName` / `tokenLimits` 为可选；token 限额允许缺失 / null；每页要求 `models` / `defaultModel`；默认模型不是额外的列表身份。

Axiom 实现位于 [kiro-catalog.ts](../app/src/server/providers/kiro-catalog.ts) 与 [kiro.ts](../app/src/server/providers/kiro.ts)：

| 项目 | 当前实现 |
| --- | --- |
| 请求 | `POST https://q.{region}.amazonaws.com/?origin=KIRO_CLI[&profileArn=…][&nextToken=…]`；同字段 JSON body |
| Headers | Bearer access token；`Content-Type: application/x-amz-json-1.0`；`x-amz-target: AmazonCodeWhispererService.ListAvailableModels`；SDK invocation/request 标识 |
| 客户端身份 | 明确使用 `User-Agent: Axiom KiroCatalog/1.0`，不冒充官方 Rust SDK、IDE 版本、机器指纹或官方客户端；该 UA 的线上兼容性尚未验证 |
| 服务区域 | 默认 `us-east-1`；合法显式 profile ARN 可选 `us-east-1` / `eu-central-1`，不拿认证区域代替服务区域 |
| profile | 仅使用凭据中已有的合法 AWS codewhisperer/qdeveloper profile ARN；不生成占位 ARN、不提供 profile 枚举与交互选择 |
| 分页 | query/body 双写 `nextToken`；不额外设置 `maxResults`、`modelProvider`；按 ID 首次去重，完整成功后才发布 |
| 必需响应 | 每页校验 `models` 数组与 `defaultModel`；不把 default 自动补入目录，不补静态条目 |
| 模型字段 | ID、可选名称及 `tokenLimits.maxInputTokens/maxOutputTokens`；null 名称回退 ID；缺失 / null / 0 限额记为 SDK 未知值，UI 不显示为 0 上下文 |
| 本地防护 | 总超时 15 秒，最多 20 页、每页 2 MiB、1000 个唯一模型；限制分页 token、拒绝循环及畸形响应，释放取消/迟到响应体 |
| 失败处理 | 401/403/429 明确脱敏提示；不回显服务端 body、底层异常或令牌；无跨区、去 profile 或重定向试探 |

这些约束是本实现的安全边界，不应冒充官方服务的最大限额。初版仅声明文本输入；后续[原生图片实现](kiro-images.md)已映射 supportedInputTypes 的 IMAGE 并保留声明来源、V2 缓存，缺字段显示待确认。后续[思考等级配置](kiro-thinking.md)按明确 backend ID 的 kiro.rs 兼容策略提供已实现档位，未知 ID 默认不启用；不是上游目录声明，也不按名称子串推测。零价格仍是占位，不证明免费或账号推理权限。

## 实时完成与缓存隔离

接入原生 `Provider.refreshModels`，复用 Pi 的两阶段刷新、凭据锁和网络 worker，不走通用 `/models`。即使 SDK 在认证竞争中静默跳过网络，服务也必须检查本次成功发布的 generation 递增，并与当前磁盘凭据 scope 一致；否则拉取失败，不能将旧缓存显示为实时成功。

目录缓存白名单包含规范模型、版本、scope 摘要及 checkedAt，不保留原始 token / profile ARN / 完整响应。scope 输入包括认证方式、认证区域、refresh token、profile 和服务区域；OAuth 旋转前后均检查。换号、注销、legacy/unscoped store、损坏 store 及缺失 store 不保留旧暖内存目录。同 scope 的网络失败可留下原先合法目录供离线配置恢复，但拉取操作仍失败；分页中途失败不发布部分结果。摘要不是磁盘签名，也不是多进程全局最新写入保证。

推理没有实现：原生 `stream` / `streamSimple` 拒绝；OAuth `toAuth` 也拒绝派生推理 key，防止手动配置 OpenAI API / 自定义 base URL 绕过原生护栏发送账号令牌。目录入口拒绝 Kiro Base URL 覆盖。现有冷启动不创建空 store 的保护保持不变。

## 实际验证

在 `app` 目录运行，均退出 0；最后 nullable 字段调整之后已重新跑 Kiro 全专项和生产构建：

```text
node --import tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1 tests/kiro-auth.test.ts tests/kiro-callback.test.ts tests/kiro-catalog.test.ts tests/kiro-runtime.test.ts
# 25/25

node --import tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1 tests/model-runtime.test.ts tests/model-catalog.test.ts tests/model-network.test.ts tests/model-oauth-config.test.ts tests/model-oauth.test.ts tests/model-auth-preparation.test.ts tests/qoder-runtime.test.ts tests/codebuddy-runtime.test.ts
# 25/25；这些文件及受测通用逻辑在通过后未再改变

node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.server.json
npm run build
# tsc --noEmit && vite build && tsc -p tsconfig.server.json
```

隔离测试覆盖三类身份、双写分页、地区/profile、错误脱敏、响应大小与取消释放、缓存换号/注销/旋转/损坏、失败不发布部分目录、跳过网络不能伪实时成功，以及 worker 登录/目录、导入保存、重开、快照、固定端点和自定义推理护栏。上游响应均为 mock；worker 禁止真实 socket；回调和通用网络回归仅使用本机动态端口。构建仅有既有的 Vite 大 chunk 提示，不是错误。

**未验证事项**：真实账号认证/目录服务接受性、组织策略、企业 profile 选择权限、计费、模型能力和任何推理行为。目录的静态证据与隔离测试已具备，但不能凭目录阶段证据写成“线上实测可用”或“已完成聊天接入”；后续聊天实现与测试单独记录。用户操作说明见 [kiro-auth.md](kiro-auth.md)。
