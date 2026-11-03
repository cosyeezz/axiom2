# 快速接入与症状驱动排障

本页是决策索引，不替代具体供应商契约。先选一条路线，打开相关参考，不每次全读全部历史。八条[首要准则](../SKILL.md)和当前授权始终有效。

## 1. 新接入的最短纵向闭环

1. **复用而非重开研究**：填[工作单](../templates/ONBOARDING.md)，固定目标产品/版本/认证模式/一个精确模型/一个 SDK。查已有官方代码、bundle、capture；已有证据够用就实现，不先启动 REA doctor、全包 AST/native 分析。
2. **列最小协议地图**：auth→profile/catalog→serializer→sender→parser/terminal。每条边写一处来源；缺口一次只追一个。字符串/字段定义不能代替 caller 实际填值或选路条件。
3. **先无网核心**：合成认证与目录状态机；请求保真、真实工具集序列化、合法文本/工具终态、坏帧/取消负例。协议不明不能先借通用 OpenAI SDK“跑通”。
4. **本地 HTTP 验 sender**：核补头、UTF-8 bytes、proxy/redirect、慢流、取消；用 plain runtime 公共入口做文本→工具结果→下一轮，不只 import 成功。
5. **实际 SDK 验接线**：真实注册、账号路由、hooks/observer、完整 system/history/tools；禁通用 Fetch 偷换 sender，测真实宿主工具集合而非只有 read。原生层不执行工具，宿主仍审批并用原 schema 校验。
6. **最后有界真实验收**：有新问题且获授权才建新合同/claim。依次文本、工具闭环、下一轮，再按所选范围扩图片/思考/取消；官方 baseline 条件有效就复用。必要部署是另外一层，不能拿独立 SDK 成功替 UI 打勾。

交付先完成一条真实能力链，不以覆盖所有模型或完整客户端为前置。模型/账号/隐私不可静默变更；不支持或未知能力明确列出。

## 2. 旧排障先定层，不先重发

| 症状 | 最短检查与下一动作 | 不能直接做的判断 |
|---|---|---|
| 授权页一直加载 | 核现有页是否当前流程、首个失败/pending XHR、浏览器与后台代理差异；只投影 host/path/参数名/状态 | AWS logo 不等 scopes 错；不改成通用 `scope`、刷新重登来探路 |
| 登录成功但目录/聊天 400/403 | 核正常账号模式/active binding、真实 profile/region、该操作的 endpoint/target/schema；对照同身份 CLI | 不判定全部企业账号不支持、不伪造 ARN、不借他人 token |
| 聊天能用但目录失败 | 分别画两条 profile/auth/transport 路径；核旧目录契约是否过期，required/default 字段是否误强制 | 聊天 profile 缓存不等目录也消费；不能只换域名 |
| 拉取显示成功但仍旧目录 | 核本次 generation/网络发布与账号代际，全分页是否完成、取消/轮转是否发布半份 | 旧 cache 可展示不等 refresh 成功；不静态补模型 |
| HTTP200 后未知事件/工具未执行 | 先看 phase、安全 event type/protocol code；查同版本 CLI bundle 的 parser 和终态映射，造最小流夹具 | 不把未知事件全拒绝或全放行；不把 terminal mismatch 当网络截断 |
| 文本通过但工具失败 | 核真实工具 schema→工具片段→call ID→合法终态→宿主 validator→result 回传各层 | 一个 read 测试不覆盖全工具/MCP；tool-end 不等可以执行 |
| 本地 schema 拒绝 / 远端 tools 400 | 分开根 object 声明、远端支持关键字和本地 union 约束；仅有证据的 wire 投影，原 schema 执行前仍严格校验 | 不删工具、不扁平化任意 union、不放宽宿主校验 |
| UA 已对但仍有 Fetch 补头/HTTP2 | 查实际 SDK wrapper/observer 是否替换 sender；本地真实注册路径禁 generic Fetch 复现 | 不归因 Pi 本体；不反复只改 UA/headers 对象 |
| off 仍有思考 / effort 400 | 核模型 schema 的 enum/default/required、缺省/own undefined/显式 off 和实际 provider level | 不把 off 显示当服务关闭；effort 不等 token budget，不降档取绿 |
| 工具后或下一轮失败/思考泄漏 | 核 call/result、continuation 生命周期、历史 opaque/reasoning 和实际回放 | 不把思考塞普通答案、不伪造签名或工具结果 |
| 429/5xx、截断后重复请求 | 分清 pre-response、已有 text/thought/tool 进展、SDK retry 与 overflow/compaction；核真正发送次数 | 单次 provider send 不等整个 session 单次；不要靠文案骗正则 |
| 停止后仍占资源/晚发请求 | 查 acquisition/reader/cancel owner、signal/epoch、settle 与迟到 Response；caller 退出和底层停止分开 | Promise.race 返回不等释放锁，cancel 调用不等 cleanup 完成 |
| 代理无新增 HTTP flow | 查启动、变量继承、NO_PROXY、目标 runtime CA、旁路和窗口；先无模型 preflight | 不证 CLI 没联网，也不能直接断言登录/证书失败 |
| 单测/独立进程通过，UI 仍失败 | 核完整工具/上下文/思考档位、配置默认副作用、产物和服务实际加载 | 不将 core、SDK、部署、UI 四层混为一谈 |
| 测试莫名找不到账号/模块/fixture | 核 cwd、安装版 ESM exports/loader、继承执行绑定和fixture路由白名单 | 不先改用户登录/产品；runner失败不当Provider失败 |
| 发布后缺公共 API | 从分发物查 index/factory/account 发射与依赖闭包，plain runtime 导入公开入口 | 仓库内部 import 成功不等 package 可复用 |
| 想靠 warming/pool 提速 | 先核实际 sender/连接策略、参数是否真限制输出、是否另发付费请求 | maxTokens 被忽略就不能用 maxTokens:1 预热；旧 Fetch pool 测试不证新 sender |

细节按问题读：[协议](protocol-reconstruction.md)、[架构](provider-architecture.md)、[验证](verification.md)、[抓包](capture-comparison.md)、[REA](rea-workflow.md)。版本化因果与边界见[Kiro 教训](kiro-lessons.md)。

## 3. 一次失败应留下足够诊断，不留下原文

执行前就准备固定 phase、HTTP status、已知错误 code/category、protocol code、安全 event type、partial/progress、terminal reason、实际 model/effort 匹配谓词和请求分类计数。不要等未知流失败多次才加事件名。

- type 等外部名称按如 `^[a-z0-9_.:]{1,80}$` 过滤，不符写 `unsafe`；类别/事件数量有上限。错误 body 只在 RAM 内用封闭白名单投影，解析失败/超限/超时另记，不能回显 unknown message。
- 成功路径也留有界分支计数/固定映射结果，证明修复分支实际命中；只在失败记录 type 无法证明修后命中。
- 复现先用用户**精确 provider/model/thinking/input**。简化 prompt 或相近档位通过不关闭原问题；间歇问题一次成功仍保留未证。
- 不保存的原响应无法事后恢复。先复用既有 CLI 日志/capture，仅投影可关联字段；仍缺证据就标 unknown，不凭状态或参考项目示例编造本次 message。
- 原因分开：实现缺陷、harness/oracle 错、工具/环境故障、服务/账号结果。先修可离线解决项，不重复消耗 live。

## 4. 高收益的复用与停止规则

- **证据复用键**：产品/launcher/runtime/bundle digest、平台、认证模式、精确模型与feature条件、观察层、caller范围。内容相同可复用该局部静态证据；不据相同 KAS 推出整个 CLI 的配置/auth/wire 一样。
- **一问一定位**：seed→有界窗→必要 caller/callee→夹具；source充分不用REA，retained结果分页不重跑producer。当前文件换路径先核相同公开 digest，不直接宣布源码丢失或下载/重做全部分析。
- **观测优先于大设施**：已有日志/flow优先；需要抓HTTP可另授权局部MITM，不无界扩成全进程树、注入平台或完整反编译。调查预算到达后明确尚缺哪条边与替代路线。
- **测试复用**：未变通过层沿用，改动后重验影响闭包；失败/oracle修正留原件，不把复跑数量叠加。只读审查/独立测试可并行，共享源码/账号/端口/代理须协调。
- **共享构建防漂移**：验证与实发绑定同一源码/依赖/产物；必要用独占快照，claim仍唯一留正式证据目录，不随快照复制成新预算。快照成功不等常驻服务加载。
- **部署先读回**：核当前 PID/启动时刻、关键产物含修复；不沿用历史 PID。别人构建/UI改动不擅改，server-only 或局部构建通过就报告实际范围。
- **配置恢复分时机**：starting 时不改测试 selection；等目标 run/Agent settled，再用单独空会话恢复全局默认，核测试 selection/全局偏好。未知 receipt 先读回不重复发送。

结束本轮只需所选目标的必要验收，不能以技能整理/审计数完成冒充Provider完成，也不能为“更放心”重跑已充分验证的场景。
