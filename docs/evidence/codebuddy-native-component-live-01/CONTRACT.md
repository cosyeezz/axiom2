# CodeBuddy 独立SDK限定实测 01

## 身份、问题与边界

- 新case：`codebuddy-native-component-live-01`；SDK-live；官方CLI静态基准2.179.0/macOS，当前已构建Axiom/Pi1.4.0。
- 唯一问题：现有正常CN OAuth账号能否经 **Agent→Axiom ModelRuntime→Pi薄适配→原生CodeBuddy sender**，固定 `codebuddy-cn / deepseek-v4.1-flash / off` 完成工具读取、回传与下一逻辑轮？
- 用户已授权实现及DeepSeek测试。独立进程，不运行官方CLI、不部署/重启、不改变全局默认或代理/CA/隐私，不复制CLI缓存或重复交互登录。
- 源码/发射基准：[离线报告](../codebuddy-native-component-01/OFFLINE-REPORT.md)、[源码证据指纹](../codebuddy-native-component-01/offline-verification.json)、[组件emit指纹](../codebuddy-native-component-01/distribution-verification-01.json)。本case预检再绑定实际运行emit及harness自测指纹。
- 旧auth case仅证明当时GET账号有效；旧Kiro live及claims不可复用。CodeBuddy本地SDK/纯Node已过，不证明当前推理权限。
- 自有caller保留system安全约束、custom history、历史assistant、声明工具/完整schema；fixture仅为自有随机marker，工具限读此文件。首轮精确返回marker，下一轮不用工具、返回marker+`_NEXT`。
- 显式session/run身份，不声称常驻worker自动注入已验；无AgentSession、title、summary、warming或会话重试。不是官方CLI真实wire对照、TLS指纹或服务端不可区分证明。

## 硬预算与所有权

| 项目 | 上限/策略 |
|---|---|
| 总时长 | 180秒；清理20秒；200秒硬watchdog；单模型45秒；refresh遵循Pi锁owner自有15秒signal，准入后不以caller取消打断令牌旋转/持久化 |
| 内存 | Node heap256MiB；响应流有界，不累积上游原文 |
| semantic prompts | 2 |
| 模型physical sends | 总3；首轮最多2（tool+result），下一轮恰在前2完成后最多1；native sender调用前硬门禁 |
| 认证 | 最多1次正常OAuth refresh；CN POST `/v2/plugin/auth/token/refresh`；禁止新login/state/poll |
| profile / catalog | 0 / 0；内置声明选定模型，不为目录额外联网 |
| title/summary/warming/其他 | 全部0；不允许未知目的地或路径 |
| output | 每模型maxTokens256；总text+thinking8192字符，10000事件 |
| 字节 | 请求≤1MiB，单响应≤2MiB（收到chunk后判断，瞬时多出一个transport chunk）；每份运行投影≤32KiB，静态代码和历史证据单独保留 |
| 宿主工具 | 仅 `read_component_fixture({path:"fixture"})`，严格schema、成功tool终态后审批并执行，最多1次 |
| retry | native单send；Agent options maxRetries0；无AgentSession；模型/辅助失败立刻latch并取消，不静默重发或换模型 |
| refresh owner | Pi正常凭据锁/持久化；不传自制credentials/apiKey、不调用第二refresh客户端；正常刷新允许写原应用凭据存储。初始化可能恢复目录而检查过期OAuth，因此不把caller signal传给正常runtime初始化，await其正常锁操作完成；后续refresh仅RAM观察、退出前经正常路由读回已提交新凭据 |
| 账号/代理 | 仅正常Axiom账号路由；清子进程执行快照绑定。当前供应商代理配置仅绑定此独立进程，不修改文件/父进程/机器设置 |
| 资源 | 独占新case文件、独立进程和合成临时目录；借用服务/4317/4319一律不停止或重配 |

0外部取消追加请求；取消/迟到/坏终态已本地验证，harness自测仍需覆盖。若模型拒绝/额度不足/超时/行为不符合，则本case失败并耗尽claim，不把已有授权解释为无限尝试。

## 执行门禁与记录

1. harness导入无执行/网络/文件写入；`--preflight`封锁网络，metadata-only固定模型/API/CN目标/native sender，正常只读OAuth可用性；不直接read真实auth.json、不输出token/refresh/账号原文或凭据hash。models/settings全文只在RAM前后比较，证据仅布尔/公开选模元数据。
2. `--selftest`只用临时合成OAuth和合成SSE；验证成功工具/下一轮、缺终态不执行工具、活动取消/late清理、超预算拦截、辅助请求白名单/计数。失败修fixture后用新结果文件，保留原结果。禁止真实凭据或外网。
3. 准备白名单结果校验器。成功必须：模型3×200、两轮stop、工具审批/执行各1、call/result配对、完整caller/history/tools、none、UA及session/run/invocation关系、observer3对start/end、activeBodies0、Agent settled、provider dispose、dispatcher关闭、配置未变、owned进程自然退出。
4. 实发前匹配预检、自测、harness及全部运行emit指纹。以wx写`live.claim`后才允许真实认证/模型；任何失败/超时也耗尽，不覆盖/删除claim。没有通过门禁则不得实发。
5. 命令入口只允许新harness的明确 `--preflight / --selftest / --live`。使用plain Node、`--max-old-space-size=256`；不执行旧harness。结果单独命名保存，不能用旧自测指纹通过新脚本。

允许证据：固定phase/error code、公开版本/模型、必要自有session/run ID、计数、关系谓词、状态/资源数、静态代码/自有fixtureSHA。禁止上游原文/headers/真实上下文/未知异常栈和敏感派生hash。不是OS全网络审计；模型发送前边界的headers不是独立MITM/wire证据。

## 停止与恢复

首失败进入不可翻绿latch，abort Agent/请求并dispose provider；核迟到body取消、observer归零、Agent idle、dispatcher关闭，清临时目录，读回models/settings未变。正常刷新不恢复旧token；没有改配置就不恢复历史配置。硬超时未证清理则保留失败/未知，不宣称完成。

当前准备状态：用户再次明确要求执行真实对比，恢复推进。为隔离并行Kiro/worker/package变化，已复制独立构建快照：[FROZEN-RUNTIME.json](FROZEN-RUNTIME.json)，1069个构建/包文件全部固定SHA，62关键应用/Pi产物另核；55项相关源码仍与已通过离线基准相同。Kiro/worker功能不在本CodeBuddy scoped SDK验收内，不回退或修改并行文件。node_modules仍为本机链接，关键Pi文件固定，不称完整依赖不可变或OS沙箱。现在运行的是复制的实际构建，不再读取可变工作树emit；manifest本身也固定SHA。使用新selftest-final-03/import-final-03/preflight门禁，旧结果保留。0本case外部请求/无claim；成功后另做官方CLI同模型真实对比，不以此SDK功能成功替代官方对照。
