# sonnet-03 企业 SDK 最终有界验收

用户授权：重启后验证企业Sonnet5.5编码、工具、图片。固定claude-sonnet-5.5/off，正常 ~/.pi/agent 当前identity-center/direct/无显式baseUrl；不切账号、不换模型、不借CLI凭据。01旧target、02新target均403且claim耗尽；本case验证已由KAS0.66.70 factory→Cy→IdC映射确认的TokenType缺口修复。request.ts仅GAR identity-center设置SSO_OIDC，根路径/new target/eventstream保持。证据sonnet-routing-static/runtime-factory.txt、../kiro-catalog-repair-01/static-current/token-type-map.txt与token-type-middleware.txt。不是预先确认403因果，不把UA或实验配置未知说已一致。

使用修复后完整app/dist及原生sender，独立SDK；另核后台重启verified，不冒充UI/worker聊天端到端。完整保留自有system约束、用户消息、原工具定义、历史及工具配对、图片，不改默认模型、账号或代理，不降TLS/optout。

最多3模型物理请求：1) verify_code提交mergeIntervals普通JS函数，可信子进程跑10组边界用例并核输入不变；仅一函数声明，拒绝import/require/process/eval/Function/constructor等，16KiB源码；权限Node空env/64MiB/1500ms SIGKILL，VM禁字符串代码生成、每次100ms，VM外data descriptor取数值数组判分。2) 原ID/name/input配对回传随机receipt，最终文本须精确匹配。3) 自有左红方块/中绿三角/右蓝圆PNG，prompt不提供答案，严格JSON颜色/形状及key集判分。代码、响应只RAM/stdin，不保存未知原文。

硬预算：3模型、3美国profile、1正常OAuth刷新；0目录/重试/title/summary/warm。单轮60秒，总180秒+4秒cleanup+185秒硬停；模型响应96KiB、辅助2MiB、模型请求256KiB。maxTokens上游不支持，不作预算保证。失败立即停止后续阶段，不换路由fallback。**这是已知target与企业TokenType缺口补齐后的最后一轮实发；如仍拒绝，停止模型尝试，向用户确认同企业账号官方Kiro的实际可用性/有效实验路由，不能逐项猜头重试。**

观察只包装实际global fetch，live仍调用原fetch；GAR原生kiroNativeFetch本来委托此函数。发送前核runtime.us-east-1.kiro.dev/、KiroRuntimeService.GenerateAssistantResponse、TokenType SSO_OIDC、模型ID/origin/optout以及完整context/schema/history/results/images。错误观察复用原reader，不tee/clone/额外请求，最多16KiB只RAM；仅完整JSON投影有限已知代码和reason===kiro:model_requires_user_opt_in谓词。未知代码/reason/message/header原文不输出；HTTP403和谓词false不证明权限原因。

先离线9场景：正常、坏帧、错图、cancel、late、stalled、budget、已知403、未知403；代码尾随/JSON判分攻击拒绝，未知PRIVATE文本不得泄露。指纹覆盖本合同/harness/code-runner、eventstream fixture、完整server/shared/native分发树、三项Pi SDK dist、undici、TypeScript及lockfile。构建结束后生成selftest，通过独立复核才live。

新sonnet-03.claim独占wx，任何结果均耗尽；全部03输出新名，不覆盖01/02。前后models/settings/账号索引RAM相等；正常OAuth刷新原存储允许。finally取消body、等待pending acquisition settle、关闭dispatcher；pending0/body0/dispatcherClosed/configUnchanged才clean。cleanup超时保留硬停，取消不代表底层已settle。完整帧+EOF仅本地推断终态。限定功能结果，不声称全部能力、图像生成或完整CLI一致。
