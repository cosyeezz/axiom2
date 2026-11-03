# Kiro 原生请求对齐：进度与新会话交接

## 真实交付状态

**正式实发配对 0；基于实发差异的修复 0；一致性结论未形成。** 本会话没有修改生产provider，没有完成用户要的请求构造、认证、实际发送对照。已做的源码核查和自有夹具验证只能复用为准备，不能包装成核心交付。用户已两次追问进度，主承认路线失控；不能再扩大静态审计代替真实样本。

用户最新要求“交付进度，我们新开会话执行”。因此本会话只完成交接，不启动新实验。原目标没有取消或完成；下个会话继续原授权范围，不恢复失败/放弃分支。压缩维护指令不改变此交接安排。

## 目标与边界

权威规格：[请求一致性基线](kiro-macos-request-baseline.md)。固定 **kiro / deepseek-3.2**，Axiom/Pi正常独立登录、原生直连；官方CLI仅作对照端，不能替Axiom代发或复制CLI凭据。

只核对请求构造、认证、实际发送及影响它们的执行链。不复刻压缩、存储、内部调度，不研究完整不可逃进程树。system/custom/history/tools/security保留为输入和payload，不能删掉、排序或归一化制造一致。模型不可用就报告，不静默换模。动态token/ID不要求字面同，但须核格式、scope和关联使用规则。

## 当前唯一推进位置

原任务树：建立官方受控基线 → 核定最短采集路径 → 设计单次请求配对 → 核定正式配对门禁 → **设计自然观察入口**。接续路径各步骤保留原生命周期状态；总目标因用户明确要求转新会话执行，暂记Waiting，恢复条件是新会话的继续请求，不是技术/登录阻塞。当前没有后台仍在推进；不能只凭记忆自行恢复。新会话获得继续请求后再恢复总目标In progress。同级“复核Axiom原生入口”只是限定源码问题Completed，不能恢复其已完成研究扩范围。单模型边界仍有运行未知；“采集官方实发请求”仍Not started。修复/多场景仍Waiting，依赖有效实发差异。

本会话[主记忆](/Users/dane/.axiom/memory/6bb92b30-1036-462f-8ab7-5b1505b466b6/MEMORY.md)及[自然入口详情](/Users/dane/.axiom/memory/6bb92b30-1036-462f-8ab7-5b1505b466b6/details/Kiro Mac原生请求对齐/建立官方受控基线/核定最短采集路径/设计单次请求配对/核定正式配对门禁/设计自然观察入口.md)为完整历史索引；不要按旧段落里的“下一步”恢复结束尝试。

## 已定位、可直接复用的证据

### 官方身份与模型调用风险

- 最近绑定官方2.36.0/build20261029.233307，Team94KV3E626L。当前三public KAS成员已与完整可取归档逐byte绑定，见[成员报告](evidence/kiro-macos-native-02/current-kas-member-01/SUMMARY.md)。仅三成员，不是整archive/native自然使用/环境继承证明；旧2.35.x地址不能用于当前产物。
- 当前KAS acp-server.js为15025207B，SHA `bf79b2b0fa7ae68653abdf117b4a4dbf064fec6fa7ca49500115f3f2f67581b1`。已提取public源只能静态读取，不得执行它冒充官方发送。
- [模型执行窗口](evidence/kiro-macos-native-02/current-model-execution-01/SUMMARY.md)和[直接依赖窗口](evidence/kiro-macos-native-02/current-model-follow-01/SUMMARY.md)已结束：title有`KIRO_DISABLE_SESSION_TITLE_LLM === "true"` guard，selector为`simple-task`，存在首次prompt caller；Tte trim后只认小写true/false。
- **仍未知**：实际env继承、feature registry优先级、fallback caller是否先检查isEnabled、title底层模型和与主请求的次序。FIi.resolveTarget自身不检查isEnabled。因此不能把设false当作已证禁用，也不能认定首candidate就是deepseek主请求。

### Axiom完整输入入口

[当前源码报告](evidence/kiro-macos-native-02/axiom-input-current-01/FINDINGS.md)已保存读取范围与修正；[11文件源码快照绑定](evidence/kiro-macos-native-02/axiom-input-current-01/SOURCE-BINDING.json)保全267426B公开代码。只是阅读后的非原子源码快照，不是实际加载证明；不覆盖后读execution-profile/pool/protocol。

- 完整context仍由私有worker.run：normal网络 → ModelService.runtime → settings/resources/权限/context hooks → createAgentSession → Axiom hooks/extensions/main tools → session.prompt。没有已核可直接用的first-request-only参数；executionGate只准入，prompt是整轮。不能用user-only provider调用冒称完整worker。
- Kiro runtime的native/composed目录隔离、getAuth API断言、每物理请求丢旧handoff并正常取OAuth仍须保留；不能手造ticket/virtual model/fallback。实际模型可用性尚未验证。
- 正常accountBindings在execution profile存在时用validated snapshot，否则读正常active index/legacy默认；不直接打开账号内容。独立runtime当时active不自动等于host冻结账号。
- 正常configureModelNetwork位于integrations/model-proxy-env.ts，保留正常代理、dispatcher与undici.install。kiro-chat仍完整payload/onPayload后profile/model/origin guard，再正常Bearer/fetch POST。
- worker的model-request事件先于auth，统计fetch start不是wire/receipt；profile discovery不算该统计里的推理。host还调用titles.start，不能把worker首请求与整个UI所有调用混同。

### 首窗口和RAM配对

[窗口报告](evidence/kiro-macos-native-02/request-pair-design-01/WINDOW-OWN-VALIDATION.md)与[设计](evidence/kiro-macos-native-02/request-pair-design-01/NATURAL-WINDOW-DESIGN.md)已有有限own验证。旧代码未改，不重跑已通过矩阵。

- first_request_window.cjs同步安装两adapter，连接ready前RAM保序，首candidate后microtask关闭；没有自动preload、role/source验证或正式runner。
- private_pair/private_sender只传有界RAM候选；不落rawheader/body/token/context hash。H1诊断头缺后补framing，H2文本不是HPACK/wire；server rawHeaders也不是wire bytes。
- **done/closed/broker成功不是owner终态**，晚调用可使stickyfault变坏，旧done不更新；own socket可能延后退出。首窗口之后的retry/fallback/tool-loop不覆盖，不能宣称整应用只调用一次。
- private_pair报告的auth scope仍硬编码unknown，多个proof为false；候选配对不能被重标为实发/认证一致。

## 最新具体发现：不要误用启动助手

完整事实见[自然入口接续决策](evidence/kiro-macos-native-02/request-pair-design-01/NATURAL-ENTRY-DECISIONS.md)。本轮已读execution-protocol全文、execution-pool仅1–260、execution-profile全文、agents735–799、runs565–624，未import或启动它们。

1. **不能独立new ExecutionProfiles(正在使用的真实root)**。constructor会清除root/execution-models中匹配的快照，依赖Store service lock；独立观察器没有该锁。换空root又改变root/pi资源，不能冒称normal完整context。不要为绕过它修改生产逻辑。
2. 源码模式正常workerPath是agent-worker.ts、execArgv为--import tsx；pool继承PreparedEnvironment env并加instance/generation/profile，stdio前三ignore、第四ipc，Mac detached。
3. 正常host prepareAsync→pool.acquire(bindingGate)→复核→commit。实际发送是child.send({type:'start',input,lease},callback)，返回bool只是背压，callback错误也不证明未送达。
4. execution-protocol无workerInstance时允许legacy IPC，但required executionGate要求lease和instance。这只是现存兼容分支，不是已验证的正常host替代品；新caller不得继承本会话instance/lease冒用所有权。正常host入口或明确范围的完整worker兼容入口尚未选定。
5. 已全文读body_pair.cjs：currentModelId只比较两侧存在性和相等性，**不能证明该值就是deepseek-3.2**。固定schema只返回布尔/unknown，不返回原值。可以考虑在仍持有raw候选的受控RAM位置，复用compareRequestBodies与公开目标模型参考对象比较该字段；这是未实现/未测试的下一实现选项，不要重写parser或修改input制造一致。

## 新会话下一步（有限，不再铺开）

1. 读取本交接、最新任务树和上述接续决策；确认当前公开产物/代码是否仍匹配。版本变了就按新条件绑定，不能复跑旧门禁或套旧native地址。
2. **落实一个最小正式runner合同**：选定不会清理现有数据的完整worker入口；明确完整同一受控输入、精确模型检查、正常opaque账号与代理、自然preload及来源、独立deadline/次数上限、固定secret-safe输出。不要再追完整pool/配置/后代闭包。
3. 只实现阻挡该runner的必要缺口：目前没有自然preload/正式caller，现有pair也没有目标模型字面验证、认证scope或实际出站关联证据。受影响的新代码做必要own验证，旧未改PASS沿用。
4. 条件满足才做新case真实对照；不补runtime01 prompt仅找hook，不执行提取bundle，不用已知失败目录重跑。明确分开首候选构造、实际出站、服务器接收；有真实差异再改生产provider。

若不能完成某条，要报告具体缺口和恢复条件，而不是拿新测试数量当交付或无限增加门禁。目前没有已确认必须用户重登/截图/改授权的外部阻塞。

## 禁止恢复与隐私约束

- runtime01无INPUT、static01/anchor01扫描、旧Snapshot失败、dyld_info安装请求、M3/coalition/launchd/目录caller等结束或放弃分支不恢复；不增cap补绿。不要import有顶层执行的旧driver。
- 当前model-execution/follow与source-capture等CreateNew门禁已耗尽；只读原件复用，不重启。自有HTTP验证不是正式模型样本。
- 不关SIP、不重签官方、不改全局CA/代理/防火墙，不扫无关进程，不改真实engine/agent配置，不重启部署分支。
- agent不直接打开/复制authstore、Keychain secret、真实TLS keys。正常程序opaque使用凭据另论；未知stdout/error/stack/argv/env/path/query/body/claims不落盘或hash。只保存固定投影，不把raw数据包装为REDACTED后称原值相等。
- 不把process group当完整后代保证；direct-child退出、双EOF、capture.complete、HTTP200、相同答案各自只作有限证据。
- 保留所有他人工作树改动。此前仓库已有大量UI/server/worker/runtime/service等改动；本会话仅evidence/docs/记忆，不reset/clean、不冒领生产改动。

## 后台与交接状态

没有已知仍在推进的后台任务、测试或own runner，本会话无活动REA目标记录，无待消费结果；这不是机器上没有历史未知后代的证明。t12088/r12089、t12094/r12095的OpenAI缺APIkey委派失败已消费，不是Kiro认证失败，不重启任务或修改登录。其实际执行计数unknown，不能回填0。

本交接可完成不等原请求对齐目标完成。继续执行前先看当前文件/条件，不能把本报告当新的操作授权。
