# 企业 Kiro 重启与模型验收

## 当前结论
企业目录（21模型）及精确Opus5.5/Sonnet5.5添加完成。精确Sonnet5.5 Responses路由与schema参数修复后，**sonnet-05真实验收通过**：编码10例、工具结果回传、图片识别全部通过；3次模型请求均200，结果/退出码已读回。190项源码离线回归、完整构建及第五次重启基础验收通过。

05使用独占构建快照的原生SDK、正常Axiom企业账号，不经CLI代发。SDK兼容off入口实际effort为high，并非关闭思考。共享dist随后曾被外部改写，因此快照功能成功不冒充后台/UI加载该产物或完整CLI对齐。下列01–04失败是历史阶段；全部旧claim及05成功claim均耗尽，禁止重跑。旧400的唯一根因未被单次成功严格证明。

## 已核实
- 首次根目录 `npm run build` exit0（build.log、build.exitcode）；随后GAR target最小修复后的完整构建亦exit0（gar-build.log、gar-build.exitcode）。
- 独立重启控制器状态 verified，2026-10-31 19:22:29 +0800，旧PID41551→新PID54505，HTTP200、WebSocket connected。原始状态：`/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/axiom-backend-restart-6nzurepn/status.json`。
- 真实新后台 `/ws configuration.catalog`：当前 identity-center 企业账号、source native、21模型，包含 `claude-opus-5.5`、`claude-sonnet-5.5`；模型配置前后不变。见 catalog-01.json。
- 经正常 `configuration.save` 添加上述两项，再次get确认持久化；原deepseek保留，其他供应商、settings、账号索引、代理不变。见 add-models.json。未修改全局默认。
- 离线回归：chat/native compat 23/23、images 8/8，均exit0；见 chat-tests.log、image-tests.log 及对应exitcode。

## Sonnet 验证进度
- sonnet-01实发失败：profile1次200，模型1次403，auth0/catalog0；terminal error，未执行工具/回传/图片。见 sonnet-01.json，claim已耗尽，禁止重跑。
- pendingAcquisitions0、activeBodies0、dispatcherClosed/configUnchanged true，清理成功。
- 离线7场景通过（成功、坏帧、错图片、cancel、late、stalled、budget）及代码判分攻击拒绝，门禁独立复核通过。sonnet-01-selftest.json SHA1567d0da4db17431fd8e6cd20437d68c0096c9f06a34143de3ea48cc2ed7cf88；最初存在门禁缺口的旧selftest保留before-review版本。
- 正在静态诊断推理路由；403本身不能证明企业账号不具模型权限。KAS0.66.70完整serializer证据见 sonnet-routing-static/REPORT.md：Responses由实验开关选择（默认disabled），不是按模型ID；默认GAR使用AwsJson1_0Protocol、POST /、target KiroRuntimeService.GenerateAssistantResponse与二进制eventstream。更正：此前阶段引用旧dispatch-report的 /generateAssistantResponse 只是REST schema trait，不代表实际wire路径。Axiom旧CodeWhisperer target是明确差异，现已最小修正为KiroRuntimeService；不改路径/解析器、不盲迁Responses。Git历史显示推理早已用runtime主机，无q→runtime误迁依据。实际CLI实验开关与本次403根因仍未知。合同 SONNET-CONTRACT.md、harness sonnet-01.mts、可信子进程判分 code-runner.cjs。
- 修复后两组离线回归71+99=170测试通过，exit0（gar-tests-a/b.log及.exitcode）；新增Sonnet/Opus精确ID的root/target/eventstream/profile/optout保护断言。
- 第二次独立重启verified，2026-10-31 19:40:30+0800，旧PID54505→新PID59104，HTTP200/WS connected；状态目录 `/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/axiom-backend-restart-q7a5ljon`。这是修复后的服务加载基础验收，不是聊天worker/UI端到端。
- sonnet-02新合同/门禁9场景通过，含已知与未知403脱敏；独立重算1139文件SHA283ef328a3e71f63172b2c66a1fa550bf8b7d01697e49b2c2bf94ae126094ef7一致（sonnet-02-selftest.json）。前次审查因重启先通知cancel，随后可靠完成结果到达；重复审查已取消，未重复实发。
- sonnet-02实发仍失败：profile1×200、模型1×403，完整JSON错误码AccessDeniedException、requiresModelOptIn=false，auth0/catalog0、terminal error。未执行工具/回传/图片；pending0/body0/dispatcherClosed/configUnchanged/clean true。见 sonnet-02.json；02 claim耗尽，严禁重跑。
- 静态核实另有企业认证头缺口：官方GAR factory调用Cy(identity.authMethod)，IdC明确映射TokenType SSO_OIDC；Axiom既剥调用方该头又漏自设。已仅为GAR identity-center补齐，非企业/未知不误标，调用方不可覆盖。相关源码request.ts、kiro-native.test.ts；证据runtime-factory.txt与旧static-current/token-type-map.txt、token-type-middleware.txt。
- 最新12文件171测试通过，完整构建exit0（tokentype-tests/build.log及.exitcode）。sonnet-03新合同、9自测通过，SHAd02461b3793dc0d5ceaa35fc46b3a0fbc3c89617ee3ce017ecadbb1f23f2b16c。第三次重启已verified（19:47:14+0800，PID59104→60277，HTTP200/WS connected，状态目录 `/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/axiom-backend-restart-2jy6ru9d`），分发request.js已核新target和TokenType。限定门禁独立复核通过、1139文件SHA一致。sonnet-03已执行一次并失败：profile1×200、模型1×403，AccessDeniedException、requiresModelOptIn=false，auth0/catalog0、terminal error，未执行工具/回传/图片。pending0/body0/dispatcherClosed/configUnchanged/clean true，exit1。见sonnet-03.json；03 claim已耗尽。依合同停止Axiom实发，不逐项猜头重试；后续官方CLI自主验证见下节。
- AccessDenied不单独证明账号模型权限，也不证明协议修正无价值。未知错误正文未保存，不能再恢复或虚构message。
- 编码/工具/图片真实能力均尚未通过；Opus只是已添加。

## 官方CLI自主验证
- 当前 `/Users/dane/.local/bin/kiro-cli` 2.37.0，SHA b88fe85d0c847b55af6212017c140722ff84bf081f18bc7bdba5188ade2fa54e。正常whoami --format json一次exit0，只保存白名单provider=Google；未保存email或凭据。见official-identity-01.json，claim耗尽。登录模式不同，不能证明与Axiom企业账号可比。
- official-sonnet-01仅在settings preflight退出1，chatLaunches=0，claim耗尽。后核settings list --help，修正--format应放list之后；正确只读命令已验证JSON/exit0，不是模型重试。
- official-sonnet-02在独立临时workspace、无工具/MCP/powers资源的自建agent（validate exit0）、正常既有Google登录下实际执行一次 `chat --v3 --no-interactive --output-format stream-json --model claude-sonnet-5.5 --agent axiom-official-sonnet-02 --trust-workspace --trust-tools=`，只问37×19。结果exit1、17条JSON、未观察到回答/终态/工具事件；物理HTTP与内部重试数量unknown，不冒充单请求对齐。stdout24120/stderr852字节原文只RAM且已释放；首次投影的已知错误谓词均false。后续从官方已有日志取得独立关联证据，见下项；不是恢复或虚构旧stdout。
- settings前后相等，进程组清空、临时目录删除。复用监督器7项离线门禁通过（成功/超时/超限/工具停止/子孙组清理/未知错误脱敏/用户内容不算回答）。完整合同、harness、白名单结果分别OFFICIAL-SONNET-02-CONTRACT.md、official-sonnet-02.py/.json；claim耗尽，不因解析字段不足重放prompt。
- 已从 `~/.kiro/logs/<时间目录>/kiro.log` 只读RAM投影：case时间窗内仅1候选文件，且匹配自建agent/临时cwd标记，100条日志/5条错误；同一错误记录含精确claude-sonnet-5.5及Invalid model/Model is not available，requestedModelRejected=true。见official-sonnet-02-log-classification.json；没有保存任何原文/动态ID，没有新模型调用。未获得HTTP状态或ACP拒绝method，不将其说成服务端403。
- 官方正常 `chat --v3 --list-models --format json` 一次只读exit0、合法JSON，精确Sonnet5.5与Opus5.5均未出现，已知ID中见Sonnet4.5与DeepSeek3.2。见official-model-list-01.json，claim耗尽。与模型选择拒绝相互支持，但不是企业账号权限证明。
- 用户完成登录后的official-readback-04.json确认IamIdentityCenter及目录精确Sonnet5.5/Opus5.5；该身份whoami --format json实际上输出非JSON，02/03只读观察器失败并耗尽，04兼容有限文本投影。此前Google目录结论已不代表当前身份。
- official-identity-compare-01.json：Axiom正常SDK metadata与官方正常whoami仅RAM比较，issuer和region均相等，双方企业认证；profile不可比较、同最终用户未直接证明。不读取CLI凭据存储，不输出身份原文。
- official-current-route-01-fields.json：登录后唯一新官方KAS日志，精确Sonnet5.5 dispatch api=CreateResponse/streaming=true/origin=KIRO_CLI；q.create_response.request同模型且官方runtime；activeExperiments明确create_response_api=create_response。另一次GAR dispatch不是Sonnet5.5。初版空结果源于metadata在message字符串内，markers和fields版纠正了观察器，不能当成日志缺失。
- 上述info是实际选路/请求前证据，不冒充最终wire或HTTP成功（成功由用户报告）。没有新模型调用/代理/TLS变更；UA gate=false不证明无UA。进入仅精确Sonnet5.5 Responses功能补丁，不盲迁所有Claude/Opus，也不冒充实现完整实验配置。403因果、编码/工具/图片仍待新case验收。

## 精确 Sonnet Responses 修复
- 源码responses/thinking/client/request已限定修复：仅新增claude-sonnet-5.5，保留DeepSeek；Opus及近似ID不迁移。未提供reasoning保留服务默认，自有undefined为disabled，各effort为adaptive+effort；原生reasoning不再注入或解析XML。公开NAi/MAi/OAi及ICn/Foe/Responses sender链分别保存responses-reasoning-helpers.txt与responses-token-type-chain.txt。
- 核心48/48（responses-tests-a.log）；周边首次161/162，唯一diagnostics受继承的执行绑定污染临时账号fixture，去掉5个执行绑定env后该文件3/3（responses-diagnostics-isolated.log），未为此改产品。共210个独立测试最终通过，原失败日志保留。独立静态审核无本次最小补丁阻断。
- 首轮build遇独立并行工作search-browser.ts的windowsHide类型错误；重新读取时已由外部修正，本会话未改该文件。第二轮完整npm run build exit0（responses-build-02.log/.exitcode），涵盖类型检查、前端及server。
- 第四次独立重启verified，2026-10-31 20:35:48+0800，60277→85984，HTTP200/WS connected；状态目录 `/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/axiom-backend-restart-8ibe5kn8`。dist已核精确路由、disabled及SSO_OIDC；不是worker/UI聊天端到端。
- 新SONNET-04-CONTRACT.md及sonnet-04.mts：SDK观察器委托实际kiroNativeFetch→node:https，辅助请求才原fetch；SSE终态、完整工具/历史/图片与预算门禁。初审指出includes不足以证明完整上下文，已强化整个input/tools严格等值，首轮证据保留before-review。修订后9门禁通过，独立1151文件SHA425c96b30b1f37cea9855933b71e3ff1a2279c4b3cbcc2614b20f12a6d7ed8f0一致；指纹是前后检测而非文件锁。
- sonnet-04一次live exit1：auth1×200、profile1×200、model1×400，Responses请求已过精确参数/context门禁，未产生SSE；TOOL_TERMINAL/error，完整JSON knownCodes=[]、opt-in=false。pending0/body0/dispatcherClosed/configUnchanged/artifactUnchanged/clean true。见sonnet-04.json，claim耗尽；未知原文已释放，不得恢复/虚构400原因，也不因403变400便声称权限或唯一根因已解决。后续静态核对已完成，不重新发模型猜测。
- 官方FOo顶层instructions承接system，Axiom完整system嵌首个user；工具首轮type/name/description/parameters形状一致。metadata及工具结果历史格式存在差异，但未证明400因果；见sonnet-routing-static/responses-input-tools.txt。
- 官方puc/EEt/SEt按实际schema选择thinking：只有enum同时含disabled/adaptive才可切换，off可合法为disabled且独立携带默认effort；off会封顶xhigh/max。Axiom目前硬编码且目录转换丢弃schema。不能无条件删disabled或编造default；见sonnet-routing-static/responses-off-source.txt。
- 新official-model-metadata-01只执行一次正常CLI list-models，无prompt；exit0、精确模型对象1个，但五项normalized thinking/effort字段均未暴露。groupClear/tempRemoved true，未知原文未保存，claim耗尽；见official-model-metadata-01.json。随后原生schema投影已完成，见下节。

## 实际 schema 与参数修正
- catalog-metadata-01新独占case：profile1×200、目录1×200、模型/刷新0，exit0，pending/body0，dispatcherClosed/configUnchanged/artifactUnchanged/clean均true；claim耗尽。九项离线门禁最终通过，两个观察器失败日志保留；独立审查无放行阻断。
- 精确Sonnet55 thinking.type enum投影为adaptive/other；disabled在白名单中但没有出现，故已证不含disabled，未知另一值不保存或猜测。effort五档low/medium/high/xhigh/max，默认high；根required为空，不能因thinking内部required type就认定thinking必填。见catalog-metadata-01.json。
- 结合官方puc/EEt，精确Sonnet55应不发送type。当前thinking/client已修：默认/SDK own undefined使用high，显式effort不降级，实际providerThinkingLevel保真；own undefined记录off-unavailable，**不声称关闭思考**。不顺手改全局off能力map，以免宿主clamp默认到low。默认也拒绝非空token预算。
- schema-tests-a首次31/32通过，唯一standalone因root cwd失败；在app cwd仅重跑该项1/1通过。schema-tests-b十文件158/158；共190个独立测试最终通过。后补近似ID默认/off断言，仅该测试再跑1/1（schema-tests-exact-id），不重复计数。
- 独立源码审查无阻断；docs/kiro-thinking.md补精确Sonnet例外，并更正“推理发送前校验”不等于profile查询前。schema-build完整npm run build exit0；第五次重启21:07:53+0800 verified，85984→97749，HTTP200/WS connected，状态目录 `/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/axiom-backend-restart-5af99mre`。sonnet05随后在独占快照通过真实能力验收，见下节；不据此证明旧400唯一原因。

## sonnet-05 真实能力验收通过
- [结果](sonnet-05.json)与[退出码](sonnet-05.exitcode)已读回：passed=true、exit0。profile1×200，模型3×200，auth/catalog0，无重试；终态toolUse/stop/stop，3次completed模型均匹配精确claude-sonnet-5.5。
- 生成的mergeIntervals函数通过10例边界/输入不变测试；原tool call/result配对回传随机receipt，最终精确匹配；三形状PNG颜色/形状及JSON键全部正确。模型代码/正文未持久化。
- 三轮providerThinkingLevel均high，off-unavailable诊断均true。发送reasoning仅effort high、无type，完整system/input/tools/history/图片严格校验；原kiroNativeFetch→node:https，非CLI桥接。
- pendingAcquisitions/activeBodies均0，dispatcherClosed/configUnchanged/artifactUnchanged/clean均true。账号、默认模型、代理等配置未改。05 claim已耗尽，不再实发。
- 初审补上live也强制3×high/诊断true的验收条件；随后共享dist被外部构建反复改写，原集合无法证明相同，保留before-review/before-rebuild/before-snapshot门禁及旧manifest，不据旧proof放行。
- 最终独占快照 `/private/tmp/axiom-sonnet05-hdZtueQ9` 完整复制dist/node_modules及非敏感fixture，无账号配置。9离线模式、代码攻击与effort负例全部通过；独立审核无阻断，1147文件两次SHA与proof一致：`7b646403a758ad12f3352b6391c1c8ac270bca4dc5a031e7b4054defc6158ea5`。见[门禁](sonnet-05-selftest.json)、[快照manifest](sonnet-05-snapshot-manifest.json)、[合同](SONNET-05-CONTRACT.md)。证据/proof/wx claim始终写仓库唯一目录。
- 实际命令在快照cwd：受控Node22运行 `app/node_modules/tsx/dist/cli.mjs docs/evidence/kiro-enterprise-validation-01/sonnet-05.mts --live`，exit0。之后cmp确认仓库harness/合同/runner及5个关键dist文件thinking/client/responses/request/http与成功快照逐字相同；这不等于整个共享构建或常驻服务相同。

## 用户追加部署已完成
用户随后明确要求重启。新 `deploy-sonnet-build.log/.exitcode` 记录完整 `npm run build` exit0；构建后cmp确认thinking/client/responses/request/http五个关键dist与05成功快照逐字相同。fresh核当前进程后独立控制器重启，2026-10-31T21:27:52+0800 verified，97749→5710，HTTP200、WebSocket connected。状态 `/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/axiom-backend-restart-comybsr0/status.json` 已读回；未重放模型case，未新增UI聊天验收。

## 实际聊天工具 Schema 故障与修复
第六次重启后，用户实际聊天截图显示11工具、“你好”失败：`Kiro 工具参数必须使用 object JSON Schema。`。此前部署后称“现在可以在聊天界面使用”过度外推，予以纠正：05只证明独立单工具SDK，基础重启也不证明真实聊天全工具可序列化。

本地复现确定 `web_read` 的三个object联合分支缺少显式根type，被 `kiro/protocol.ts` 的根object检查拒绝。最小修复仅在 `shared/web-read.ts` 的原 `Type.Union` 增加 `{type:"object"}`，不放宽Kiro校验，不扁平化anyOf、不丢required/additionalProperties或长度数量约束；TypeBox Static联合类型不变。仅根声明增加冗余约束，没有删除任何工具。

离线验证50/50：
- [网页工具日志](tool-schema-web-tests.log)：web-read/web-search共25/25，exit0。旧新Schema在Check/Compile上的4合法、23非法样本一致，新的Pi参数验证器同样通过；真实web_read经GAR/Responses完整保留，primitive仍拒绝。
- [实际工具集日志](tool-schema-session-tests.log)：session-environment、Kiro Responses及Sonnet共25/25，exit0。真实SDK隔离会话默认11工具与自定义配置集合均经过请求构造，完整Schema/描述保留且原定义不变；没有模型请求或工具业务执行。
- 独立只读审核无阻断。上述不包含运行中用户会话的动态扩展/MCP、真实sender、远端接受该anyOf或UI聊天成功。完整 `npm run build` exit0，见[构建日志](tool-schema-build.log)与[退出码](tool-schema-build.exitcode)，编译产物根object及三分支已读回。第七次独立重启于2026-10-31T21:46:34+0800 verified：5710→12171，HTTP200、WebSocket connected，状态 `/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/axiom-backend-restart-ib7fvotl/status.json` 已读回。此处完成的是本地Schema修复及部署基础验收，真实用户聊天回包未复验；不重放任何耗尽的live claim。

## 第七次部署后的真实聊天 HTTP400
用户再次截图出现未知服务响应失败。只读数据库与关联Pi JSONL的安全投影确认：第七次重启之后唯一匹配失败，实际assistant的axiomRunId与该run精确匹配，模型为精确Sonnet5.5/native Kiro，启动选择xhigh。诊断为HTTP400、JSON错误体、unknown/evidence none、无分类冲突、无partial；有requestId但未复制。存储环境含11工具，web_read根object且anyOf三分支；该环境不是冻结的最终发送快照。见[安全证据](chat-service-failure-01.json)。本次调查新模型请求为0。

未知错误正文未进入持久诊断，不能事后从现有记录恢复；未证工具anyOf、xhigh或权限中的任何一项是原因。05成功的单工具/high不覆盖此次主聊天。下一步需要用户允许一个新的、最多1次模型请求的受控诊断case，保留当前精确模型/xhigh/完整工具及上下文，不执行返回工具、不自动重试；授权后先建立新合同、完整预算与独占claim，再执行。旧claims不得重用，本轮未新建或消耗live claim，未改产品、重启或切换配置。（后续：用户已授权实测，见下节。）

## HTTP400 安全观察器与实际聊天根因
- 观察器：`kiro/error-observation.ts` 封闭白名单，仅 400 时写 `kiro-http400-observation` 诊断，不改分类/重试。测试121/121、收紧后75/75、build exit0（http400-observation-*）。第八次重启 verified，PID 12171→25547。
- chat-live-01（无效）：脚本在 run 仍为 starting 时恢复默认模型，竞态使实际请求走 kiro.rs/Opus5.5，原生 Kiro 请求 0 次。
- chat-live-02（有效）：经 `ws://127.0.0.1:4317/ws` 新会话、临时 agent.model=kiro/claude-sonnet-5.5/xhigh、完整工具、1 次 prompt。结果 HTTP400，error.code=invalid_request，message 提及 tools、input_schema、anyOf/oneOf/allOf、top level。结论：服务拒绝工具 Schema 顶层组合关键字（web_read 根 anyOf）。结束后默认模型已恢复 kiro.rs/claude-opus-5.5/xhigh。见 chat-live-01/02.json。
- 修复：`protocol.ts` 的 `kiroWireToolSchema` 仅在发送层合并根 anyOf/oneOf 的 object 分支，描述补充参数组说明；本地仍按原 union 校验；不可安全合并时本地拒绝。
- 审核后收窄：仅当所有分支 `additionalProperties:false` 且只含 type/properties/required/additionalProperties/description/title 时合并；允许 MCP 的空根 `properties`；拒绝指向组合分支的 `$ref`、开放分支、patternProperties、分支 `$defs`；冲突比较与键序无关，按 own-property 判断。
- 附带修复：pooling 夹具 transport 白名单补 `management.us-east-1.kiro.dev`（目录改用 management 域名后未同步）；`session-environment.test.ts` 断言改为对比发送层投影。
- 验证：kiro*/session-environment/web-read 506/506（`root-combinator-retest2.*`），tsc 0，构建 0（`root-combinator-build2.*`）；第九次重启 25547→30001 verified。
- **chat-live-03 通过**：经 Axiom WS 实际聊天链路，run completed、无 reasonCode，assistant 为 `kiro/claude-sonnet-5.5/kiro-chat`、stop、非空文本（`chat-live-03.json`）。默认模型已恢复为 `kiro.rs/claude-opus-5.5/xhigh`。
- 未覆盖：本次只发 1 条简单 prompt，未触发工具调用；全量测试套件未在最终改动后重跑。
- 另见：原生 Kiro Opus5.5 在一个长会话中 3 次 400 ValidationException/REQUEST_BODY_INVALID，尚未确认是否同因；用户成功的 Opus 请求走 kiro.rs。

## 边界及保留证据
- 企业目录与配置保存经过实际后台接口；第二次重启后post-restart-readback.json单次configuration.get亦确认Opus/Sonnet仍在列、DeepSeek保留、socketClosed；没有浏览器UI端到端验收。
- Sonnet5.5与DeepSeek现走Responses；其他Claude仍GAR/AWS eventstream。Responses须完整completed终态及一致快照，tool-end仅候选，宿主应等成功终态才执行。既有reasoning终态快照对账仍不完整；05虽然使用SDK兼容off入口，实际effort high，不称关闭思考或全协议对齐，也不忽略已知UA/profile生命周期差距。
- Opus仅添加，未授权本轮额外Opus推理测试。
- 目录case上限为生产原生循环20目录页、40profile页、1刷新，实际物理辅助数未观测；仅确认1次目录RPC。Sonnet另有逐物理请求预算。
- 初始只读preflight错误地把展示URL当显式Base URL而拒绝。核对model-service readConfiguration后改为检查原始配置baseUrl；保留preflight-display-url-oracle.json（目录RPC0），未改用户配置绕过门禁。
- catalog-01、add-models、sonnet-01/02/03/04/05、metadata与post-restart-readback claim均耗尽，禁止重跑。本轮Axiom Sonnet合计7次模型请求：前三次GAR403、第四次Responses400、05三次Responses200；每case profile1次200，04另正常刷新1次200；仅05执行一次受限代码工具。正常认证/缓存写回原存储允许，证据不保存token/profile/配置/未知错误原文。

## Opus5.5 登录调用修复（chat-live-04）
- 失败原因：精确 `claude-opus-5.5` 仍走 GAR（KIRO_CLI origin，runtime.*.kiro.dev），返回 403 AccessDeniedException。Sonnet5.5 迁移之前也是同样症状。
- 目录（catalog-metadata-02，0 次推理）：thinking.type 只有 `adaptive`，output_config.effort 为 low–max，默认 `medium`。
- 修改：usesKiroResponses 加入精确 `claude-opus-5.5`。新增 kiroResponsesClaudeDefaultEffort（Sonnet 为 high，Opus 为 medium），thinking 为 off 或缺省时使用目录默认值。近似 ID 仍走 GAR。
- 验证：kiro*、session-environment、web-read 共 506/506 通过（opus-responses-tests.log），tsc 0，build 0。第十次重启 30001→33620 verified。
- chat-live-04：通过 Axiom WS 实际链路调用 kiro/claude-opus-5.5/xhigh，run completed，响应以 response.completed 终止，最终文本非空。全局默认已恢复为 kiro.rs/opus/xhigh。
- 参考（kiro.rs，用户本地代理）：用 IDE 端点 `q.us-east-1.amazonaws.com/generateAssistantResponse`，origin AI_EDITOR，agent-mode vibe，Opus5.5 近 400 条记录中 394 条成功。Axiom 不采用该身份，仅记为 GAR 403 的差异线索。

## Opus5.5 high 间歇性 unknown-event（chat-live-05 到 09）
- 更正：chat-live-04 只验证了 xhigh 下的一条短回复。用户在 UI 上用 kiro/opus/high 失败了两次（run 125d80da、4592eb29），诊断都是 stage stream，status 200，protocolCode `unknown-event`，即 Responses 流中出现了白名单外的事件类型。
- 可观测性：`KiroResponsesError` 增加了 `eventType` 字段，kiro-failure 诊断会附带该字段。事件名先用正则 `^[a-z0-9_.]{1,80}$` 过滤，不匹配则记为 `unsafe`，不记录载荷。测试 506/506（opus-eventtype-tests.log）。全量 build 被 `ModelAccountUsage.tsx` 拦下，这个文件是其他会话在改的前端代码，不属于本次改动。服务端单独构建 exit 0（opus-eventtype-server-build.log）。第十二次重启 36568→37423 verified。
- chat-live-05 到 09：kiro/opus/high 跑了 5 次，5 次通过，未复现。DB 核对 run 与回复的 provider 都是 kiro/kiro-chat。UI 上显示 kiro RS 是因为测试结束时恢复默认值，顺带改写了会话的 selection。
- 状态：等待下一次自然复现，读取 eventType 后再按语义处理。未复现前不盲目放行未知事件。

## Opus5.5 high unknown-event 修复（chat-live-10、11）

- 复现：chat-live-10（kiro/claude-opus-5.5/high，“你好”）失败，诊断 `protocolCode=unknown-event`，`eventType=response.reasoning_part.added`（HTTP 200，stage stream）。
- 修复：`responses.ts` 新增 `response.reasoning_part.added/done` 处理。必须指向 reasoning 输出项；added 若携带非空 text 会以 `reasoning-part` 拒绝，不静默吞内容。思考正文仍由 `reasoning_text.delta` 产生。
- 测试：507/507（`opus-reasoning-part-tests.log`）；`tsc -p tsconfig.server.json` exit 0（全量 build 仍被他人并行前端 `ModelAccountUsage.tsx` 阻塞，未碰）。
- 部署：重启 `8v2cnr6i`（45296→45994）verified。45296 是他处启动、早于新 dist 的进程。
- 实测：chat-live-11（kiro/opus/high，“你好”）completed，两轮（toolUse 后 stop），provider 均为 kiro/kiro-chat。
- 默认值：改为在单独空会话里恢复为 kiro.rs/opus/xhigh，测试会话保持显示 kiro/opus/high。
- 限制：诊断只在失败时记录 eventType，无法确认 chat-live-11 本身是否出现了 reasoning_part 事件；该事件 part 的完整字段形状未捕获，夹具按 OpenAI 同类事件推测。

## reasoning_part 按 KAS 证据修正（chat-live-12）

- 静态证据：kiro-cli 2.35.1/2.36.0/2.37.0 都捆绑 KAS(@kiro/agent) 0.66.70，三版 `acp-server.js` SHA256 均为 `bf79b2b0…`。Responses SSE 解析在 `async function*JOo`（偏移约 8396929，3821 字节）。Rust 主程序里没有事件名明文。
- KAS 行为：
  - 只处理白名单事件，其余事件（含 `response.reasoning_part.*`、`content_part.*`）一律忽略，不读其 part 内容。
  - 思考文本只来自 `response.reasoning_text.delta` 和 `response.reasoning.delta`。
  - 控制事件 `kiro:keep_alive`（E2u）映射为 kiroKeepaliveEvent。
- 修正：
  - 删除上一版自行推测的 slot 校验和“added 带 text 即拒绝”。那是 KAS 没有的条件，可能造成误失败。
  - `reasoning_part.added/done` 和 `kiro:keep_alive` 加入忽略白名单。
  - `response.reasoning.delta` 按思考文本处理。
  - `safeEventType` 允许 `:`。
- 验证：
  - 测试 507/507（`kas-reasoning-part-tests.log`），server 构建 exit 0。
  - 重启 `s63lx47v`（45994→55604）verified，启动时刻 23:39:01 晚于 dist 生成时刻 23:38:37。
  - chat-live-12（kiro/opus/high，“你好”）completed，两轮 toolUse→stop。测试会话保持 kiro，全局默认已恢复为 kiro.rs/opus/xhigh。
- 仍有差异（未改，需决定）：
  - KAS 把未知事件静默忽略，我们对白名单外事件报错。
  - KAS 把 `response.incomplete` 按 reason 映射成正常终止（如 max_output_tokens→MAX_TOKENS），把 refusal 当正文展示，我们这两种都报错。
  - KAS 会从 reasoning 项的 `encrypted_content` 解出签名，我们没有处理。
- 未证：reasoning_part 的 part 字段形状未被捕获；chat-live-12 是否出现了该事件也无法确认，因为只在失败时记录事件名。

## Responses 解析与 KAS 0.66.70 统一（chat-live-13）

依据：kiro-cli 2.37.0 自带的 KAS `@kiro/agent` 0.66.70 `acp-server.js`（SHA256 bf79b2b0…），解析函数 `JOo`、`u()`、`T2u`、`MOo`。

| 差异 | KAS 做法 | 现在的实现 |
|---|---|---|
| 未知事件 | 直接 return | 忽略；`kiro-responses-completed` 诊断记录 `ignoredEventTypes`（经 safeEventType 过滤，最多 16 种）。坏 JSON 仍报错 |
| `response.incomplete`，或 completed 但 status 为 incomplete | 按 `incomplete_details.reason` 映射 stopReason，不释放工具 | `max_output_tokens` → `length`，Pi 让工具调用失败、不执行；`content_filter` 和未知 reason → `stop`，带工具则报错；`compaction_required_for_model_handoff` → overflow 失败，可压缩后重试 |
| `response.refusal.delta/done` | 当正文显示，done 只在没有 delta 时补 | 相同；message content 接受 `refusal` part |
| reasoning 的 `encrypted_content` | JSON 解出 `redactedContent` 或 `reasoningText.signature` | 相同，解不了就忽略 |

验证：
- 测试 592/592 通过（`kas-unify-tests.log`，包含 kiro*、session-environment、web-read、codebuddy*）。
- server build exit 0。
- 第十五次重启 `kb6om5zx`（55604→73621）verified。
- chat-live-13（kiro/opus/high，“你好”）completed，过程 toolUse→stop。诊断显示 `ignoredEventTypes: {response.reasoning_part.added:1, response.reasoning_part.done:1}`，确认走了新路径。
- 测试会话保持 kiro/opus/high，全局默认已恢复为 kiro.rs/opus/xhigh。

未证部分：
- incomplete、refusal、encrypted_content 在 live 中没有触发，事件形状按 KAS 代码推定，没有实际捕获。
- 请求侧回放历史思考（KAS `n2u`）仍和 KAS 不同，不在本次范围。
