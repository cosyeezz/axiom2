# Kiro 真实接入验收（进行中）

本轮依据 [交接](kiro-handoff.md) 继续排查。**真实接入仍未验收通过。用户要求所有修复必须依据当前 Kiro CLI 流程，桌面证据不可替代；自定 UUIDv5 和桌面流错误候选均已撤回、未部署。** 下列 UUID 红绿与182项通过是已撤回候选的历史证据，不代表当前源码验收。当前优先使用 REA 补齐客户端完整发送链，不将离线通过、模型目录存在或历史成功等同当前可用。

## 本轮真实文本诊断

2026-10-27T13:54:46Z，经 Axiom 正式 `/ws → prompt → agent worker → native provider`，在新建隔离普通会话中选择 `kiro / claude-sonnet-5.5 / off`。未改主会话或全局默认模型，不复制 token，不直连模型服务。

- 专用会话：`48c70fd3-2bb8-4c73-8c86-2bdd2b6038a1`。
- run：`71fe660c-b0d6-4ada-ad42-44d5e89a3020`，终态 `failed`，`MODEL_ERROR`。
- HTTP **400 / ValidationException**，`partial=false`。
- requestId：`d3d6c783-d9f3-4c6f-915f-f778d9120bfa`。
- 未观察到具体 validation reason；不能据此断言原始 body 没有 reason。
- 无输出文本、工具调用或工具结果；未做失败后的盲目重放、换模型重试或目录刷新。
- 一次逻辑 prompt；物理 HTTP 次数与服务端费用未独立核实。

[诊断输入](evidence/kiro-acceptance-20261027/text-diagnostic.txt)、[正式结果及 input/run/message 关联](evidence/kiro-acceptance-20261027/baseline-text.json)。驱动为 [kiro-acceptance.mjs](../app/scripts/kiro-acceptance.mjs)，原始 state 和退出码位于 `/tmp/kiro-acceptance-20261027-new/`。驱动不读取认证文件、不导入 provider、不直接请求 Kiro endpoint。它新建普通会话，不冒称走子任务调度器。

## 已撤回的 UUIDv5 候选

[请求序列化](../app/src/server/providers/kiro-chat-protocol.ts) 旧算法把 SHA-256 截取为 32 个 hex 后直接加横线，没有设置 UUID 的 version/variant：

| 会话 | 旧 conversationId |
| --- | --- |
| 本轮隔离会话 | `ae8dd963-3309-a749-0d4f-d97eb7f953fb` |
| 交接中的失败子会话 | `e6038fd7-712a-1f7b-2894-0ac771998833` |

二者均不满足 RFC UUID variant；第一项 version 也无效。曾实现标准 URL namespace 的 UUIDv5 候选并由独立 Python 核对四个黄金向量，但它不是基于当前客户端 caller 恢复的行为。按用户纠正，已精确撤回自己的 helper 和调用，恢复调查前的生产算法，不部署该候选。

**UUID 格式风险不是已证实的 HTTP400 根因，也不能据此自行选择 v5 修复。** 先从当前 Kiro 客户端恢复会话标识生成及传递策略，再决定如何对齐。

兼容影响：所有非空 session 的上游 conversationId 都会变化；本地 session、消息、工具 ID 和发送的 history 不因此删除。上游会话路由、粘性状态及缓存影响尚未实测。

### 与 kiro.rs 的精确区别

本机 `/Volumes/D_Work/Tools/kiro.rs/src/anthropic/converter.rs` 中，conversationId 优先采用 metadata 中的 session UUID，否则使用 UUIDv4；UUIDv5/OID namespace 用于 agentContinuationId。Axiom 的 v5/URL namespace 是自己的稳定映射，**不是逐字复制第三方的 conversationId 策略，更不是已证明与当前官方 CLI 等效**。

## 已完成的离线验证

候选 [UUID 回归存档](evidence/kiro-acceptance-20261027/uuid-candidate.test.ts) 先在旧实现上得到 2 fail / 1 pass，再在候选实现上通过。撤回后移出 app/tests，不将其作为当前测试套件。下面两组互不重叠的历史测试均针对候选快照：

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| UUID、chat、interrupted history、thinking、images、failure、observed reason，7 文件 | 148/148，exit 0 | [日志](evidence/kiro-acceptance-20261027/protocol-tests.log)、[命令](evidence/kiro-acceptance-20261027/protocol-tests.command) |
| native compat、runtime、tool input、usage，4 文件 | 34/34，exit 0 | [日志](evidence/kiro-acceptance-20261027/runtime-tests.log)、[命令](evidence/kiro-acceptance-20261027/runtime-tests.command) |
| `tsc --noEmit`、`tsc -p tsconfig.server.json --noEmit` | 均 exit 0 | [前端退出码](evidence/kiro-acceptance-20261027/types-client.exit)、[服务端退出码](evidence/kiro-acceptance-20261027/types-server.exit) |

[红灯日志](evidence/kiro-acceptance-20261027/uuid-red.log)保留原始失败。没有单独的 `kiro-eventstream.test.ts`，不把不存在的文件算作通过；帧解析测试位于 chat 等既有文件中。

候选测试期间 `kiro-chat-protocol.ts` SHA-256 为 `8534c3fcedbeb211c7d12ea0a12fc95c9efd778b236fa11b388db493ca004c9c`；runtime 组全部 provider TS 的 [前](evidence/kiro-acceptance-20261027/runtime-tests.sha256.before)/[后](evidence/kiro-acceptance-20261027/runtime-tests.sha256.after) 一致。撤回后源码 SHA 为 `38322c152b738f4bab426fbb71866d8cff10b181a24eedcc97bb6b8c77f66dc4`，不沿用候选测试宣布当前修复通过。

## 当前客户端 REA 取证

已使用当前 **REA MCP 6.8.0**，不是另启旧版 CLI。原始 13 MB 桌面 bundle 先后遇到 1024 MiB heap 上限及 300 秒 provider deadline，随后改为按原字节溯源的 AST module 切片；12 个 module slices 均通过 REA 语法分析，但动态调用/跨切片绑定仍有未知，不称完整真实发送链。

当前桌面默认 RPC target 为 `KiroRuntimeService.GenerateAssistantResponse`；Axiom 发旧 streaming target。桌面 SDK schema 的 `/generateAssistantResponse` trait 不等于其默认实际发送路径，不能只据它改 URL。桌面 conversationId 沿用执行参数/metadata，缺失才随机 UUID；Axiom 的哈希映射与其不同。**当前 CLI 同时包含旧 target、新 runtime 及多个引擎，仍需 caller 核证；尚不根据桌面差异直接部署改动。**

[当前产物、差异、REA Evidence 和局限](evidence/kiro-acceptance-20261027/current-client/README.md)；[桌面字段级对比](evidence/kiro-acceptance-20261027/current-client/desktop/REPORT.md)；[CLI 认证与 endpoint 静态契约](evidence/kiro-acceptance-20261027/current-client/cli-auth-contract.md)。CLI 只确认独立 `KIRO_API_KEY` 入口，未证实 Axiom OAuth 的受支持导入入口；不把 OAuth 当 API key，不写 CLI 数据库。

### CLI 原生分析未成功

REA 的正式 MCP 重载和实际状态调用已恢复，但 Ghidra 的前置全量分析在 330 秒及 600 秒均超时，**没有取得当前 CLI 的有效函数反编译或完整 caller→wire**。单函数查询并未降低其全量启动成本，已经停止此路线，不继续延长预算。没有证据证明 macOS 是根因或 Windows 会更快。

[完整恢复及失败记录](evidence/kiro-acceptance-20261027/current-client/recovery/STATUS.md)与 [CLI 普通静态定位](evidence/kiro-acceptance-20261027/current-client/cli-static/REPORT.md)已归档，后者不是 REA Evidence。撤回候选后，全部 23 个 provider 文件及 10 个测试文件与现有 **179/179、exit0** 基线精确同 SHA，因此复用该离线结果，不无谓重测；未新构建、部署或请求真实模型。见 [完整性核验](evidence/kiro-acceptance-20261027/current-client/archive-verification.json)。

## 官方 CLI 对照与后续验收

本机保存的官方 macOS arm64 CLI `2.33.1` 可以执行，初次 `whoami` 报 `Not logged in`。用户已授权研究复用现有 Axiom 授权给本地 CLI，不要求远端用户更新程序。必须核对受支持凭据入口及认证/profile/区域/scopes，不输出 token，不盲猜写 CLI 数据库。

下一步：

1. 先核实 REA 是否有不触发全量分析、能限定函数范围的当前 CLI 入口；只支持 symbol 的入口不能把地址冒充 symbol。入口可用后恢复登录、模型、会话/历史、headers/body、endpoint、最终发送链，与 Axiom 逐项比较。任何修复必须引用当前 CLI 依据，不自行设计替代；不再重试已结束的 Ghidra 全量尝试。
2. 用户已允许随时按后台重启 skill 重启；仅在有客户端证据支持的修复准备好后，完整构建、独立控制器重启并验证实际部署，再以新隔离 scope 验证同一模型文本。失败获取字段级诊断，不盲目重发。
3. 文本成功后，依次验证只读工具闭环、历史续接、思考开关、真实图片及工具图片、取消和恢复。
4. CLI 登录后，以同条件小型任务对照；请求协议/默认行为、能力和未验证项分别记证据。

不为了“完全一致”伪造官方身份、机器指纹或遥测；不把本地 EOF 成功推断当作已恢复完整官方结束契约，也不把缺失 usage 当作免费。
