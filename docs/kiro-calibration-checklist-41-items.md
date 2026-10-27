# Kiro 接入逐项校准清单

核对日期：2026-10-26。当前源码 HEAD：`f9e68b140d20edb79ece463c1632c51ca9d7afc8`，包含已有工作区修改；Pi 安装版本：1.1.0。

> **这是静态核对与修复方案，不是“全部校准通过”。** 用户报告 Kiro 已经 auth 登录、有模型，但目前无法使用。该现象尚未取得脱敏报错或复现，不能据此判断根因。当前不改接入、不运行测试/构建、CLI/REA、登录、刷新、目录请求或模型对话，不读取真实凭据、登录缓存、用户模型配置、会话和含秘密日志。现有登录态留待后续明确验收阶段使用。

## 目标与边界

- **保留 Axiom/Pi 的 agent 循环、工具执行、权限和子任务。** Kiro 仅作为 provider；不采用官方 CLI/ACP runtime，也不安排 MCP 绕接。用户已否决该路线，反馈此前试过且工具调用有问题；该反馈不是当前原生 provider 的复现证据。
- 校准登录、调用鉴权、协议、工具、图像、思考、响应、重试与宿主接线；记录每项修法和验收方式，不提前实施。
- 其他模型保持现有路径。不能为模拟 Kiro 改全局工具集、削弱验证、伪造官方身份或绕过代理失败保护。
- 静态证据按版本分层：当前 macOS CLI 2.33.1 chat 的局部 REA 证据、同版 launcher、历史 SDK/Windows 2.12、公开文档及第三方兼容策略不能混用。CLI 完整调用链仍未闭合，不保证云端绝对不可区分。

## 更新核对结果

1. 与上一轮 `review-verification.json` 保存的实际文件 SHA256 比较：**15/15 相同**，含九个 Kiro provider 文件、Pi OAuth resolver/retry/overflow/agent-session、Axiom agent-worker 和 kiro-chat 测试定义。因此不能认为其他更新已修复此前 Kiro 待办。
2. 旧 HEAD `44c3e52e6cf7f919842728d73a5aa7f16a45a7a5` 到当前工作树，最初限定的provider/worker范围之外，还确认了 **agents与任务调度的准入更新（K41）**：scheduler任务有新的请求前FIFO入池顺序，普通主会话不传该turn。model-service另有Qoder说明变更，app/package.json增加另一测试命令但未执行。15个旧hash未覆盖的文件只能作提交到当前工作树diff，不能称旧dirty内容逐字未变。
3. 重新核对注册、选择、目录恢复、worker 及网络接线，未发现正常 Kiro 原生路径必须落入通用 OpenAI provider 的证据；仍有多个明确的调用前阻断条件。
4. **登录成功、目录可读、模型出现在选择器、推理成功是四个不同关口。** 本轮未读取用户实际配置、代理状态、选模或报错，尚不知道失败在哪一关。

## 状态怎么读

下面每项均已做源码/文档静态核对；状态表示**下一步处置**，不是执行进度：

- **保留**：机制已存在，暂不为对齐而改掉；仍须执行相关验收。
- **待修**：确认的信息损失、可靠性问题或需要补齐的诊断/恢复措施；修复尚未执行。
- **待证**：本地策略或覆盖差异已知，但官方 caller/响应契约不足；先取证，不猜字段。
- **待验**：有静态路径或明确边界，但实际产物、配置、运行结果未知。

优先级：P0 为当前“不可用”的定位关口，不等于已经确定故障原因；P1 为可靠性/安全和核心接入；P2 为进一步覆盖、表现与性能。**所有表格中的验收均为待执行。**

## A. 更新、选择、认证与网络

| 编号 | 校准项与证据 | 静态核对结论/状态 | 如何修复或保持（未执行） | 验收条件（未执行） |
| --- | --- | --- | --- | --- |
| K01 | 源码与更新基线 | **保留 / P1**：15个保存过hash的文件没有变化；其他模块更新不能当作Kiro修复 | 保存本轮源hash、依赖版本及受检范围；后续只重核受改动影响的检查 | 修复前后可定位文件差异；未改文件的历史结论不冒充新测试结果 |
| K02 | 当前运行产物 [worker](../app/src/server/agent-worker.ts#L641) | **待验 / P0**：仓库代码不证明用户当前运行的安装包/worker就是该版本 | 后续只采集应用版本、构建标识、provider API等脱敏元数据；确认源码与运行产物对应，不先要求重新登录 | Axiom前端、服务端与worker版本对应；能识别旧进程/旧包，不输出路径中的账号信息或秘密 |
| K03 | 可选模型与实际选择 [models](../app/src/server/models.ts#L36)、[agents](../app/src/server/agents.ts#L487) | **待验 / P0**：白名单、原生目录、凭据/provider过滤、ID与thinking等级共同决定准入；provider-only配置不一定要手工添加模型 | 给模型不存在、级别不符等分别提示；明确配置模型/目录模型/实际选中模型，禁止自动换模型 | 冷启动/重开、仅provider配置、显式模型/override、失效ID/等级各有明确结果；用户当前选择待后续脱敏确认 |
| K04 | 原生注册与分发 [runtime](../app/src/server/model-runtime.ts#L31)、[provider](../app/src/server/providers/kiro.ts#L15) | **保留 / P0**：配置或已存凭据触发Kiro注册；getAuth前检查kiro-chat，正常路径有原生stream，不应退通用OpenAI | 保留原生注册、API保护及同实例ticket接线；回归不能只测裸OAuth | 模型只进Kiro原生stream；API override被明确拒绝；其他provider注册和stream不变 |
| K05 | 旧协议与Base URL [protocol](../app/src/server/providers/kiro-chat-protocol.ts#L15)、[目录入口](../app/src/server/model-service.ts#L439) | **待修 / P0**：旧API、自定义Base URL会拒绝；目录入口拒绝任何显式Base URL，chat仅容许空或列明q服务地址作为模型元数据 | 增加调用前诊断和显式迁移说明；迁移保留真实modelId、账号与代理，不能盲删配置或自动转OpenAI | 旧API/错误地址在发请求前指出；合法空值/列明地址分别按入口规则处理；无任意域发Bearer |
| K06 | 目录提示不等推理能力 [提示](../app/src/server/model-service.ts#L495) | **待修 / P1**：当前提示“添加后可使用原生文本聊天与工具调用”比目录实证更强，虽另有权限免责声明 | 改为“已取到目录，推理/工具待验证”；区分账号权限、服务能力、适配器声明及缓存 | 拉目录不显示已通过推理/工具验收；零价格不表示免费；无模型不静默填静态ID |
| K07 | 代理、直连与连接池 [network](../app/src/server/integrations/model-proxy-env.ts#L44) | **保留 / P0**：内置代理失效fail-closed；选择器检查失败可能保留模型，worker仍会拒绝；仅Kiro有60s/120s池参数 | 保留不退直连及worker级网络隔离；补分层提示，勿把keep-alive当请求/idle期限或官方指纹 | 代理停机/失效端口明确拒绝；直连与代理分别验证；其他模型池参数和工具环境不被Kiro改变 |
| K08 | 登录方式分流 [auth](../app/src/server/providers/kiro-auth.ts#L125) | **保留 / P1**：Builder/企业OIDC与Social Portal分流，PKCE/device、scope、轮询及刷新路径已有实现 | 保持state/verifier、loopback、scope与slow_down保护，不重做登录来代替推理排障 | 各登录分支、取消/到期、拒绝、慢轮询与注册过期用例通过；真实账号当前登录不在本轮复验 |
| K09 | 手动回调容错 [callback](../app/src/server/providers/kiro-callback.ts#L94) | **待修 / P1**：手动URL解析失败会终止Promise.race；网络回调的普通格式/state/Host错误不消耗登录，但经校验的拒绝或错误登录分支会终止 | 非终止URL/state输入错误允许重填；成功、明确拒绝、取消或到期才关闭；不放宽state/Host/分支校验 | 手动错后正确、与浏览器并发、取消关闭监听、重复参数/错Host仍拒绝 |
| K10 | 认证响应上限 [auth request](../app/src/server/providers/kiro-auth.ts#L94) | **待修 / P1**：30s期限存在，但直接response.json没有响应字节上限 | 有界流读取与Content-Length预检；超限取消、慢体期限、脱敏错误；不记录完整响应 | 超大声明/分块、非法JSON、慢体、取消与迟到响应回收；不会保留不完整凭据 |
| K11 | 提前刷新与持久化 [Pi resolver](../app/node_modules/@earendil-works/pi-ai/dist/auth/resolve.js#L46) | **保留 / P1**：至少提前5分钟触发刷新，锁内二检并保存；已启动刷新另受15s期限且不随调用方取消丢轮转结果 | 保留机制；5分钟是触发窗口，不是刷新后保证剩余5分钟；补实际store竞争覆盖，不直接改node_modules | 已有内存store并发定义外，再覆盖跨进程、登录/退出、取消轮转及完整宿主链；检查实际持久化和锁效果 |
| K12 | 一次性ticket与Bearer [chat auth](../app/src/server/providers/kiro-chat.ts#L30) | **保留 / P0**：60s、一次性、实例隔离、最多256项，交接表不存真实refresh/clientSecret；只有access随Bearer发出 | 保留opaque交接，不将ticket当上游token；每次调用按原生路径解析，不跨provider实例复用 | 六并发仅刷新一次/不同ticket的已有定义需执行；另测重用/超时/跨实例/并发压力；61s过期现有子用例是直接chat，不是完整provider链 |
| K13 | profile响应归一化与保存校验 [auth metadata](../app/src/server/providers/kiro-auth.ts#L57)、[使用校验](../app/src/server/providers/kiro-catalog.ts#L17) | **待证 / P0**：auth仅按通用字符串规则收profile，使用前另校验ARN/区域；refresh响应缺字段保留旧值，显式null/空串拒绝；同版launcher旁证非空更新否则保留；未证用户命中 | 先确认空值契约，再统一保存/使用校验及诊断；无新值时保留合法旧值，不接受非法ARN或跨账号替代 | 缺失/null/空串/非法ARN/不支持区域/注册过期矩阵；保存成功不得被误解为推理资格已通过 |
| K14 | 服务区域与profile [region](../app/src/server/providers/kiro-catalog.ts#L30) | **保留 / P1**：按profile选美东/法兰克福，无profile默认美东；不直接用SSO认证区推断服务区 | 保留明确映射和不跨区/跨profile重试；需要更多区域先取得支持证据，不猜hostname | 认证区不同于服务区、美欧profile、无profile和非法区域；请求不静默改profile/模型 |
| K15 | 缓存scope与轮转 [catalog restore](../app/src/server/providers/kiro.ts#L21) | **待修 / P0**：缓存v1/v2需scope匹配；scope含refresh相关身份，轮转/账号变化可能使旧缓存失配而无可用模型 | 保持隔离，增加缓存失配原因和受控目录刷新入口；不能放宽scope、恢复别的账号目录或要求盲目重登 | 冷启动/重开、轮转、退出/换号、缺失/损坏缓存、取消发布；区分缓存可见和本次真实刷新 |

## B. 请求、工具与多模态

| 编号 | 校准项与证据 | 静态核对结论/状态 | 如何修复或保持（未执行） | 验收条件（未执行） |
| --- | --- | --- | --- | --- |
| K16 | 最终endpoint/方法/target [chat request](../app/src/server/providers/kiro-chat.ts#L130) | **待证 / P1**：当前固定runtime POST/EventStream，目录q域AWS JSON；2.33.1局部证据只闭合部分字段，非完整发送链 | 固定版本取得脱敏caller/最终wire基线；models future操作身份不是HTTP target，不能拿它直接改目录target | 区域/profile/modelId/路径/target/Accept/Content-Type逐项对照；确认哪些是当前官方、哪些为历史旁证 |
| K17 | UA、SDK头与ID生命周期 [chat headers](../app/src/server/providers/kiro-chat.ts#L131)、[catalog headers](../app/src/server/providers/kiro-catalog.ts#L140) | **待证 / P1**：Axiom chat/catalog UA、注册clientName明确；invocation UUID和attempt=1为实现事实，官方完整头未知 | 先取证，不仅换UA宣称全等；随机值比生成规则与生命周期，不复制令牌/固定ID，不猜设备号或TLS校验 | 登录/刷新/目录/推理分别有脱敏头基线；额外自动头/传输观察面注明未验证 |
| K18 | 受保护头、hook、隐私与凭据域 [hook checks](../app/src/server/providers/kiro-chat.ts#L121) | **保留 / P1**：限制auth/协议头覆盖，profile/model/origin不能由hook改；redirect:error，opt-out=true | 保留；不能为相似度删隐私或安全校验。hook能改其他payload部分不等于全payload已经验证 | 越权头/身份hook拒绝；合法hook生效且取消有界；Bearer不随重定向发往别处 |
| K19 | system放置 [system wrapper](../app/src/server/providers/kiro-chat-protocol.ts#L145) | **待证 / P1**：目前首条user加axiom_system；CLI serializer有可选顶层systemPrompt，未证caller默认 | 取得caller契约后再决定迁移；保留Axiom身份、规则及更新语义，不伪造官方提示或assistant确认 | 空/晚更新system、冻结输入、重复构造不累积、工具声明对应；不能仅凭字段存在就迁移 |
| K20 | current/history、modelId、conversationId [payload](../app/src/server/providers/kiro-chat-protocol.ts#L143) | **待证 / P1**：同角色合并；仅current写当前modelId/tools，MANUAL；session哈希或随机conversationId为本地策略 | 保留真实modelId、不静默Auto或替换；对照官方caller默认/生命周期后才调整 | 多轮、切模型、重开/新会话、无sessionId；历史顺序、模型和会话身份不串用 |
| K21 | 工具定义、alias与toolChoice [tools](../app/src/server/providers/kiro-chat-protocol.ts#L55)、[choice](../app/src/server/providers/kiro-chat.ts#L86) | **保留 / P1**：工具由Axiom/Pi提供，支持合法名/确定性alias、冲突及object schema校验；仅auto工具选择 | 不替换为官方工具集；不把不支持的强制/禁用选择当成功；temperature/maxTokens等未映射应明确诊断 | alias冲突/长名/非法schema、无工具、当前工具更新；强制/none明确拒绝，不暗中忽略 |
| K22 | 并行工具分片与执行门禁 [tool stream](../app/src/server/providers/kiro-chat.ts#L164) | **保留 / P1**：按ID交错累积，stop后完整JSON/schema且不静默类型修复；toolcall_end不是已执行证明 | 保留Pi调度与权限；只有最终成功的完整assistant结果才允许进入执行，不能由文本thinking标签造工具 | 并行/任意拆包、坏JSON/schema、改名/重复结束、坏尾帧；收到toolcall_end后全流失败仍零执行 |
| K23 | toolResults与缓存字段 [results](../app/src/server/providers/kiro-chat-protocol.ts#L125) | **待证 / P2**：保留ID、文本、success/error；空结果加占位；官方serializer另有json/toolName/自定义status/cachePoint能力 | 先核Pi输入能否表达及官方caller用法，再扩展；不伪造结果、cachePoint或执行状态；记录空结果改写 | 多结果顺序、空/纯图结果、错名/孤儿、失败状态；新字段有独立来源与fixture |
| K24 | 历史ID与执行账本 [history IDs](../app/src/server/providers/kiro-chat-protocol.ts#L73) | **待验 / P1**：失败/取消assistant整条跳过，ID不入去重；正常assistant被后续user省略的ID仍保留；两者均不证明副作用未发生 | 明确attempt/调用执行状态与重放契约；不机械把所有失败ID认完成，也不放松既有防重保护 | 分别覆盖两类ID、工具已执行后中断和重试；不能因历史省略而重复有副作用工具 |
| K25 | pending恢复的user边界 [recovery](../app/src/server/providers/kiro-chat-protocol.ts#L101) | **待修 / P1**：任何规范化user都可清未配对调用，包括隐藏custom/合成输入，未核实真实取消来源 | 宿主补恢复来源/执行状态或明确未知副作用约束；只省略合法未配对调用，不编造结果，不改本地transcript | 部分并行完成、合成user、迟到结果、真实取消/非取消、system更新；已配对结果/图片不丢 |
| K26 | 用户图片与历史 [images](../app/src/server/providers/kiro-chat-protocol.ts#L28) | **保留 / P2**：支持PNG/JPEG/GIF/WebP及规范base64，当前/历史保原数据和图序；服务解码未验 | 保留格式/大小/原数据保护，不抓取任意URL；合成字节fixture不得冒充真实图像接受性 | 真实小图、历史回放、多图/相邻user、非法base64/格式和总请求超限；服务验收留后续 |
| K27 | 工具图片与图文绑定 [tool images](../app/src/server/providers/kiro-chat-protocol.ts#L127) | **待证 / P2**：工具图提升到user.images，图文分离；不保原交错/逐工具图绑定，2.33.1图片caller未证 | 明示表示能力边界；取得契约前不造逐图字段；若无原生绑定则用明确语义策略并验收 | 两工具多图、图前后文字、错误/空结果、后续追问能正确归属；不只断言base64相等 |
| K28 | 思考预算、adaptive与effort [thinking request](../app/src/server/providers/kiro-thinking.ts#L42) | **待证 / P1**：预算/tag/原生effort来自第三方兼容策略；官方只证additionalModelRequestFields外层；off不保证服务不推理 | 保持精确模型ID映射、不猜新名；官方caller/服务依据补齐后再调整，不把本地预算当官方上限 | 每等级/off/未知ID/非法预算；只检查发出字段不等于服务遵从；真实效果后续单独验证 |
| K29 | 原生thinking与起始标签 [thinking stream](../app/src/server/providers/kiro-thinking-stream.ts#L22) | **保留 / P2**：原生事件与兼容起始标签解析并存；双换行、空白限制/未闭合处理是本地策略 | 保留Unicode和有界解析，普通正文/引用标签不误切，不能从XML创建工具 | 每个拆分边界、CRLF/Unicode/代理项、引用标签/未闭合、原生签名与混合事件 |
| K30 | 思考历史与签名续接 [history omission](../app/src/server/providers/kiro-chat-protocol.ts#L79) | **待证 / P1**：下轮省略thinking/signature/opaque，本地保留；不是完整签名续接，旧parity文档有漂移 | 保留不降级为assistant普通文本的隔离；取得回放契约再实现；同步文档但不篡改旧证据 | 多轮切等级、图/工具混合、思考不泄漏、不重复注入；同步parity/推理审计中的旧叙述；若续接需合法签名与opaque完整链 |

## C. 响应、错误、恢复与验收

| 编号 | 校准项与证据 | 静态核对结论/状态 | 如何修复或保持（未执行） | 验收条件（未执行） |
| --- | --- | --- | --- | --- |
| K31 | EventStream帧/CRC/UTF-8 [parser](../app/src/server/providers/kiro-eventstream.ts#L14) | **保留 / P1**：完整帧、两级CRC、fatal UTF-8、header边界/类型/重复伪头保护存在 | 不为“宽容兼容”跳过校验；限额标本地策略，不称官方常量 | 每字节拆包、坏CRC/长度/UTF-8、重复/非字符串伪头、十种header；截断失败并释放body |
| K32 | stopReason、未知事件与EOF [completion](../app/src/server/providers/kiro-chat.ts#L196) | **待修 / P1**：除过滤外结束信息未完整保留；无其他错误且无未结束工具时，非空白正文或至少一个已结束工具可使完整帧EOF成功，工具调用可进入Pi调度 | 区分帧完整、调用完整与服务响应完整；有界保留stop/未知类别再按契约映射；官方必需terminal未知，不臆造强制结束帧 | 未知/过滤/长度stop、完整工具帧后缺失后续事件、完整帧提前EOF、纯thinking/空流、未结束工具；不能将未知截断伪装正常 |
| K33 | 微片段性能 [argument accumulation](../app/src/server/providers/kiro-chat.ts#L177) | **待修 / P2**：每片参数全量byteLength/前缀解析，存在重复扫描；实际耗时未测 | 累计字节、分片缓存、限频预览；stop仍完整严格JSON/schema，不取消安全校验 | 大量微片、Unicode字节界限、1MiB边界、CPU/内存和取消延迟；先定可测预算，不声称已优化 |
| K34 | 超时、idle、限额与取消 [chat timeout](../app/src/server/providers/kiro-chat.ts#L50) | **待验 / P1**：总期限默认600s/上限3600s，无独立idle；10MiB请求、1MiB参数、16MiB帧/64MiB流/十万帧为本地限额 | 保留迟到body回收及有界hook；独立idle作为产品策略设计，不复制猜测的官方值 | 无响应头/慢body/静默流、忽略signal的hook/transport、显式取消与timeout区别、边界±1 |
| K35 | 结构化错误与排障阶段 [errors](../app/src/server/providers/kiro-chat-protocol.ts#L157) | **待修 / P0**：HTTP错误只用状态；Validation等泛化，多个具体原因不可见，无法据用户现状归因 | 有界解析安全白名单错误类别；携带阶段/状态/允许的requestId及是否已输出，展示脱敏；不记录token、prompt、完整payload/body | 能区别本地准入/代理/认证交接/HTTP/流解码/工具验证；敏感响应/头/错误注入仍不泄漏 |
| K36 | 额度与瞬时限流 [mapping](../app/src/server/providers/kiro-chat-protocol.ts#L165)、[Pi retry](../app/node_modules/@earendil-works/pi-ai/dist/utils/retry.js#L188) | **待修 / P1**：429/Throttling/ServiceQuota合并中文；英文quota排除不能挽回结构丢失，429仍可命中重试 | 安全展示与内部错误类别分离；依据已知服务类别/重试信息分策略，未知quota不能仅靠中文或状态猜月额度 | 瞬时限流/明确额度/未知429、500、认证/验证各自决定；无输出且可重试时才按契约退避 |
| K37 | 有输出后的宿主重试 [session retry](../app/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js#L2978) | **待修 / P1**：provider一次fetch不代表agent不重放；宿主分类不因已有文本/toolcall_end就自动禁止 | 在支持的宿主扩展/依赖源码中定义attempt与输出/工具副作用的重试契约；不直接改安装node_modules，不宣称已发生重复执行/扣费 | 错误前无输出/已有文本/已结束工具/坏尾帧/取消；观察最终调度和调用次数，不只测provider fetch次数 |
| K38 | overflow识别与宿主压缩 [overflow](../app/node_modules/@earendil-works/pi-ai/dist/utils/overflow.js#L35)、[host hook](../app/src/server/agent-worker.ts#L742) | **待修 / P1**：超长原因被泛化，单独Input is too long.未匹配；命中恢复分支时Pi先持久化省略attempt再请求压缩，有memoryPath时worker可取消压缩，不证明自动续跑 | 仅归一化已确认overflow；明确宿主压缩入口及一次恢复/失败边界；取消压缩不等于上下文未变，原记录仍在 | 分类fixture、长上下文/有无memoryPath/禁用/取消/恢复失败；核对context_edit投影、重开、一次恢复标志与后续输入，不仅检查请求缩小和无限重试 |
| K39 | token/credits/价格 [usage](../app/src/server/providers/kiro-chat.ts#L197) | **保留 / P2**：完整token快照与credits/百分比分开，缺用量有诊断，单价零不是免费；价格真实性未由目录证明 | 保留缺失/不完整标识；不将credits或context百分比换算为token/美元，不让空快照覆盖完整值 | 完整/部分/缺失/非法计数、total不一致、多次metadata；UI不展示为精确零成本或错误额度 |
| K40 | 离线与Axiom实际对话门禁 | **待验 / P1**：已有大量离线与历史实调记录，本轮均未执行；原CLI完整链也未完成 | 按下节顺序在允许阶段执行，维护每项证据与退出条件；当前不利用登录态提前调用 | 源码/文档核对、修复、离线接线、Axiom文本→工具→图/思考→中断/回归逐层通过，不以一条成功回复上卷全部完成 |
| K41 | 共享任务入池顺序 [admission](../app/src/server/tasks/admission.ts#L8)、[等待/释放](../app/src/server/agents.ts#L729)、[注入](../app/src/server/tasks/scheduler.ts#L441)、[普通主会话](../app/src/server/tasks/commands.ts#L292) | **待验 / P1**：scheduler任务准备后等FIFO turn，同步发起入池即释放、再等lease；普通主会话不传turn；前序准备慢可阻后序，wait自身无超时 | 保留取消/finally释放与快照变化重排；补请求前等待阶段/时长诊断，评估任务预算是否覆盖入池前；不因静态风险擅改共享调度 | 慢前序、准备失败、取消释放；取得lease后快照变化队尾重排/第三次拒绝，最终提交冲突直接拒绝；主会话不经此闸门；不把执行池原有容量拒绝当新增行为，不宣称已命中用户故障 |

## 已有测试定义与要补的范围

本轮仅阅读和定位，**没有运行**下列测试，也没有复用历史数量当本轮结果：

- [kiro-auth](../app/tests/kiro-auth.test.ts)、[kiro-callback](../app/tests/kiro-callback.test.ts)、[kiro-catalog](../app/tests/kiro-catalog.test.ts)：登录分流、轮询、回调、区域、分页/响应上限、scope/取消。
- [kiro-chat](../app/tests/kiro-chat.test.ts)：原生协议、工具增量/schema、损坏流、错误脱敏、取消、Agent执行门禁、原生provider内存store六并发刷新与opaque ticket；直接chat ticket过期场景单独解释。
- [kiro-runtime](../app/tests/kiro-runtime.test.ts)、[kiro-pooling](../app/tests/kiro-pooling.test.ts)：注册/冷启动/旧协议保护、worker及连接池部分路径。已有定义不等于完整宿主各分支覆盖。
- [kiro-images](../app/tests/kiro-images.test.ts)、[kiro-thinking](../app/tests/kiro-thinking.test.ts)、[kiro-interrupted-history](../app/tests/kiro-interrupted-history.test.ts)：图工具、多轮思考隔离、恢复边界、失败/取消ID等。真实小图与合成非图像fixture须区分。
- [task-admission](../app/tests/task-admission.test.ts)：已有FIFO、取消、准备失败释放、重新预留/重复release等定义；主要覆盖admission对象，不等于scheduler→Agents→pool及任务预算链已通过。本轮只读，未执行。
- 待补重点：完整宿主错误分类与重试/压缩、实际store跨进程和轮转竞争、回填纠错、认证体上限、未知stop与EOF、微片段预算、运行产物/选模/代理及任务入池前等待的脱敏定位。不能只增加serializer快照就认为接线问题已解决。

## 建议修复顺序（当前不执行）

1. **先获得可定位性**：K02–K07、K12–K15、K35；任务场景另核K41。分清旧产物、模型准入、任务排队、缓存scope、代理、原生交接、上游HTTP还是流解码。不要把“重新登录”当万能修法。
2. **再修可靠性和安全**：K09–K10、K24–K25、K32、K35–K38。把错误类别、输出/执行状态与恢复策略接通；保留CRC/schema/隐私/固定域。
3. **补官方基线后再改wire**：K13、K16–K20、K23、K27–K28、K30。静态字段能力不能代替caller默认；不为追求相似度猜头/设备号/system或思考字段。
4. **补性能和覆盖**：K26、K29、K31、K33–K34、K39；同时回归其他provider、会话切换、配置/凭据原文件不被覆盖。

## 何时才进入 Axiom 实际对话

这是后续验收方案，不是本轮执行授权：

1. 明确批准的修复已落地，相关离线单元和 **provider→Pi→Axiom** 接线检查实际执行，含完整AgentSession→worker恢复链，而不只是裸Agent门禁；保留命令/退出码/失败与未覆盖项，源码之后再改则重跑受影响项。
2. 官方契约未知项逐项补证，或经用户明确接受保留的本地兼容策略/能力限制；不把“待证”自动当通过。未接受的核心阻断项不能跳过。
3. 确认运行产物就是受验版本、选定真实modelId与受支持等级、目录/账号scope和网络路线一致。只用脱敏元数据，不复制auth缓存/令牌。
4. 真实工具验收前，先以mock通过额度/限流/坏尾帧/超时/overflow/重试与取消门禁，尤其确认错误/取消后无未授权执行、失败attempt投影及重开行为。不要故意耗尽真实额度或执行破坏性工具。
5. 再经Axiom建立隔离验收会话：先最小文本、不主动触发工具；若需要空工具集要走支持的空声明，不发送不支持的`toolChoice:none`。
6. 文本成功后依次验收无副作用工具、并行工具/结果回传、多轮、真实图片/工具图、思考档位、中断恢复；工具有副作用前设置明确授权和执行账本。其他模型做针对性回归。

记录每个场景的应用构建/模型与等级、脱敏阶段、成功或失败、实际工具执行次数、取消/恢复结果和未验证项；不收录完整用户历史、提示词或凭据。**只有这些门禁满足后，才能说对应场景可用，不能说服务端绝对不可区分。**

## 证据与历史边界

- 本轮源快照/差异、清单完整性与链接校对保存于 `docs/evidence/kiro-calibration/`；这类文档校对不是源代码测试或云端行为证明。
- [同版launcher认证](kiro-protocol-audit.md)、[目录审计](kiro-catalog-audit.md)、[推理历史来源](kiro-inference-audit.md)、[当前思考策略说明](kiro-thinking.md)仅在各自版本/范围内使用。
- 上轮chat局部REA报告在 `/tmp/kiro-model-rea-20261026/README.md`，上轮只读差异报告与源hash在 `/tmp/kiro-axiom-comparison-20261026/`。原始完整关系尝试失败，当前不重跑；历史201项静态检查/111项合成检查不能替代本轮测试。
- 旧 [parity文档](kiro-cli-parity-audit.md)以及[推理审计中的历史思考叙述](kiro-inference-audit.md#L47)有漂移：当前思考不包装为assistant文本，未配对调用可在规范化user边界省略。后续应给当前说明加勘误；本轮仅记录现状/修法，不改这两份旧文档，也不篡改冻结的历史证据。
