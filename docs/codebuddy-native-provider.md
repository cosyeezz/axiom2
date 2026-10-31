# CodeBuddy CN 原生 Provider

## 入口与职责

[公共入口](../app/src/native-providers/index.ts)提供不依赖Pi的进程内组件：

- `createCodeBuddyNativeProvider()`：认证、目录、流式推理与`dispose()`。
- `createCodeBuddyOAuth()`、`createCodeBuddyCatalog()`、`createCodeBuddyClient()`：可分别使用的子组件。
- `createNativeAccount()`：可选账号生命周期助手；凭据存储由调用方提供，不与Pi已有刷新锁叠加。
- `codeBuddyBuiltinModels`、`codeBuddyHeaders`及请求构造/原生HTTP入口。

核心不执行CLI/ACP，不启动兼容代理，不隐式登录、持久化凭据、刷新或执行工具。调用方传入合法access、模型、完整system/history/tools及取消信号。`getCatalog(credential)`只读RAM/内置目录；`catalog(credential, signal)`明确联网刷新，目录不等账号权限。

[Pi薄适配](../app/src/server/providers/codebuddy-chat.ts)保留正常账号路由与唯一刷新owner，每次调用使用一次性RAM认证交接；[运行身份](../app/src/server/codebuddy-run-identity.ts)区分session、逻辑run与invocation；[会话策略](../app/src/server/session-retry-policy.ts)禁止CodeBuddy失败的自动重放。

## 协议与安全边界

- 当前CLI兼容基准2.179.0；默认UA为`CLI/2.179.0 CodeBuddy/2.179.0`，IDE标识为CLI。此项不保证整个请求不含Axiom：调用方提示词、历史及工具内容不会被删改。
- 推理固定CN目标，使用原生Node HTTP(S)，校验TLS；不自动redirect/retry。认证和目录使用Fetch。
- 固定验收模型`deepseek-v4.1-flash`，off映射`reasoning_effort: none`。不静默换模型或降低调用方安全设置。
- SSE成功必须有合法stop/tool_calls、DONE及干净EOF。null/明确安全空legacy占位、空非终态finish可兼容；已严格验证工具的后继空name表示无增量，首次空名、改名、变ID和坏type仍拒绝。
- 全部工具参数严格schema校验、无coercion，完整成功后才交宿主审批和执行。组件不直接运行工具。
- 不支持的签名、namespace、强制grammar等明确拒绝；不以删除上下文或伪造权限换取成功。

## 验证与范围

合成及loopback测试覆盖认证、目录隔离、请求/流、工具、取消、公开组件、Pi接线及会话重试。`codebuddy-native-component.test.ts`通过公共入口打包，plain Node夹具不需要Pi或TS loader。

此前限定独立SDK实测完成2语义轮、3次模型HTTP200、1次工具/宿主审批钩子、工具后精确输出及下一轮续接，三次DONE+干净EOF。官方CLI真实文本成功，但官方观察实验未全部验收通过；失败历史不转为成功。双方成功场景的system/prompt/工具/输出预算不同，不能称同输入或完整wire/TLS等价。

此提交不部署、重启或验证常驻worker/UI已加载。真实refresh未触发；其它模型/配置、官方完整重试及keepalive行为不在已验范围。历史实验原始目录未随代码整批纳入；不得因提交而重跑已耗尽的live claim。
