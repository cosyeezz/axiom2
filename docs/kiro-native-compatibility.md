# Kiro 原生接入实施与验证

阶段：本地修复与所列离线验收完成；首条正式Kiro文本实调失败，安全工具尚未执行，根因与官方补证仍未完成（2026-10-27）。这是静态49项审查之后的独立实施记录，不覆盖旧清单、证据SHA或收敛结论。

## 目标与门禁

- Axiom/Pi保留原生agent循环、工具、权限、恢复；Kiro仅作provider，不采用CLI/ACP/MCP桥接，不改其他模型的协议。
- 用户已授权补证、必要修复、离线测试，门禁通过后用合法现有认证进行少量隔离真实请求。不会读取或输出真实凭据、非本轮现有用户会话或秘密日志；本轮owned child/run仅经正式API读取安全诊断，不复制token、不伪造官方身份。新登录/产品授权/无关安装仍需单独确认。
- 最大化可验证兼容不等于服务端绝对不可区分。官方caller/最终发送未闭合处保留未知，不凭字段或字符串存在猜改wire。
- 不放宽固定域、scope、一次性ticket、CRC/schema、全流成功后工具执行、取消和opt-out保护。

## 起始基线

HEAD：`f9e68b140d20edb79ece463c1632c51ca9d7afc8`；Pi 1.1.0。工作区有大量既有并行改动，不回滚、不冒领。实施前16个候选源已另存字节副本，便于区分本次改动与已有改动：`/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/kiro-native-implementation-20261027-xavgdqy0/preimages`。这些仅是字节观察，不是行为验收。

起始离线命令（在`app`）：

```sh
PI_OFFLINE=1 ./node_modules/.bin/tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1 tests/kiro-auth.test.ts tests/kiro-callback.test.ts tests/kiro-catalog.test.ts tests/kiro-chat.test.ts tests/kiro-images.test.ts tests/kiro-thinking.test.ts tests/kiro-interrupted-history.test.ts tests/kiro-runtime.test.ts tests/kiro-pooling.test.ts
```

实际结果：exit 0，89 tests / 89 pass / 0 fail / 0 skip，39383.91075ms。日志：`/tmp/kiro-native-compat-baseline-20261027-kDcGSo/test-output.log`；退出码：同目录`exit-code.txt`。使用注入fetch、内存/临时存储、localhost或隔离子进程，不调用真实账号服务。现有测试通过不表示以下缺口已经修复，也不是本轮真实推理。

## 实施范围与验收顺序

先覆盖已确认的16项待修，不把其他待证/待验项擅改成已通过：

1. K04原生分发、K47每个物理请求重新解析认证：空catalog但scope匹配的显式模型；SDK stream/streamSimple；实际split摘要、重试与取消；不发布假模型、不全局注册API。
2. K09手动回调纠错、K10认证响应字节上限：错格式/state可重填，明确拒绝/错产品/取消仍终止；声明/分块超限、慢体与迟到body回收。
3. K05/K06/K15：调用前协议诊断、目录提示不冒充推理/工具验收、缓存原因与受控刷新；不自动迁移/换号/改配置/放宽scope。
4. K25/K32/K33/K35–38：未知副作用恢复约束；保存可解释的stop/未知事件而不捏造必需terminal；微片段有界与性能；安全结构化HTTP/流错误；限流/额度/overflow分类；有输出后的重试边界。
5. K39/K49：显式计数完整性（不把初始化零当已测零）、请求时模型单价估算与账单区分、context独立传递；预热off必须命中实际getter。
6. 源码/依赖类型检查、专项mock及原有Kiro/相关共享宿主回归。测试覆盖文件执行中不修改。
7. 通过门禁后从正式Axiom/provider入口进行少量隔离纯文本、安全工具闭环；不通过临时脚本读取缓存token直连。记录实际场景、结果、费用未知与限制。

16项本地修复及下列离线门禁已完成；本轮首条正式入口文本请求已尝试但未通过，不能宣称真实可用；安全工具闭环及官方调用链补证仍未完成。每项结论以实际命令和证据更新，不以测试定义、历史实调或静态SHA代替。

## 本轮已执行的局部验证

- K04/K47：`model-runtime.ts`实例级分开真实目录与原生路由模型，并在`stream`/`streamSimple`每次物理调用前移除预解析的一次性交接，让SDK重新解析当前合法认证；不全局注册API、不发假模型、不变更直接provider票据的TTL/一次性保护。共享回归暴露了本轮旧getter在无覆盖配置、Pi直接返回native实例时的自递归，已增加实例身份保护；不能把早期3项通过当作已覆盖此分支。`tests/kiro-native-compat.test.ts`扩为4项并全部通过，新增无覆盖/仅headers覆盖时的SDK login/logout同步；原worker登录重开、目录和原生文本测试也通过。SDK在预认证阶段取消返回`stopReason=error`，不代表此时已进入provider的`aborted`路径。
- K47实际摘要：新增`tests/kiro-compaction.test.ts`，通过真实`createAgentSession`→`AgentSession.compact`→Pi split摘要与`retryAssistantCall`→原生provider，全程注入AWS EventStream/HTTP fixture。4项通过：历史及turn-prefix两次新ticket；HTTP 503零输出时一次实际重试，三次新ticket；401不重试、不提交压缩；不合作transport被取消、不重试、不提交压缩。失败边界保留SDK初始化metadata叶，不误认为必须仍是最后assistant叶。后来将首项增加模拟跨61,001ms ticket TTL的边界，单独复验exit 0、1/1 pass；未延长生产ticket TTL或等待真实一分钟。这是实际SDK摘要路径的离线验收，不是真实账号长摘要或服务端官方契约证明。
- K09/K10：手动回调允许格式/state错误重填，prompt取消/拒绝和已验证的上游拒绝/错登录分支不重试；浏览器成功取消未决prompt。认证请求使用同一30秒deadline覆盖fetch及有界读取，2 MiB本地上限、严格UTF-8/JSON，忽略signal的fetch迟到响应也会回收body，超时不等待挂起的cancel。新建`tests/kiro-auth-bounds.test.ts`，与原auth/callback两组同时运行，exit 0，17/17 pass，841.655667ms。
- K05/K06/K15：增加只读且脱敏的连接/缓存说明并展示在连接页；旧协议/地址在请求前给出保留modelId、账号、代理的手动迁移说明，不自动改配置。目录成功提示明确文本/工具权限尚未验证。缓存状态区分缺失、无scope、版本不支持、scope失配、损坏及v1/v2恢复；真实网络发布才增加generation，失败不发布部分分页、不放宽scope。新增`tests/kiro-diagnostics.test.ts`，与catalog/native-compat三组运行，最终exit 0，21/21 pass，3444.70875ms，随后两次类型检查也exit 0。期间首次20/21失败暴露了fixture误用`CredentialStore.modify(() => undefined)`（其语义是保留凭据，不是退出）；已改为`delete`并断言凭据确已删除，同时修正原catalog测试的同类虚假退出覆盖。不能把此前89项通过称为真实logout覆盖。
- 共享回归：主会话运行`kiro-compaction/kiro-runtime/model-runtime/model-copy-runtime/model-catalog/model-config-validation/model-credentials/models.test.ts`八组，exit 0，41/41 pass，0 fail/cancel/skip，115190.297958ms。日志与真实exit：`/tmp/kiro-shared-final-main-20261027-xyOsua/`；被跟踪的相关源码和测试before/after SHA均未改变。这次主复验替代了因网关429未产出结果的子任务，不能把子任务调度失败称作测试失败。前轮34/37中的Kiro递归已修；另外两条旧迁移fixture与并行的只读页面read语义不符，改为已有显式`read({normalizeCredentials:true})`后通过，不回滚共享源或改变其他模型协议。主仅修改`model-catalog.test.ts`；`model-credentials.test.ts`的同处修正由并行操作者完成，不冒领。
- 类型检查：最新在`app`分别运行`./node_modules/.bin/tsc --noEmit`、`./node_modules/.bin/tsc -p tsconfig.server.json --noEmit`，两个实际exit均0，日志及`tsc-exit-codes.txt`同上目录。之前全局tsc曾因并行新增`system-notification.check.ts`的Node.remove类型错误exit 2，主未修改该无关文件；随后当前版本复验才恢复通过，不抹去中间失败。
- 测试全部为fixture/mock或本机临时loopback，不读取真实账号配置，不调用真实认证或模型服务。失败历史保留：专项首次cwd错误、随后错误主入口导入、再后fixture缺少SDK要求的baseUrl，均exit 1；修正后才得到上述结果，不能用起始89项通过替代。预取消的初始断言也按实际SDK前置认证语义改正，未借此改SDK或吞掉取消。

## K25/K33 后续局部验收

- K05/K06/K15在共享代码并行更新后，当前`kiro-diagnostics.test.ts`独立复验exit 0、3/3 pass、1216.538ms，跟踪源与测试SHA稳定；不会沿用旧版本测试来冒称当前页面只读语义已验。
- K25：缺少结果的工具执行状态明确保留为未知；规范化user（包括隐藏custom转换）不当作真实取消或未执行证明。仅为wire连续性省略未配对调用，保留已配对结果、图片、历史ID和本地原文；请求中添加Axiom恢复安全约束：不盲目重复副作用操作，先检查状态或询问用户。诊断记录`unknown/unverified`。这是明确的恢复约束，不是可靠执行账本，也不保证模型不会另发新ID重做。
- K33：每片UTF-8字节只扫描一次，处理跨片UTF-16代理对和空片，维持实际1 MiB参数上限；几何阈值且限频预览，总预览输入小于2N。保留原始delta，最终完整JSON/object/schema及不许类型强转；流读取/未完成帧复制/完整帧三个路径都有宏任务公平预算，避免已缓冲微任务饿死取消与超时。
- 第一轮相关三组42/42通过后，独立只读复核发现大帧拆成1B立即读取时的遗漏。新增反例先实测exit 1（整帧131,194B先收齐），修复后当前三组exit 0、43/43 pass、0 fail/cancel/skip，2658.32475ms，跟踪源码/测试SHA前后均未变。证据：`/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/kiro-stream-safety-final-20261027-o4bwbklk/`。当次小chunk取消只拉取257B，timer 1.578ms、取消后settle 0.396ms；20,000个密集工具微片只处理511帧，分别8.424ms、0.197ms。这些是本机离线测量，不是硬实时上限；单次同步CRC/JSON/schema仍不可中途打断。
- 该43项执行时尚未重跑类型检查；随后下面K49同源快照的新双tsc均通过，覆盖了当前K25/K33/K49修改。旧41项共享回归依然只代表此前快照，不能声称覆盖后来所有改动。这是当时快照：其后K39与K49真实宿主局部门禁已完成（下节），K32/K35–38、最终总门禁及本轮正式入口实调仍未完成。

## K49 SDK 预热门禁局部验收

- 在worker构造资源和SDK session之前，给该SettingsManager实例的公开`getCacheWarmingMode`安装一次包装：有效`session.model`（构造前用初始模型）属于Kiro时返回`off`，其他provider委托原getter。无需修改Pi安装目录、全局/私有字段或持久化设置；保留已有task/compression的有效off投影，reload/save不被替换。
- 新`kiro-cache-policy.test.ts`通过真实`AgentSession.prompt()`、SDK warmer、runtime和全拦截HTTP验证。正价模型、100,001-token已有usage、合法60秒TTL与假时钟50秒使无门禁基线实际产生一次额外HTTP和`cache_warm`账本，即使保留旧`applyOverrides(off)`；缺省streaming在业务请求未结束期间测试，idle在settled之后测试，避免自然停止造成假覆盖。
- 有门禁时main/task/compression设置投影×缺省/idle/off均仅一次业务HTTP、无额外预热/usage/强制warm扩展回调；实际双向setModel、相同模型/复用、认证失败不切换、reload/save、取消/dispose及非Kiro真实OpenAI SSE保持原预热行为。这里是SDK实际caller与设置投影测试，尚不是完整fork worker/压缩子进程IPC验收。
- 首跑exit 1、14/17 pass、3 fail（含失败parent）源于两个测试fixture假设错误：元数据事件/字段名与setModel实际使用的checkAuth；修正fixture后无生产代码迎合。最终exit 0、17/17 pass、0 fail/cancel/skip，1875.262291ms；同一源冻结并行`tsc --noEmit`和`tsc -p tsconfig.server.json --noEmit`均exit 0、日志为空，全部src/tests的TS/TSX/MJS与两tsconfig SHA前后稳定。证据：`/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/kiro-cache-policy-final-20261027-7sccui23/`。这些是离线局部验收，不是服务端计费/产品权限证明。
- 独立只读复核后补非Kiro缺省streaming/off和已派发control warm再切Kiro场景，当前全文件exit 0、21/21 pass、0 fail/cancel/skip，1533.018542ms，源/测试SHA稳定；证据`/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/kiro-cache-policy-extended-20261027-shn9js4v/`。不能撤回切换前已派发的control HTTP，但切回Kiro后不再派发预热、旧warm不入usage。task/compression原off仅为兼容投影；SDK复用不等于实际worker IPC复用。
- 新增真正宿主隔离补验`tests/kiro-worker-warming.test.ts`，走ExecutionProfiles→ExecutionPool→生产agent-worker；只给白名单环境、临时HOME/SDK/配置/JSONL、内存认证/store，worker全拦fetch且拒Socket。只在临时worker副本移除唯一guard调用作为counterfactual，同一fixture确有1业务+1warm/账本1warm；生产版本首prompt静待1450ms无额外，再同instance affinity复用后2业务/0warm/账本0warm，pool/children/profiles完整清理。当前2/2 exit0、0fail/cancel/skip、9964.414291ms、全跟踪src/tests SHA稳定，证据`/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/kiro-worker-warming-final-20261027-6kl9yua5/`。前轮0/2仅因已知Node SQLite warning不满足fixture的stderr空断言，随后只放行精确已知warning重跑；不隐藏其他stderr。未修改安装SDK或repo业务作反例。随后root tsc首报wrapper的this隐式any和缓存literal excess property，仅修测试类型/变量后，真宿主2/2与root tsc再次并行均exit0、全src/tests/tsconfig SHA稳定，10496.772916ms，tsc日志空；最新证据`/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/kiro-worker-warming-verified-20261027-1woin12g/`。server覆盖业务与此前passed同源，未重复。这是K49本地验收，不是服务端实调或16项全修。

## K39 计量、价格快照与压缩持久化局部验收

- [共享标记](../app/src/shared/kiro-usage.ts)把request/summary、unknown/partial/complete、配置估价及请求时四费率/tiers持久化；初始化零不是实测零，完整全零可以是已测零。坏/未来marker fail-closed；只将同时报告且一致的四计数原子提交，不拼接不同快照。显式null先降partial再拒绝，缺字段才保持原快照。credits/百分比不换算token/美元。
- [请求计量](../app/src/server/providers/kiro-usage.ts)深拷每物理调用单价，按安装SDK严格超档规则估价；零单价未知，正价也只是配置估算，不是官方账单。历史与报表不重价。[会话投影](../app/src/server/agent-session-usage.ts)独立发布窗口，最新unknown/partial/全零以内容估算标estimated，不回溯旧cache计量冒称当前值。JSONL、Processing、DB重开和Costs分类均已离线验证。
- [原生压缩接线](../app/src/server/kiro-compaction-usage.ts)只包装公开session实例的事件、stream.result缓存链、appendCompaction/appendUsage，不改SDK安装目录、global或private。单段用physical usage身份认领，只在持久化副本补summary，SDK返回与physical仍可为request。双段仅在两个成功候选且无marker的SDK合计相符时增强；extra零计数、跨model/foreign响应、hook/mixed/不确定归属保守降级，不只靠合计数字发明来源。
- 取消后不提交checkpoint、不启动后续prefix；预取消不建physical attempt。后台压缩外层与内层使用同一取消guard，避免1HTTP却记2笔unknown。成功摘要只聚合成功请求，失败/重试保独立账本；原生未合并attempt用专用kind归compression，后台scratch保原IPC唯一计账，Costs优先job billing避免重复。
- 新真实压缩宿主测试走ExecutionProfiles/Pool→生产compression-worker→生产applyCompression/Processing/Costs/DB与SDK重开；白名单env/临时HOME及配置、内存认证、fetch全拦截、禁Socket、执行permit、应用幂等及child/pool/profile清理。8种场景涵盖正价/missing/partial/全零/503重试/401/用户取消/无signal provider-aborted。后者是fixture合成provider结果，不是官方wire契约。**IPCobserver由测试镜像Compressions，不等于完整Compressions/Agents产品编排。**
- 2026-10-27 06:27:49Z：12文件共137/137、0fail/cancel/skip，tests exit0、58571.322292ms，root/server tsc均exit0；全src/tests/config及6个SDK文件共1440前后SHA稳定。包含K49 SDK21/fork2复验。证据：[result.json](/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/kiro-usage-host-regression-20261027-3une3jli/result.json)。先前两轮取消/归属红灯和类型失败日志保留，未用fixture改expected掩盖虚账。
- 随后补真实SDK自动threshold与usage-based overflow，各连续两轮prompt；每轮一条完成回复+双段摘要，共6个新ticket，两个summary checkpoint、无业务重放/omission/重复ledger，重开计量与物理合计一致。06:33:48Z整compaction文件20/20、root tsc0、1440SHA稳定：[result.json](/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/kiro-native-auto-gates-20261027-mr0snalb/result.json)。只新增测试、生产源未变，server同源已过不重复。此为SDK合成usage超窗，不是已确认Kiro官方overflow错误签名或完整task worker验收。
- 剩余边界：end补账不是请求级crash-atomic；硬死、缺end、IO失败、branch summary、同manager多session与任意自定义并发调用不保证全归属。SDK公开返回不全增强，未知/歧义不猜账。所有数字仍为离线fixture，不证明真实权限/服务端费用；K32/K35–38与最终总门禁及正式入口实调继续进行。

## K32/K35–38 错误分类与安全恢复局部验收

- [错误边界](../app/src/server/providers/kiro-failure.ts)只接受完整、严格UTF-8的对象JSON作为错误体证据；本地缓冲最多16 KiB，声明与累计双校验，默认及封顶约1秒，并服从整次请求取消。按读取次数/时间让出事件循环，不合作的read/cancel不阻止终止；只解码已写区域，不保留上游可变chunk引用。此为本地接受上限，不保证网络层从未预取更大chunk，也不是服务官方限额或硬实时承诺。
- 分类只认受限namespace及指定结构字段的精确白名单，原始类别冲突先降unknown，再考虑同对象validation签名细化；不扫描任意message、requestId或截断前缀。quota与throttle分开，不推断月度/余额。未知429无自动重放提示；确认零输出的throttle/transient才使用受控英文交给Pi原生恢复。真实HTTP503可独立作为暂时不可用证据，即使代理给出非JSON；流异常不再编造HTTP429/500，diagnostics保实际HTTP状态。
- [原生流](../app/src/server/providers/kiro-chat.ts)在收到任一文本/思考/工具事件时，先于await hook与thinking标签缓冲不可逆标partial，包括空start和未发布片段。此后的异常保持error、原有内容和无重放安全前缀，不把状态码/requestId/任意上游错误拼进恢复字符串。仅精确白名单本地校验可附受控note及localCode，保留空回复/ID重复/计量不一致/参数超限等可操作说明；用户取消仍aborted。不改其他provider或Pi安装目录。
- [真实SDK恢复矩阵](../app/tests/kiro-failure.test.ts)走createAgentSession.prompt→模型runtime→生产native provider→注入HTTP/EventStream，并用安全内存计数工具验证失败后0执行、完整工具后恰好1执行。覆盖限流/暂不可用的零输出重试、新ticket；quota/未知429/误导message不重放；文本/空文本/signature/redacted思考/未发布tag/工具start与end/CRC/超时/坏计量后的partial边界；同步throw/reject/stall的provider回调、迟到fetch回收、payload/response挂起、abort竞争和真正delta后取消。它使用临时cwd/agentDir/models/JSONL及内存认证，不是白名单环境fork宿主，也不是真实服务样本。
- 显式overflow按本地白名单/严格签名交给SDK，验证一次压缩续跑预算、persistent失败、disabled与取消hook，摘要数按公开preparation匹配并重开投影。**SDK在overflow取消hook之前已可能持久化省略失败attempt；取消hook不等于撤销省略，也不能撤销外部副作用。** 全部error识别规则均为本地保守政策，尚无同版官方错误契约闭环。
- EOF成功额外记录`local-eof-policy`/`terminalContract=unverified`及未知event/stop计数，不持久化未知值，不发明官方terminal。完整工具仍须通过既有结束、JSON/object/schema/CRC及全流成功门槛；EOF推断本身并不证明服务端终止契约。
- 失败史：首新矩阵3/25通过、22失败都在fixture缺baseUrl而model undefined，早于请求；原九组84/90的六失败暴露了安全泛化遮蔽本地说明，旧六断言保留、修生产诊断后恢复。分类冲突/跨对象证据/无效证据三反例先实测28项25pass/3fail，再修复转绿。首轮与红灯证据分别为`kiro-failure-first-gates-20261027-3_3kq8hq`、`/tmp/kiro-original-nine-20261027-5c9sNI`、`kiro-failure-classification-red-20261027-wwir__e9`（其余均位于下方result的同一临时父目录）。
- 07:07:37Z六文件131/131、0fail/cancel/skip/todo、TAP9404.29075ms、双tsc0、1441 SHA稳定：[result.json](/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/kiro-failure-boundaries-green-20261027-zobrqfla/result.json)。只读复核发现测试async包装使throw与reject同路，随后仅改新测试为直接同步回调；07:12:46Z单文件52/52、root tsc0、1462 SHA稳定：[result.json](/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/kiro-failure-sync-hook-verified-20261027-jjz70cdu/result.json)。本轮Kiro协议/worker及另外五个Kiro测试未变，server同源通过不重复；**52已含在131中，不能相加为183**。1462口径另含scripts与6个SDK实际实现文件。随后19个Kiro文件与11个共享文件的最终补验已通过，见下节；本轮实调仍未完成。

## 最终离线门禁（不重复计数）

| 当前有效证据 | 文件数 | 通过数 | 说明 |
| --- | ---: | ---: | --- |
| 07:07六文件中其余五文件 | 5 | 79 | 排除后来复验的52项matrix |
| 07:12直接同步hook matrix | 1 | 52 | tests exit0，root tsc0 |
| 07:14其余Kiro专项与真实worker fixture | 19 | 219 | tests exit0，0fail/cancel/skip/todo |
| 07:13共享runtime、计量与存储 | 11 | 65 | tests exit0，0fail/cancel/skip/todo |
| **去重合计** | **36** | **415** | **全为本地mock/synthetic/自有loopback** |

- 主代理已按通知读取两组报告并核实际命令、TAP、真实exit、前后manifest、空stderr及worker进程组清理：Kiro [summary.json](/tmp/kiro-final-rest-20261027-xtieQ0/summary.json)，219/219、101788.094334ms、3374文件稳定；共享[run.json](/tmp/kiro-final-shared-20261027-hdlqs1yn/run.json)，65/65、119383.910791ms、1508文件稳定。不同manifest覆盖口径不得相加。
- 聚合[核验证据](evidence/kiro-native-compatibility/offline-verification.json)保存36文件scope、去重计数、各完整log/exit/manifest位置及关键源SHA。主另核最新3374个文件仍匹配最终快照；131与最新52之间只有matrix属于本轮Kiro变化，其余三个并行变化为`ModelUsage.tsx`、`model-usage.css`和`provider-usage.check.ts`，不冒领或回滚。最新root tsc覆盖其类型，不代表其UI运行验收。不能把“本轮Kiro生产未变”扩写成整个工作区未变。
- 所列离线实现及门禁完成不等于已部署到正在运行的应用、真实服务可用、现场故障根因已确认或官方调用链闭合。后续首条正式入口文本已实际失败，见下一节；不能用离线415全绿覆盖真实失败。不读取旧用户会话、抄token直连或擅自新登录，也不为凑验收盲试其他模型。

## 本轮正式入口实调：未通过

- 证据索引：[live-verification.json](evidence/kiro-native-compatibility/live-verification.json)。仅本轮新任务、新state与合成输入，不复用历史实调或用户聊天，不抄token直连。
- 首次实调当时的运行构建先核验：PID32633入口为本仓库`app/dist/server/index.js`，07:31:38Z启动；新临时目录完整发射303个server/shared JS与现有dist逐字SHA相同，最新dist时间07:24:39.348481Z，早于启动。编译exit0；没有重启用户应用、修改app/dist或持久补丁SDK。这不是只凭源码测试通过声称已加载。
- 用Axiom delegate新建`t6466`空白任务。其默认非Kiro子模型的READY回合只用于准备，不作为Kiro验收。正式模型选择仅改新child为`kiro / claude-sonnet-5.5 / off`，未改全局默认；这来自配置可用清单，不代表实时服务支持。
- 07:49Z仅发送一条无工具的合成37乘19/独立nonce文本。真实`/ws→scheduler→agent-worker→native provider`，receipt的task/input与新run强关联为true。**结果failed/MODEL_ERROR**：“模型请求失败：Kiro 请求验证失败，请检查消息、所选模型及 profile。”；正文空、thinking0、toolCalls0、toolResults0。driver exit1是如实报告该失败，不是通过。首条失败后停止，未换模型或重发，安全read工具闭环未执行。
- 首调结束时只确认一个真实逻辑prompt，当时的正式投影没有原生diagnostics，不能给出具体HTTP状态、物理HTTP数、哪个字段有误或精确费用。随后13:20正式只读投影已确认HTTP400/ValidationException，见下节；仍不证明模型ID、profile、消息或最终wire哪个有错，更不证明认证或推理权限已通过。物理HTTP数、用量/费用仍未知，不把0初始化当免费。
- 事后`verify-defaults`真实exit1：main的OpenAI copy模型ID发生漂移（thinking不变），default子模型未变。来源/操作者未知，不冒领或恢复用户当前选择，也不把这一项写成“main/default全不变”。本次选择命令的scope仅为新child。
- `configuration.available`只是配置筛选结果。用户在已说明`configuration.catalog`可能刷新合法认证、写scoped缓存和规范化旧Kiro凭据后要求继续解决。08:39:26.259Z经正式WS一次catalog成功，source=native，返回21个模型，含`claude-sonnet-5.5`，见[catalog-verification.json](evidence/kiro-native-compatibility/catalog-verification.json)。这确认该ID存在于当前账号目录，不证明07:49历史目录、聊天权限、请求被接受或工具可用；没有为此追加聊天/换模型/新登录，不声称规范化实际发生。
- 完整本轮artifact位于`/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/kiro-native-live-20261027-7fzaqdee/`；构建核验位于`kiro-live-build-proof-20261027-u4gc5x9h/`。本地415离线验收与本轮实调失败分别保留，不能互相替代。

## 失败后继续查因：尚未完成

- 不将不可用接入作为交付。新增[安全投影](../app/src/server/kiro-failure-display.ts)与[共享白名单](../app/src/shared/kiro-failure.ts)，仅从终态Kiro assistant重新构造stage/category/partial及可选HTTP status、固定已知code、36字符UUID requestId；拒绝重复/非法必需值，不透传原始diagnostics、body、headers、任意Error/note/localCode。运行时白名单冻结；ordinary getter安全承诺仅限该纯投影器，不泛化为整个消息链/Proxy沙箱。
- [投影单测](../app/tests/kiro-failure-display.test.ts)21项及[正式WS隔离读取](../app/tests/kiro-failure-display-ws.test.ts)1项已在09:18:54–09:19:01的1493文件稳定快照通过，覆盖新临时native session/DB的snapshot、message.get、agent.original与跨session/workspace拒绝；没有真实账号或模型请求。后端noEmit在09:17:35–09:17:39 exit0、1471文件稳定；全项目noEmit当时因非本轮`compression-ui.check.ts`访问旧`app.url`属性exit2；后续10:34及10:48全项目检查已通过，不冒领该无关修正。
- [共享主流程](../app/tests/agent.test.ts)已于09:52完整通过，exit0、1/1、0fail/cancel/skip/todo，9535.889083ms，见[实际命令](/tmp/axiom-agent-single.OlhwKb/command.txt)及[SHA差异](/tmp/axiom-agent-single.OlhwKb/sha256-diff.json)。覆盖工具、取消、第二session完整记忆路径、持久恢复/无重放、脱敏、模型撤销与crash恢复。原第6HTTP未保留payload，不能倒推其归属或证明生产memory泄漏；fixture现在把异步标题请求独立计数（并行操作者加入，不冒领），没有弱化MEMORY.md断言或修改生产memory/权限以求通过。生产源和被执行测试未变；1499项清单仅外部session-environment.check.ts变化，不能称整棵工作树冻结。
- 新增可选`observedValidationReason={token,contract:"unverified",source:"local-static-allowlist"}`，仅保留[本地冻结的11个候选字面](../app/src/shared/kiro-failure.ts)，不当作官方chat枚举、语义或唯一根因。只从完整有界JSON的根/直属error自身own ValidationException code与自身reason exact关联，unknown/不同reason/分类或HTTP冲突均不附；投影再次核stage/status等字段一致性并重建三个标量。标记只用于观察，不修改category/evidence/errorMessage/retry/overflow/compaction/partial门禁，不透传任意reason或message。JSON.parse不检测原始重复键；provenance检查也不是服务来源真实性证明，缺少观察不证明服务未返回reason。
- 新观察[分类与投影测试](../app/tests/kiro-observed-validation-reason.test.ts)、真实SDK http/text/thinking/tool partial与持久化重开、正式WS三读路径已通过，见[诊断门禁索引](evidence/kiro-native-compatibility/diagnostic-verification.json)。首轮tsx在IPC启动时EADDRINUSE、TAP为0字节，无功能结果；改用短/tmp隔离根后四文件104/104通过。随后按独立审查锁定完整11值词表，并加入observed/legacy各四种overflow恢复组合；最新两文件86/86、exit0、0fail/cancel/skip/todo，5117.33475ms，1480文件SHA稳、stderr空。86替代旧104中的82，另保未变21投影+1WS，去重为四文件108，不与104或旧415相加。
- 原五文件组31/32、exit1保留：唯一model-runtime旧cache失效断言与现有资源准入合约不符。核对既有诊断/认证/执行隔离回归后，仅校准该测试并增强owned snapshot、原models/auth不变断言，未改生产准入。最新[四文件合约门禁](/tmp/kr-dnu3an27/result.json)41/41、exit0、11489.0105ms，1480SHA稳、stderr空。10:48[root noEmit](/tmp/ne-cb2p2785/result.json)exit0、空输出、1480SHA稳；10:34[server noEmit](/tmp/axiom-noemit-evidence-b423qyra/summary.json)exit0。这些是当时快照；新增safe-point等后端/共享生产变化后，10:59[最新root/server noEmit](/tmp/kro-crs2kq_9/run-summary.json)均exit0、空输出、实际1483文件前后SHA稳，未emit，不能把1483与旧1480误当同一清单。其他并行UI/测试跨轮有变化，不能把各轮自身SHA稳定扩写为全树跨轮不变。
- 跨轮SHA还确认09:52主流程通过之后，worker、消息views/transcript、压缩及新增continuation/native-compaction policy发生外部生产变化。因此补跑当前主流程与受影响共享回归，不沿旧1/1宣布当前宿主绿、不重复未变Kiro专项；这些外部实现不冒领为本轮Kiro修复。10:52新主流程1/1 exit0、1481文件本轮稳；其后8共享文件40/40 exit0，但运行中`session-safe-point.ts`及`ModelUsage.tsx`发生SHA变化，不能认同一冻结版本验收。只读依赖核对后保留未受影响五文件32项；只补三个受safe-point影响的文件，并加当前主流程、安全点、Kiro真worker／压缩、计量与受网络依赖影响的准入回归，不将40项绿掩盖生产漂移。末次三组现已收齐并核原始命令/exit/TAP/stderr：五文件宿主与安全点13/13、三文件Kiro warming/压缩/compaction 30/30、六文件计量与准入63/63，全部exit0且stderr空；63含旧41，不能相加。三组各1483文件清单只有未执行的integration test变化，三组after完全一致；该test无源码字面引用且不在执行argv，不能把这种无关变化当失败而无限重跑。
- 历史[最终SHA门禁](/tmp/kiro-memory-handoff-1793098013780/final-snapshot-verification.json)实际exit1，原因是末次测试后worker、compression-worker、ledger、costs等外部生产再次变化并新增generic `native-compaction-usage.ts`，不是13/30/63功能失败。用户随后确认稳定窗口已就绪，**该等待已解除**。保留32项的运行时相对模块闭包经TypeScript去除type-only import后逐项SHA相同，大小2/4/2/23/43，见[闭包证据](/tmp/kiro-memory-handoff-1793098013780/runtime-closure.json)；旧外部包图未完整指纹，不泛化为整个SDK不变。
- 稳定窗口中确认一项后续K39回归：完整测量但请求时价格未知的Kiro记录，仅因后续传入公价表同名model ID而变成公共估算。纯对象probe确证，新增真实request/summary × unknown/configured四组合反例先红（5项4pass/1fail），再在[usage-cost.ts](../app/src/server/usage-cost.ts)公价fallback最小加入`!kiro`；其他provider公共估算保留。这是计量回归修复，**不是原实调Validation根因或wire修复**。[公价反例](../app/tests/public-model-pricing.test.ts)检查exact ID碰撞及历史不变；[SDK压缩fixture](../app/tests/kiro-compaction.test.ts)按生产顺序安装Kiro/native双guard并加强无重复账断言，未改其他并行实现。
- 修后11:51–11:52定向复验已完成：Kiro宿主30/30、计量/公价77/77、主流程/任务预算/正式WS三路径3/3，**12文件去重110/110，0fail/cancel/skip/todo**，root/server `--noEmit`均exit0、空输出。五组各3412路径（含skills及Pi三包dist/package）前后与跨组manifest完全相同，最终review仍匹配；[聚合验证](/tmp/kr-rs-tbdtM3/recovery-verification.json)真实exit0、92checks、failures=[]。全部原始命令、TAP、真实exit、UTC及全SHA见[稳定窗口证据](evidence/kiro-native-compatibility/stable-window-verification.json)。原诊断107项保留未变逻辑范围，WS1已补测；不与旧108、415或13/30/63重复相加。顶层stderr空不等于全部子进程无原始warning；harness只放行已知SQLite warning。白名单环境/PI_OFFLINE不是OS网络封锁，scratch仍为镜像IPC而非完整Compressions编排。
- 上述11:54是本地定向验收的历史快照，当时尚未部署。用户随后明确要求使用`axiom-backend-restart` skill，覆盖此前“必须用户编译重启”的限制；本轮根完整构建及一次独立重启已完成，当前部署/只读结果如下。旧PID52902的8模块与PID32633的303模块证明仅属各自时点，不沿用为当前进程证据。

## 授权重启后的正式安全诊断：已读，根因未明

- 根`npm run build`真实exit0；独立控制器将29659→43577，21:10:02+0800状态`verified`、HTTP200及WebSocket握手成功。之后再次确认43577的实际Node/本仓库`app/dist/server/index.js`、cwd及4317监听。没有重复launch或读取可能含访问token的server.log。
- 进程及构建结论限于截至13:20:58.369899Z的证据窗口，不作持续监听保证。正式读取前隔离server编译真实exit0、stdout/stderr空，314个生成JS与当前dist逐个SHA一致；包含app/dist与Pi三包的4240路径前后/读取后无变，生成dist最新13:08:34.078414Z早于当前进程13:09:58Z启动。12个诊断源/test与7个WS宿主/test的SHA未变，保留其原检查范围，不把旧110/108/415称为本轮重新执行。额外164个非本次生成dist JS不在314匹配结论内；未清理或声称全模块缓存可见。
- 13:20:50.624Z只通过正式WS API，先父tasks核`t6466`的task/parent/child，再仅该child的messages与`message.get`，以原inputId+runId关联。读取真实exit0，snapshot/get相同：`stage=http`、`category=validation`、`partial=false`、`status=400`、`code=ValidationException`，以及白名单UUID requestId。完整安全字段与证据索引见[owned-failure-read-verification.json](evidence/kiro-native-compatibility/owned-failure-read-verification.json)。没有读取原始服务body、真实凭据、非本轮聊天、配置全文或秘密日志，没有追加模型prompt/工具、目录刷新或重放失败run。
- 旧消息没有可投影的`observedValidationReason`，不能据此断言服务当时没有reason。HTTP400仅确认持久化诊断所记录的拒绝状态，不定位具体错误字段，也不能给出物理请求数或费用；仍未确认wire根因，不能称Kiro可用。安全投影本身完成正式读取验收。
- 后续文本复验需要可支持修复的非敏感reason/已知可接受的官方请求约定；若要在未证明wire修复前发送一条新隔离诊断文本以采集新观察，须先由用户明确选择，不把本次重启或只读续办视为新增诊断prompt授权。安全工具仍依赖文本成功；未启动新的模型尝试。

## 官方证据边界

既有11个同版局部REA函数不等于完整调用链，也不等于49项逐项官方源码对齐。本轮新增的字节提取仅复核了一些URL/头值/Bearer字符串，不能证明endpoint resolver、Authorization枚举键、POST/Accept、最终send、token来源或modelId/systemPrompt caller默认。本轮Hopper实际尝试未取得新反编译/xref：独立REA CLI 6.7.0启动超时并报告`cleanup_incomplete`，与应用集成MCP 6.8.0连接是不同会话。后者`open:false`不能证明前者启动的Hopper文档已关闭。已停止重试并告知用户仅关闭本次`kiro-cli-chat-arm64`文档，不退出整个Hopper、不影响其他文档。相关失败记录：`/tmp/kiro-native-rea-20261027-focused/hopper-analyze2-result.json`；这部分完整链补证仍待受支持条件恢复；本地修复及离线验收已完成，不能以披露未知代替官方闭环。

实调后最新MCP只读状态显示6.8.0新连接对齐（server start07:45:37.376Z），open=false、cleanup_pending=false、analysis未观测/provider为空。这仅针对该新MCP连接，仍不能证明旧独立CLI6.7资源清理或完整反编译后端就绪。

另实际执行了一次无需open target的REA符号表检查：[official-static-probe.json](evidence/kiro-native-compatibility/official-static-probe.json)。同一chat原始SHA前后一致、exit0、完整未截断；684符号记录中683是未定义导入，唯一定义项为__mh_execute_header，并未提供已知请求函数的名字。该工具仅支持symbol选择而不支持VA范围，未为绕过限制重开target、全量反汇编或重复旧timeout。这条静态路径不产生新caller边，不闭合鉴权/endpoint/最终发送。随后用户明确要求继续解决，正式目录已完成且含失败modelId；当前继续安全诊断及必要源修复/门禁，非等待目录授权。尚未因此新增模型请求、重开target或把静态结果当作官方闭环。
