# CodeBuddy CLI 2.179.0 协议矩阵

当前描述工作树源码和分层验证，不代表安装版或常驻服务已加载。主bundle位置均0-based byte、右端不含；原件路径见[工作单](ONBOARDING.md)。后续官方headless已有两次真实文本成功，Axiom SDK03已有2轮/3model/1工具闭环成功；完整[实测对比](../../codebuddy-native-parity.md)。目录仍不证明账号权限；此处旧full bundle静态窗口不能替代`--print`实际headless执行证据。

| 项目 | 官方2.179.0证据 | 当前Axiom | 差异与边界 |
|---|---|---|---|
| 产品/身份 | 安装完整性、version快路径；主bundle SHA已固定 | codebuddy-cn，默认身份常量2.179.0 | 仅指定版本默认profile，不冒充动态配置或所有wire一致 |
| OAuth/token | 既有auth case有custom-token与账号GET证据；CN state/poll/refresh链已定位 | 独立auth/json核心+Pi薄适配；正常账号存储/刷新锁仍归Pi | custom-token不自动刷新；认证仍fetch，未宣称其wire原生对齐 |
| 账号/目录 | CloudProductManager GET CN/v3/config，Bearer当前session，JSON.data；models按ID合并，非空availableModels过滤且可来自本地 | core GET/白名单解析/RAM epoch；Pi动态刷新、API-key单次交接兑付、账号切换/退出/晚到已合成验证 | 不持久化、不接收云endpoint/凭据/prompts/价格；token轮换按新scope。env未刷新异步变化无法仅从availability参数识别 |
| 目录query | buildRepoParams([])为[]；Axios190496默认serializer空数组不追加query | 固定/v3/config，无query/body，5000ms/close | 合成正常账号目录已验；官方真实geo/catalog各1 GET每case，SDK03辅助请求0；自定义serializer未知 |
| DeepSeek ID | product.internal.json:405–475含deepseek-v4-pro、deepseek-v4.1-flash及v4-flash | 前两ID在兼容目录；本轮固定Flash/off | relatedModels不是发送别名；当前账号Flash/off已由SDK03真实3次200及完整闭环验证，不外推其他模型 |
| Thinking | 网关adapter[9602500,9608500)明确off→reasoning_effort:none；产品默认high/summary auto | core按能力映射，off明确none且无summary；其他effort auto summary；所有兼容目录声明effort合成发送通过 | 不clamp到其他effort，不套直连DeepSeek thinking对象；onlyReasoning未当作禁止显式off |
| 客户端/路径 | createClient[9628500,9630750)：模块88852 OpenAI、endpoint+/v2、apiKey、axiosToFetchAdapter、maxRetries0 | 独立构造/解析；固定CN/v2/chat/completions原生Node HTTP(S) | 保留openai-completions API标签但不委托其serializer/sender；无代理服务/CLI代发 |
| Body/上下文 | adapter[9595000,9608500)解析SDK body，条件加providerData/extra_vars/cache_retention后JSON.stringify | caller system/sections/history/tools完整映射；严格hook后实际序列化bytes、字段/输出cap/采样守卫 | 完整官方额外字段未实现；显式cacheRetention拒绝；不复制CLI系统提示词。caller named采样覆盖model默认，caller sampling更具体但不能提高显式输出cap |
| Header/身份 | X-Conversation-ID会话；X-Conversation-Request-ID逻辑请求；X-Request-ID/Message-ID调用且连接重试复用；Intent/Runtime/Purpose/Type来自真实上下文 | session/run/invocation分离，受保护头；普通worker主run按真实runId注入；新run换ID；实际Agent本地及SDK03外部工具续接与下一轮已验 | worker本身未实跑；resume/memoryContinuation/notification/reload/compressionPreparation不猜身份，辅助purpose/runtime不编造 |
| UA producer | CLI provider rebind→PackageUtils→30780.T内嵌2.179.0；无override/原UA/extension时CLI/2.179.0 CodeBuddy/2.179.0 | core、认证与目录共享常量；官方与Axiom真实模型发送路径均检查到同默认UA | ua-source.json四窗10500B闭合默认来源；非默认配置及独立wire/TLS仍未验，真实sender谓词不等服务端逐字采样 |
| 真正sender | Rest→Axios0.26.1普通Node默认919978→transport.request；maxRedirects0原生http(s)，否则follow-redirects | node:http(s)，独立HttpsProxyAgent，准确Content-Length/TLS校验/信号，无redirect/retry/pool | close/无池是保守本地策略，官方keepalive未知；供应商worker代理env静态接通，未新增SDK代理实测；本地socket映射不是TLS对齐 |
| 解析/终态 | 官方02真实13帧/stop+DONE；中间null legacy/空finish，末帧legacy object内部未知；随后aborted/error/close | 独立UTF8/SSE；安全空legacy与空非终态finish兼容；SDK03三次stop或tool_calls+DONE+干净EOF | 官方观察case仍Failed，不能称自然EOF；Axiom03末帧name/arguments空串不反推官方。length为错误，严格EOF/model是本地策略 |
| 工具 | SDK function工具请求；完整恢复边界未全核 | 碎片仅预览，全部JSON/schema且无coercion、完整成功终态后才tool-end；宿主审批执行，SDK03外部执行1次/宿主审批钩子1次，完整call-result及下一轮通过；已验证工具后继空name为no-op，首次名/改名/ID/type仍严格 | 失败/取消assistant含未确认候选的历史拒绝，不静默删history；图片工具结果/namespace/不可保真签名/强制grammar拒绝 |
| 错误/usage | 官方完整usage/异常策略未全核 | 6004额度、11102权限、overflow等优先级白名单脱敏；严格计数/cache一致性；Pi单独计价；预入口header/key命令失败也脱敏 | 缺计数诊断partial/unavailable；未声明cacheWrite=0是实现基线，不是完整计量证明；零单价不等免费 |
| Retry | [9569250,9571250)外层默认8/上限15、401默认0；SDK0不等全链0 | native每次单send，无redirect/retry；Axiom仅CodeBuddy禁session自动重试和失败历史省略，真实AgentSession回归通过 | 未实现官方retry；其他provider九档和summary独立三次未改。summary/overflow自动压缩是其他继续路径，不声称全应用零重试 |
| 取消/资源 | Axios signal已证，完整late/pool未知 | lifetime/epoch，挂起acquisition可取消，late Response关闭；目录换账号拒晚到发布；dispose全清 | core与实际SDK合成取消/晚到/销毁通过，实际Node流取消本地通过；无外部中断测试 |
| Pi接线/observer | 非官方范围 | native API路由与getAuth固定目标守卫；OAuth/API-key 60s单次RAM票据，每物理调用重取；observer绑定真实sender | 实际Agent→ModelRuntime→生产native fetch→Node链本地及SDK03外部通过，不等常驻worker/UI已加载 |
| 复用/分发 | 非官方范围 | core12模块+公共provider/index；全组件33发射模块/77相对边/0宿主依赖；plain Node实际emit合成闭环通过 | npm-packlist候选包含全部模块，5个复制依赖，无Pi/TS loader；未生成tarball/安装测试/部署 |

## 验证分层

最新：[SDK03真实报告](../codebuddy-native-component-live-03/REPORT.md)与verification均通过；[修复03](../codebuddy-native-fix-03/REPORT.md)新跑41core+14SDK=55项及完整build exit0。旧SDK01/02、Axiom文本01失败保留；官方文本功能成功与其观察失败分开。源码/emit/SDK/部署分层，不与下面历史计数相加。

以下为原离线阶段覆盖：

- C阶段历史：认证/runtime13、目录8、模型映射后旧stream/runtime15分组通过；35不同项，不是一次整轮，也不外推当前native实现。
- D/E当前core：在[第二轮集成日志](pi-integration-tests-02.log)内client13+HTTP6全部通过；该轮总43项42过1失败，失败是API测试只改provider默认、未实际覆盖内置model。修成显式model API后[单项复验](pi-guard-tests-03.log)通过，不能把旧整轮改称43PASS。
- 最新Pi三文件：[27/27](pi-integration-tests-04.log)，integration9+stream17+runtime1；覆盖票据、目标守卫、脱敏、目录/账号切换/晚到/dispose、严格schema、完整上下文和取消。
- 实际Agent+ModelRuntime+生产native fetch+[本地Node链1/1](pi-native-sdk-tests-02.log)：4请求为工具、结果、下一轮、取消，工具执行/审批各1，observer归零。仅https.request最终目的地映射loopback，global Fetch拒绝；不是外部服务或TLS证据。首轮误拒Agent默认auto已在源码修复，失败日志保留。
- [会话重试14/14](pi-session-retry-tests-01.log)：CodeBuddy无隐式重放/失败history省略，其他provider九档和summary独立三次保留。
- [identity/core早期21/21](pi-core-regression-01.log)中纯身份helper2项；不能把显式SDK身份当worker实跑。
- 后续公共入口验证：[三文件15/15](component-public-tests-01.log)，含CodeBuddy2与原Kiro/shared13；类型修正后[六文件48/48](component-regression-tests-02.log)，含native19、stream17、integration9、component2、SDK1。
- [完整构建exit0](component-build-02.log)涵盖测试类型、前端和server emit；首次build01测试类型错误保留并已修复。仅前端大chunk警告。
- [分发验证exit0](distribution-verification-01.json)：1055个npm-packlist候选含33个组件模块；隔离plain Node实际emit auth3/catalog1/model3/tool1/退出/销毁全过，无外网/Pi。没有运行npm pack生命周期或安装流程。

## 已关闭调查

- t12245/r12250现有实现审查已消费；旧Flash实测不能证明当前权限。
- 官方主链t12246/r12252+r12255：10窗40950B+8窗32700B。配置外通用兼容层[18015500,18023500)、[18029500,18034500)不冒充内部网关。7主链窗28350B存static-source.json。
- UA/adapter t12256/r12258+r12260：6窗20100B+2窗4000B；默认UA版本与Axios Node默认选择闭合。
- 目录t12257/r12259+r12265+r12266：6窗24550B+4窗16300B+1窗2000B；认证与空repos默认序列化闭合。
- 以上是已关闭的原静态调查。后续官方headless真实已执行，当前账号Flash/off权限与SDK03闭环已验证；完整报告见页首。官方遥测在实验中本地抑制，不代表原行为全部相同。override/keepalive/全wire仍未知，不无界扩读。全部真实claim含SDK03已耗尽，禁止重用；没有新live计划。
