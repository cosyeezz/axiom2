# official-sonnet-01 — 官方客户端有限功能 smoke

用户授权助手自行测试。当前CLI2.37.0 whoami显示Google；Axiom是identity-center，两者不可当同企业认证。只测试官方现有登录能否按精确claude-sonnet-5.5返回37×19；不是接入代发、协议对齐、企业权限证明或编码/图片验收。

一次独占wx claim，一次CLI chat启动、一个短prompt；成功/失败/超时均耗尽，不重试、不换模型、不重新登录。使用正常HOME与官方自有认证，不读/复制token文件，不改代理/TLS/opt-out或默认模型。cli 2.37.0绑定SHA由当前二进制计算。先非模型夹具验证监督器、输出上限、超时、终态与未知错误不泄漏。

仓库外新临时cwd与TMPDIR，只有本次自建agent：tools/resources为空、MCP/powers关闭、permissions all deny、hooks空；--agent指定它且仅信任自有workspace（--trust-workspace），--trust-tools=，stdin EOF。不加载本仓库；若用户全局hooks目录有文件则先停，不静默执行未知hook。公开agent schema依据 https://kiro.dev/docs/custom-agents/configuration-reference/（2026-10-31读取）。本地agent validate须成功才发chat。

chat --v3 --no-interactive --output-format stream-json --model claude-sonnet-5.5 --agent axiom-official-sonnet-01 --trust-workspace --trust-tools= <prompt>

chat wall60秒、stdout+stderr总128KiB；仅RAM解析。SDK内部物理请求/重试/title/summary未插桩，数量明确unknown，不能把一次chat启动/ACP事件计成一次HTTP。本case交付有限客户端功能结果，不是要求精确物理预算的原生provider实发case。无已证当前全层重试开关，故不猜环境变量或降低隐私来强造预算。遇工具事件/权限请求、超时、输出超限立即停；辅助只允许官方正常客户端生命周期且共享60秒截止。自有process group终止与退出核验，临时目录清除；逃逸进程组后代不可据此声称全系统已审计。

CLI settings list前后正常只读调用（各10秒/128KiB），内容只RAM，保存相等谓词；不直接读CLI凭据库。任何未知错误不保存原文、hash或动态值。只存退出码、有限字段/枚举、所请求模型、回答703谓词、终态、工具数、字节计数、已知拒绝/登录谓词及清理状态。ACP实际模型如无可信session metadata则unknown；命令参数不是wire证明。CLI正常历史/日志不是本观察器证据存储，保留官方默认行为，不修改隐私设置。
