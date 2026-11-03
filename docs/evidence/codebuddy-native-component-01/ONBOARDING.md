# CodeBuddy CLI 原生组件工作单

## 目标与授权

- 官方基准：`@tencent-ai/codebuddy-code@2.179.0`，macOS arm64，Node22.23.2；仅CLI，不调查WorkBuddy桌面。
- 交付：可复用无Pi原生核心 + Axiom/Pi1.4薄适配 + 固定DeepSeek的限定范围对齐。分列源码、构建/分发、独立SDK实测；本轮不部署或重启，不冒充UI已加载。
- 用户明确要求按 `cli-native-provider` Skill完成目的，并授权DeepSeek模型测试。本轮固定 `deepseek-v4.1-flash`、thinking off；当前Axiom静态表与2.179随包定义均有该准确ID，实发前另行锁定场景/预算/claim。不静默换模型，目录声明不等账号推理权限。
- 必须保留caller system/custom/history/tools/security，文本、多轮、工具往返、严格终态、取消/晚到、认证/账号隔离、唯一刷新owner、重试边界、真实sender/observer与分发。图片/reasoning/恢复及辅助请求分别报告，未经验证不外推。
- 不自动扩大为全模型/无限请求/隐私降低/TLS指纹伪装；不改全局默认、CA/代理或安装版；不复制CLI缓存/Keychain。旧Kiro及账号GET claim全部禁重用。
- 独立正常OAuth：复用现有CN授权/轮询/刷新协议；Pi正常存储锁继续唯一刷新owner。standalone使用已有NativeCredentialStore/account助手，不叠加两套刷新。
- 官方CLI对照可使用用户已授权的自身Axiom access临时注入，但不交出refresh、不写CLI凭据、不交互重登。完整CLI执行前仍需隔离/请求预算/自测合同；当前不直接运行help/TUI探路。

## 现成证据

- 官方安装/完整性：[安装报告](/Users/dane/.local/share/axiom-cli-artifacts/codebuddy-install-u0JnFK/REPORT.md)。包根 `/Users/dane/.local/share/codebuddy-cli/2.179.0/lib/node_modules/@tencent-ai/codebuddy-code`；原包SHA256 `c5b9070277d7ad9330edb70121b6b6aef35440aaab2592e26512b61fa6d89a03`。
- 已装主bundle `dist/codebuddy.js` SHA256 `677fa5d88dcea63223da5c525c7b48646dba80fd9f53f713e52d0d1dad003881`；版本快路径已验，不等完整runtime已验。
- [Token复用结果](../codebuddy-cli-auth-01/REPORT.md)：官方CODEBUDDY_AUTH_TOKEN入口静态证实；独立账号GET有效，0模型/0刷新/0CLI执行。custom-token不自动续期；当前有效性需运行时重核。
- 历史[协议审计](../../codebuddy-protocol-audit.md)与[联调](../../codebuddy-e2e-validation.md)可复用夹具和既有事实，但旧指纹2.173.0不能当2.179对齐。历史第36轮纯JSON失败保留。
- REA不需要且当前不可用，不例行setup；已安装可读JS/产品配置足够做定点分析。

## 执行路线与门禁

1. 已形成最小矩阵与35文件baseline（已有diff9394B保留）。官方主链10窗40950B+8窗32700B、UA/adapter6窗20100B+版本2窗4000B、目录6窗24550B+4窗16300B+1窗2000B均已关闭；只读且无CLI执行。默认UA版本绑定已闭环，最终Axios Node adapter默认分支已证。认证旧24窗不重查；目录Bearer与空repos默认URL序列化已闭合，尚未启用真实目录请求。
2. 提取独立OAuth/目录事实与能力映射；不把静态目录当账号权限。基于已有测试增加成功/错误/取消/并发/晚到覆盖。
3. 核心拥有构造、受保护头、固定CN目标、原生sender、SSE/工具状态机/usage/取消。首最短闭环不自动重试，官方外层重试与SDK maxRetries分别追证、实现归属或明确安全差异，绝不叠乘。
4. Pi只做消息/事件/schema/计价/认证交接；实际ModelRuntime/observer不偷换sender，兼容既有连接和caller hooks。
5. 离线合成/本地HTTP/真实SDK合成、构建、分发清单和无Pi plain runtime导入；测试期间不改被测源码。
6. 新合同锁定Flash/off、完整自有caller policy/history/tools、一次性claim和分层预算，先harness自测/指纹，再真实文本→工具回传→下一轮/取消限定闭环。无标题/summary/warming隐式调用，不改全局选模。
7. 按[协议矩阵](PROTOCOL-MATRIX.md)逐项报告匹配、差异、未知、验证层级，交付例子/API/限制；不拿HTTP200当全部请求或TLS等价。

C认证/目录核心完成：新增core codebuddy/{identity,auth,json,models,catalog}.ts，旧认证与模型表成为薄映射。目录GET固定CN/v3/config、Bearer、5s/close/无repo，配置按ID合并及白名单解析，账号RAM缓存/epoch/取消/晚到隔离；目录从不证明权限。动态Pi refreshModels及推理已在E接回工作树，最新接线尚待验证。认证/目录JSON请求仍注入fetch/global fetch，不冒充原生推理sender wire已验。

验证：JSON抽取后认证+runtime三文件13/13（[日志](auth-runtime-tests-02.log)）、目录8/8（[日志](catalog-tests-01.log)）；最新Pi模型映射后stream+runtime15/15（[日志](catalog-mapping-tests-01.log)），server tsc exit0（catalog-mapping-typecheck-01.log为空），目录三文件只读安全评审未发现确定问题。这是35个不同用例的分组覆盖，不是一次35项整轮，也不是native推理验收。runtime历史01～04失败保留，原因/修正为fixture继承执行账号环境、旧root凭据路径与直接logout假设；05及后续复验通过，生产OAuth未因此改协议。上述是C阶段历史验证，不外推为后续修改的最终回归。

D独立核心完成：新增http/request/sse/usage/failure/client六模块，Node HTTP(S)固定CN目标、UA、代理、无redirect/retry，严格UTF8/SSE/finish+DONE+EOF、所有工具JSON/schema且无coercion后才可交宿主审批。D当时12个client用例（[日志](native-client-tests-01.log)）、5个sender用例（[日志](native-http-tests-01.log)）、新增实际Node sender工具往返1项（[日志](native-roundtrip-test-01.log)）分组通过，共18不同项、不是一次整轮18。最新D类型检查exit0（native-typecheck-02.log空）。close/无池是保守策略，官方keepalive仍未知。

E完成：已接Pi薄适配/一次性RAM认证交接、动态RAM目录、配置路由/auth前置守卫、native sender observer、普通worker逻辑run身份；并加强core hook预算/采样/隐私守卫、env/config key目录过滤、配置错误脱敏和CodeBuddy专用session禁重放。最新[Pi三文件27/27](pi-integration-tests-04.log)、[真实Agent+原生Node本地链1/1](pi-native-sdk-tests-02.log)、[session retry14/14](pi-session-retry-tests-01.log)、server tsc03 exit0。core13+HTTP6在第二轮中通过；identity helper2项此前通过，均分层分组，不拼单次整轮。实际Agent验证4个本地请求（工具/结果/下一轮/取消），宿主工具执行/审批各1，observer归零；生产native fetch保留，仅最后socket目的地映射loopback，非TLS/外部服务证据。

明确保守边界：显式cacheRetention无已证映射则拒绝；强制constrained sampling/grammar、不可保真签名或namespace拒绝；纯文本length目前为错误而非成功截断；失败assistant含未确认tool候选的历史拒绝重放，不靠删历史制造恢复。完整官方extra_vars/providerData/cache_retention/辅助purpose未知。身份已编码不等worker实跑；源码不等常驻服务加载。

修复记录保留：旧stream首轮14/15仅named-error分类断言不匹配；集成第二轮42/43仅API fixture未真正覆盖model，修后单项及最新27项通过；真实Agent首轮发现默认transport=auto误拒，已允许auto走SSE并复验。websocket仍拒绝。CodeBuddy session自动retry禁用，不修改其他provider或独立summary retry；overflow自动压缩也属另一层，不声称全应用零继续。

公共组件与分发完成：core12模块及public index，见[独立使用说明](../../codebuddy-native-component.md)。[公共组件三文件15/15](component-public-tests-01.log)、[类型修正后六文件48/48](component-regression-tests-02.log)、[完整前后端构建exit0](component-build-02.log)。首build01的15项测试类型错误保留，修正未改生产语义/全局lib；前端仅chunk体积警告。[分发核验exit0](distribution-verification-01.json)：33个组件emit、77条相对边、0宿主依赖，1055项npm-packlist候选包含全部模块；隔离复制5个代理依赖后，plain Node实际emit入口完成合成auth3/catalog1/model3/tool1、logout/dispose，Pi未安装。未运行npm pack生命周期、生成tarball或测全安装流程。

当前0新增外部模型/认证/目录请求（有合成及loopback HTTP），已构建但0部署/重启。下一建立新的Flash/off限定实发合同、import-safe自测及一次claim。主代理改代码，测试期间只做文档/只读工作。
