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
- 当前正式验收模型`glm-5.3`与`deepseek-v4.1-flash`，覆盖off/high；off映射`reasoning_effort: none`。不静默换模型或降低调用方安全设置。
- SSE成功必须有合法stop/tool_calls、DONE及干净EOF。null/明确安全空legacy占位、空非终态finish可兼容；已严格验证工具的后继空name表示无增量，首次空名、改名、变ID和坏type仍拒绝。
- CN product-gateway保留图片工具结果的tool角色、call ID与image_url块，不使用custom-model图片hoist；见[2.179.0静态依据](evidence/codebuddy-repair-20261106-01/CLI-STATIC.md)。
- 额外SDK headers不透传；Pi宿主session/run仅作RAM映射键，独立生成CLI形状UUIDv7（session带横线，run/invocation32hex）。映射在provider runtime内稳定、dispose/invalidate清理，不提供官方跨进程恢复等价。
- 全部工具参数严格schema校验、无coercion，完整成功后才交宿主审批和执行。组件不直接运行工具。
- 跨模型历史仅投影可读thinking为`reasoning_content`，不回放`thinkingSignature`等私有状态；可读回答/system/tools不删改，空thinking和完全空assistant按CLI省略。工具历史保留SDK的`call_id|item_id`原值并严格配对，不套用Responses专用ID规范化，header身份校验不放宽；见[CLI历史投影依据](evidence/codebuddy-cross-model-20261106-01/CLI-SLICES.md)。
- 不支持的redacted思考、namespace、强制grammar等明确拒绝；不以删除真实上下文、合成工具结果或伪造权限换取成功。

## 验证与范围

合成及loopback测试覆盖认证、目录隔离、请求/流、工具、取消、公开组件、Pi接线及会话重试。`codebuddy-native-component.test.ts`通过公共入口打包，plain Node夹具不需要Pi或TS loader。

此前限定独立SDK实测完成2语义轮、3次模型HTTP200、1次工具/宿主审批钩子、工具后精确输出及下一轮续接，三次DONE+干净EOF。官方CLI真实文本成功，但官方观察实验未全部验收通过；失败历史不转为成功。双方成功场景的system/prompt/工具/输出预算不同，不能称同输入或完整wire/TLS等价。

上述早期SDK03范围不包括部署或常驻worker/UI。当前国内版图片/身份/header修复见[2026-11-06报告](evidence/codebuddy-repair-20261106-01/REPORT.md)：100项离线回归、构建及正式加载通过；两模型正式UI各8项通过，覆盖多轮文本/思考、真实工具及错误恢复、图片工具结果和历史、流式取消与恢复。两模型默认已恢复，另以不发模型请求的UI复核确认刷新后所检查内容可见。源码、构建、独立SDK、本机sender、正式服务与UI分列，不继承旧验收；该图片/身份验收未另行重跑独立SDK真实上游。

随后修复OpenAI Responses历史切换到Workbuddy/DeepSeek/high的本地拒绝，见[跨模型续接报告](evidence/codebuddy-cross-model-20261106-01/REPORT.md)：106项离线闭包通过，变更fixture后仅复验相关11项及build通过；原失败实际116条上下文按Pi规范投影，仅RAM离线验证通过。单次独立生产SDK合成外源历史实发HTTP200/stop，可读思考、私有签名不出站、完整复合工具ID及正确回忆/计算均通过，无新工具执行或全局默认变更。正式4317已重启并核产物指纹/进程时序；这不是精确源模型UI切换或原116条上下文全量live验收，不能混同初轮16项UI结果。

真实refresh、官方完整重试、keepalive与恢复行为仍不在本轮完整对齐范围。历史实验原始目录未随代码整批纳入；不得重跑已耗尽的live claim。
