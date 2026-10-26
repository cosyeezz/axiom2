结论：建议 Axiom 停止把隐藏 thinking 转成普通 assistant 文本，保留正常正文及工具链。这有原生字段分离、可省略 reasoning 的 CLI 证据支持，属于保守止漏；不能宣称与官方历史策略等效。已发现官方 caller 的原生 reasoning 转换路径，不能说官方一律丢弃；未发现“所有历史必须回放签名”的证据。

CLI 身份：本机 C:/Users/dane/AppData/Local/Kiro-Cli/kiro-cli.exe，528630968 字节，SHA-256 0ff1d24eea11aa2e244524d635e1cfc8f9820522f4c5bc192fb99590d909320a。本轮重新校验，与既有 2.12.0 证据一致；嵌入 appVersion/service.version 同为 2.12.0。未运行 CLI，也未重新验证 Authenticode。

已确认的 caller 证据：
- 0x14314a500 含 chat-cli-v2/src/api_client/mod.rs、GenerateAssistantResponse 线索；原件直接调用链经 0x1432500e0 → 0x14310d9d0 → 0x1432020c0 → 0x143226710 → assistant builder 0x140c00f30。各段已用 dumpbin 核对，非仅凭字符串或 SDK 字段名。
- REA 解析的 0x1432020c0 遍历消息集合，按变体调用 assistant 转换。0x143226710 根据输入可选 reasoning 构造原生结构；文本分支携带输入 signature，另有 redacted 分支。另一 builder caller 0x1428c7d40 同样有可选 reasoning 数据搬运。它们不是无条件清空 reasoning。
- 内部历史表示含 reasoning_content / ReasoningContentForHistory / text / signature / redacted_content（api-debug.asm.txt；名称为分析文件名，非恢复符号）。正常 content 和工具独立。
- assistant serializer 0x140bae5a0 有跳过 reasoningContent 的分支；reasoning serializer 在 0x140b80196–0x140b801c2 可跳过 signature。这证明编码器允许省略，不证明服务端对所有请求都接受。

实际 REA：本会话无可调用的 REA MCP，使用已安装 REA 6.8.0 CLI、Node 24.22.1、Ghidra 12.1.4。仅导入约 1.27/1.37MB 定向派生 PE，未冷导入完整 exe。cwd=F:/Axiom/axiom2；命令为 node rea.mjs decompile <slice> <address> --provider ghidra --format json；完整参数见各 .run.json。

Evidence ID（四次进程 exitCode 均为 0）：
- caller1：ev_6c9e64b61ab79a5b49824b5138b7c79117b4e18175feb930be9d5b89f2569f10
- caller2：ev_68d1cce8b12d3b8792fcf2e76e82e461825102330cf6f312268ebc7d5b81759e
- iterator-v2：ev_26d8f29eb60556e8566dbbb4959d0956c49ef52210432338477e6cc546125002
- dispatch-v2：ev_5619bf84a5c84f360792703b3110e49abcdb62455ff87ab540572c0a5df94938；有坏指令/跳转表警告，排除其伪码作为策略证据。

边界：尚未闭环响应收集→历史入库→档位切换时清理的全链；不能确认 high→off→minimal 的真实清理策略、必须回放签名的服务端条件或省略后的模型效果。切片缺部分 callee/类型，seed 标签是人工断言。未发真实请求，未做在线回归。

建议主代理删除 kiro-chat-protocol.ts:75–86 的隐藏思考包装，保留正文、工具调用与结果配对；不猜 signature，不把隐藏内容降级为正文。后续离线回归检查三个档位轮转及工具续轮请求中均无隐藏思考/注入标签。源码、认证和原始证据未修改；新增分析均在本目录。
