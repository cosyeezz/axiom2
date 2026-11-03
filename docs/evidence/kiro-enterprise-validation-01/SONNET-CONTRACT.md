# sonnet-01 企业 SDK 功能验收

用户授权：Sonnet5.5 编码、工具和图片理解。固定 claude-sonnet-5.5，off，正常 ~/.pi/agent 当前 identity-center 路由，direct，无显式baseUrl；不得换模型或借CLI身份。使用重启同构建 app/dist/server/model-runtime.js 及 native sender；独立SDK进程，不声称生产聊天UI/worker已验收。

输入：自有system要求只做测试，不读其他资源。编码请求要求 plain JS mergeIntervals(intervals) 不改变输入，通过 verify_code 工具提交，工具先解析仅一个非async/generator函数声明；使用独立Node子进程（权限模式、空env、64MiB V8堆、1500ms SIGKILL），候选代码在无宿主对象且禁字符串代码生成的vm每次限100ms执行，可信判分在VM外只提取数值数组的data descriptor，不使用候选JSON/Array实现，执行10组边界用例（空、接壤、包含、负数、无序、重复等），代码16KiB。仅一工具调用，禁止require/import/process/eval/Function/constructor/global/this/网络等；成功后生成随机receipt，通过原toolCallId回传第二模型轮，要求逐字输出receipt。第三轮独立新会话给自有PNG（左红方块、中绿三角、右蓝圆），要求JSON颜色/形状数组；prompt不提供答案。

预算：最多3模型物理请求（工具发起、工具回传、图片）；profile最多3物理请求且仅us-east-1（空结果转eu会在发送前安全拒绝、耗尽case），OAuth refresh最多1次；目录0、重试0、title/summary/warm0。模型单响应96KiB、aux2MiB；请求body<=256KiB；单轮60s、总180s+4s清理+185s硬停。maxTokens上游不支持，不能作为预算保证，实际靠发送前计数/字节/取消。无额外token费率保证。

观察：仅包装global fetch，Sonnet native kiroNativeFetch当前eventstream分支本来委托global fetch；不替换sender、协议或上下文。发送前核runtime区域/target/modelId/optout，工具schema/调用结果/图片字节保真。HTTP状态、完整帧+EOF推断stop/toolUse、调用配对及断言结果白名单落盘；无显式服务终态一致性主张。响应/代码/token/profile/配置原文只RAM，不输出未知错误。前后models/settings/账号索引RAM比较；正常OAuth刷新写原存储允许。

先离线无网络夹具：成功3轮、坏终帧拒绝、图片错误拒绝、取消/真正迟到acquisition清理、卡住reader单轮超时、发送预算越界拒绝；代码尾随攻击及替换JSON判分攻击拒绝。指纹覆盖源码/合同、完整server/shared/native分发树、三项Pi SDK dist、undici、TypeScript与lockfile锁定其余传递依赖才允许 --live。live前sonnet-01.claim独占wx，任何结果耗尽；失败停止本case，不修后重发该claim。finally中取消响应体并close dispatcher、删除纯合成临时目录，核pendingAcquisitions0、activeBodies0与配置不变。未settle acquisition不能获clean；cleanup超时不撤硬停（destroy只是请求清理，不算已结束），失败报告不转成功。未做不响应取消的真实OS网络故障注入。图片失败不得宣称正常；编码失败不运行工具后续。
