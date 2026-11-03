# sonnet-05 精确 schema 参数修复验收

原授权：验证企业 Sonnet5.5 编码、工具、图片。新事实为 catalog-metadata-01.json：精确模型 thinking.type 枚举不含 disabled，effort 五档默认 high；公开 KAS puc/EEt 对不可 toggle 模型省略 type，独立选择默认 effort。旧04为 Responses400且claim耗尽；本case验证有新依据的参数修正，不为补旧错误观察器重发，不猜400唯一原因。所有旧case/metadata claims禁止复用。

固定claude-sonnet-5.5，正常Axiom当前identity-center/us-east-1/direct/无显式baseUrl。SDK仍使用own reasoning:undefined兼容入口，但发送reasoning严格为{effort:"high"}、无type。必须记录实际providerThinkingLevel high及off-unavailable诊断；**不称关闭思考**。不改账号/全局默认/代理/TLS/opt-out，不借CLI凭据，不扩展其他模型路由或完整动态schema同步。

共享app/dist被外部构建反复改写，不能沿用此前门禁；改从/private/tmp/axiom-sonnet05-*独占快照运行独立SDK。快照完整复制app/dist和node_modules（不借可变软链），另含package元数据、CRC fixture、合同/harness/code-runner；仅复制项目产物，不复制任何账号配置/凭据。快照重新离线验收、独立指纹/逐文件manifest核对并冻结；证据/proof/独占claim始终写回本仓库唯一目录，防止快照产生第二份claim。后台第五次重启verified只是此前构建的基础验收，不声称后台加载该快照，不冒充生产worker/UI聊天端到端。模型观察器委托原kiroNativeFetch→kiroNativeHttp→node:https，辅助才原global fetch；不替换原生sender。发送前核runtime.us-east-1.kiro.dev/v1/responses、POST/redirect error/optout/企业TokenType、无GAR target、精确model/origin/stream/effort、profile header/body相等；整个input/tools严格等值，含完整system/user/tool description/schema/助手正文/call-result ID/arguments/图片，无额外消息或工具。

最多3模型请求：
1. verify_code生成mergeIntervals普通JS函数：单一函数声明、危险标识拒绝、16KiB源码；空env/64MiB/1500ms SIGKILL受限Node，VM禁字符串生成，每次100ms，可信descriptor核10组边界及输入不变。只有成功toolUse终态才执行，候选tool-end不足授权。
2. 原call/name/arguments配对回传随机receipt，最终文本必须精确等于receipt。
3. 自有三形状PNG，prompt不提供答案，严格3项JSON颜色/形状及精确keys。模型源码/内容仅RAM/stdin，不保存。

预算：3模型、3美国profile、1正常刷新；0目录/重试/title/summary/warm。单轮60秒，总180秒+4秒cleanup+185秒硬停；模型响应96KiB、辅助2MiB、模型请求256KiB。maxTokens原生未支持，不冒充预算。失败即停后续阶段，不fallback/换模型。

错误沿原reader仅RAM观察，不clone/tee/补发；最多16KiB完整JSON只投影已知错误码、固定字段名引用及精确opt-in谓词。SSE仅已知事件计数、白名单终态/model相等/本地协议码。未知原文/header/身份/profile/token不保存、不hash。固定字段引用只是错误提及，不直接等于根因。

先9场景离线门禁：good、缺completed工具流、错图、cancel、late、stalled、第四次预算拒绝、已知403、未知403；AST尾随/JSON判分攻击拒绝，PRIVATE不得泄漏。缺completed即使工具候选完整也不执行。Socket哨兵离线零网络。门禁须验证实际high与兼容off诊断。指纹覆盖本合同/harness/code-runner、CRC fixture、server/shared/native dist、三Pi SDK dist、undici、TypeScript与lockfile；只作前后变化检测，不是锁或全部传递依赖证明。独立审核后新wx claim一次live，本会话冻结被测源码/dist/harness/合同。

sonnet-05.claim成功/失败/超时均耗尽；不覆盖旧结果。前后models/settings/账号索引只RAM等值；允许正常OAuth刷新原存储。finally取消reader、等pending settle、关闭dispatcher，pending0/body0/configUnchanged/dispatcherClosed才clean；cleanup失败保留硬停。node:https合并signal取消且agent:false。失败依据白名单证据分析，未知内容不恢复或虚构。功能通过仍不等全CLI对齐。
