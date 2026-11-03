# 当前 Kiro 客户端取证（进行中）

## 范围与事实边界

用户最新明确要求以**当前 Kiro CLI 的真实完整流程**为修复依据；桌面证据仅作辅助，不以它、历史源码、第三方实现或自定 UUID 算法代替 CLI。当前尚未恢复 CLI 的完整 caller→wire，Axiom 真实模型验收仍失败；本目录不是可用性验收结论。

- 本机桌面 Kiro 1.1.14，内置 `kiro.kiro-agent` 1.1.28。
- 桌面实际 bundle：`/Applications/Kiro.app/Contents/Resources/app/extensions/kiro.kiro-agent/dist/extension.js`，13,161,709 bytes，SHA256 `af4e05df0677587e689883ccbbb19bb853517d8127c5caaec66511408e4ca5da`。
- 当前官方 CLI：`/tmp/kiro-cli-static.Bz5akg/binaries/kiro-cli-chat-arm64`，2.33.1，196,434,336 bytes，SHA256 `1061c72fc190e0772ab74202c9ce1acbb83e11e8ab7e6a68a3aa3cf2e41a19d4`。与旧记录中同版本、35,976,848 bytes 的 binary 不同，不移植地址或结论。
- REA MCP 实测版本 **6.8.0**；初始 native session `open=false`、`cleanup_pending=false`，Ghidra available、Hopper unavailable。见 [初始状态](initial-session.json)。未另启第二 REA 服务。

## 已取得的桌面证据

[完整静态对比](desktop/REPORT.md)、[原始片段与位置映射](desktop/manifest.json)。片段对应原 bundle SHA、原始行号及字符/UTF-8 byte 范围；没有执行 bundle，没有读取用户认证缓存。

| 环节 | 当前桌面 shared 实现 | Axiom 当前差异及结论边界 |
| --- | --- | --- |
| endpoint / serializer | `mMi`→`Bge`，默认 runtime regional endpoint；`nou` 默认 `Lht` AWS JSON 1.0，`serviceTarget=KiroRuntimeService` | Axiom runtime 根路径发送旧 `AmazonCodeWhispererStreamingService` target。**不能据桌面差异直接改 CLI target** |
| operation path | schema 带 `/generateAssistantResponse` REST trait，但默认 RPC serializer 组装根路径及 `x-amz-target` | 不能仅凭 trait 把 Axiom URL 改为 REST path |
| authentication | auth provider.getToken()→SDK Bearer；可选 TokenType 与 attribution middleware | provider 枚举、region 来源和真实 CLI auth precedence 待核对；不伪造 IDE 身份 |
| conversation | 上层执行参数 conversationId 或 chatSessionId，传入消息 metadata；builder 反向查找，缺失才 `crypto.randomUUID()`；root 独立查找，缺失自根化 | Axiom SHA256 截断映射与其不同；未证明服务器 UUID 校验是 HTTP400 根因。不采用已撤回的自定 UUIDv5 |
| body | current/history/MANUAL、modelId、origin；额外 root/continuation/task、profile、agentMode 等 | 存在差异不代表这些字段全是必需字段；CLI 实际调用路径待核证 |
| system | 首条 human 仅在 `system_field_injection` feature 开启时升顶层 systemPrompt，默认关闭 | Axiom `<axiom_system>` 策略不同；不能假定账号 feature flag 或复制 IDE system 身份 |
| thinking | 根据模型返回 schema 构造 `output_config.effort` 或 `reasoning.effort`；同模型签名 reasoning 可回放 | Axiom 静态表与 prefix、全部省略历史 reasoning 不同；尚未实施生产修改 |
| tools / images | toolUses/toolResults，工具图片提升到 user.images，blob bytes 按 SDK JSON 编码 | 大体形状一致；schema/name 修复和恢复策略仍有差异，不当作服务必需规则 |

## REA 分析与局限

1. 对原始扩展中精确选定的 package.json + dist/extension.js 分析，默认 1024 MiB worker heap 耗尽；parsed=0。parent `ev_045682456ba0c884e4f76d06c22e74f1bda7263775b2c440fcab3b5bad230da8`，见 [summary](desktop-analysis-summary.json)。不是完成反编译的证据。
2. 检查设置边界及本机 32 GiB 内存后，以单次 `max_heap_mb=3072` 重试；到达 **300000 ms provider deadline**，不是 MCP host deadline。partial `ev_cfcbb95b2df6f9219ad7b6458711bedb8f36b84255d466c7f5efc54adf69da33`，见 [超时结果](desktop-analysis-3072-summary.json)。不原样重复整包分析。
3. 用 Babel 惰性解析原 bundle，只按 AST 边界切出相关完整 module/function，交给 REA。见 [抽取脚本](extract-ast.cjs)、[原字节溯源](module-slices/manifest.json)。VariableDeclarator 仅添加 `var `，所有片段仅补 `;\n`，均在 manifest 明示；这不是完整原应用，不声称跨切片的动态绑定已经闭合。
4. REA 对 12 个 module slices、61,187 bytes、14,123 AST nodes 完成语法解析，0 parse failure、0 source skip。parent `ev_59e4d9a8a823e89124fdb91dd31ff977e218ba4a1acd0867a83a624e7c9df1c0`，summary `ev_39e58d38d89c38784854d133616344ad903e2c70b52be34cb6843ea49cd246b3`，见 [summary](module-slices-analysis-summary.json)。仍有 2858 semantic unknowns，不能把“selected syntax complete”写成“真实发送链完全恢复”。
5. 更小的 15 个 function/assignment slices 也解析成功，parent `ev_9172909f3a01e41d49bee82a194f1db2b5f4117452b64f8694d92a34742d308b`。部分 semantic trace ambiguous/no-match；没有据此声称缺少字段或获得完整值流。

初次完整 REA Evidence bundle（10 records，73,738,900 bytes）的持久压缩副本：`/Users/dane/.axiom/artifacts/kiro-client-rea-20261027/rea-evidence-bundle-initial.json.gz`，压缩文件 SHA256 `0d85e12ec6b16238b3beb0ad26450f36b8d3f285eb596b3d035dcb923381b9f3`。该副本是在后续 module trace 前导出，不包含之后新结果。原工作目录及 trace JSON 仍为 `/tmp/kiro-client-rea-20261027/`。

## CLI 授权复用边界

[当前 CLI 静态契约](cli-auth-contract.md)：公开 help 无 OAuth import；`KIRO_API_KEY` 是独立官方 API-key 身份，不是 OAuth token 注入口。内部 `get-kas-token` / ACP `_kiro/auth/getAccessToken` 负责加载官方已有存储及刷新，不证明允许外部导入。没有读取真实 token、DB 或秘密日志，没有写 CLI 凭据，没有运行 token getter 或登录/刷新正文。

当前 binary 同时存在 runtime endpoint 与旧 streaming target、多个引擎；不能把相邻字串当成实际 caller→wire。完成前不部署由桌面推导的 target/UUID 修复。

## CLI native 尝试的结束边界

[恢复与失败状态](recovery/STATUS.md)、[完整诊断](recovery/native-probe-600000-result.json)、[最终会话状态](recovery/final-native-state.json)。正式会话完整重载后实际 MCP 调用恢复，REA 6.8.0/aligned；但 Ghidra 对目标的默认全量自动分析在 330 秒及按返回指引延长至 600 秒后均 `provider_timeout`，没有获得目标函数结果。查询单个函数并未缩小其前置全量分析成本。这一路线已停止，不再加时重试。

两次 Ghidra PID/进程组均已退出；最终 `cleanup_pending=false`，activity 为 `not_observed`。这不是对所有可能脱离进程组的后代状态的证明。没有确认 OOM，也没有证明 macOS 是原因或 Windows 更快。600 秒结果后的 `store()` 大 JSON 超限属于后处理错误，归档的 `transport-error` 文件名不准确，不表示再次 MCP 断连。

[CLI 普通静态报告](cli-static/REPORT.md)及其指令、地址定位产物已归档。它们不是 REA native 反编译证据，也没有闭合默认 engine→endpoint→serializer→wire。下一路线仅检查不触发全量分析的有界入口，不更换 binary、OS 或身份。

## 撤回与当前基线

桌面流错误映射候选同样已撤回、未部署，副本在 [候选代码](../desktop-stream-candidate/kiro-chat.ts.txt) 和 [候选测试](../desktop-stream-candidate/kiro-chat.test.ts.txt)，不能自主恢复。

[当前基线日志](current-baseline/test.log)为隔离环境、禁网的 10 文件 **179/179，exit0**。撤回后重新核对 providers 23 文件及 tests 10 文件，全部与该测试前/后 SHA256 精确一致，因此不重跑未变化的检查；不是新的构建或真实模型验收。[归档与源码完整性清单](archive-verification.json)记录 61 个归档文件的 SHA256 与核验范围。
