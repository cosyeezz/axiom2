# sonnet-04 精确 Sonnet Responses 有界验收

原授权：重启后验证企业Sonnet5.5编码、工具、图片；用户要求助手自行测试官方CLI，现已自行重新登录并报告Sonnet5.5可用。新只读证据 official-current-route-01-fields.json 指向实际CreateResponse与启用实验，不是猜头。旧sonnet01/02/03均403且claim耗尽，本case是依据新实际路由证据的精确功能补丁验收，不复跑旧case、不切账号/默认模型/代理、不借CLI token。issuer/region相同不证明最终用户相同。

固定claude-sonnet-5.5/off，正常 ~/.pi/agent 当前identity-center/us-east-1/direct/无显式baseUrl。精确模型新增Responses，其余Claude/Opus保留GAR；thinking own undefined发送reasoning.type=disabled，native SSE不解释XML，受保护TokenType=SSO_OIDC有公开ICn→Foe及Responses sender链证明。不是完整实验配置同步、最终CLI wire或403唯一因果断言。

完整构建app/dist，独立SDK调用；后台另行重启verified，不冒充生产worker/UI聊天端到端。guard作为SDK fetch观察器，模型实际委托原kiroNativeFetch→kiroNativeHttp→node:https；辅助profile/auth才委托原global fetch。不会用global fetch替换原生Responses sender。发送前验证runtime.us-east-1.kiro.dev/v1/responses、POST/redirect error/optout/企业TokenType、无GAR target、精确model/origin/stream/off、profile header与body一致，以及完整system/user/tool schema/history/call-result IDs/arguments/images。另逐项严格比较整个input数组和tools数组（包括description、原助手正文），禁止额外消息/文本/工具。拒绝任何未许可目的地和GAR fallback。

最多3模型请求：
1. verify_code生成mergeIntervals普通JS函数。仅单一函数声明，拒绝危险标识，16KiB源码；受限Node空env/64MiB/1500ms SIGKILL，VM禁字符串代码生成、每次100ms，可信descriptor比较10组边界用例并核输入不变。必须成功toolUse终态才执行；候选tool-end不足授权。
2. 原call ID/name/arguments配对回传随机receipt，最终文本精确等于receipt。
3. 自有三形状PNG，prompt不提供答案，严格3项JSON颜色/形状及精确key集。所有模型源码/内容仅RAM/stdin，不持久化原文。

预算：3模型、3美国profile、1正常刷新；0目录/重试/title/summary/warm。单轮60秒，总180秒+4秒cleanup+185秒硬停；模型响应96KiB、辅助2MiB、模型请求256KiB。maxTokens原生未支持，不用作预算。失败即停后续阶段，不fallback、不更换模型。

错误观察沿原reader，不tee/clone/额外请求；HTTP错误最多16KiB仅RAM，完整JSON只投影已知错误码和精确opt-in谓词。SSE仅固定事件名计数、白名单终态、精确模型相等谓词和本地协议错误码；未知内容一律other，不保存原文/header/identity/profile/token或其hash。指纹仅公开代码与构建文件，不哈希敏感材料。

先9场景离线门禁：good、缺completed工具流、错图、cancel、late、stalled、预算第4次拒绝、已知403、未知403；AST尾随/JSON判分攻击拒绝，PRIVATE标记不得泄露。缺completed即使收到完整tool候选也不得运行代码。Socket哨兵保障离线零网络。构建后指纹涵盖本合同/harness/code-runner、eventstream CRC fixture、server/shared/native全分发树、三项Pi SDK dist、undici、TypeScript及lockfile。独立复核后一次live。指纹只作前后变化检测，不是文件锁，也不声称覆盖所有传递依赖；本会话冻结所测源码/分发/harness/合同，检测到变化须停止并重做门禁，不能据相等hash宣称主动阻止了其他进程写入。

新sonnet-04.claim独占wx，任何成功/失败/超时均耗尽；不覆盖03及旧结果。前后models/settings/账号索引RAM相等；允许正常OAuth刷新原存储。finally取消reader、等pending settle、关闭dispatcher，pending0/body0/configUnchanged/dispatcherClosed才clean，cleanup超时保留硬停。node:https请求由合并signal取消且agent:false，不创建长期连接池。失败按已有白名单证据分析，不重发为观察器补数据；新请求必须新事实、新合同和新门禁。功能通过仍不等CLI全量对齐。
