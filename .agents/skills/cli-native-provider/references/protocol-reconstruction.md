# 认证与协议还原：从CLI入口到真正发送

用[协议矩阵](../templates/PROTOCOL-MATRIX.md)逐项记录 **官方来源 → 当前实现 → 静态/离线/运行证据 → 差异/未知**。每项字段注明生成者、寿命、条件、类型/单位/顺序，不只记一个示例值。选择原生能力实现与严格parity的验收范围，不能无限等待“所有代码都懂了”才写最小核心。

## 1. 先画链路，不先抄headers

```text
登录入口 → 注册/授权 → code或device轮询 → token解析/存储
                                  ↓
                         refresh锁/轮转/账号代际
                                  ↓
                         profile/目录/权限与region
                                  ↓
host上下文 → wire serializer → middleware/observer → transport
                                  ↓
                HTTP错误或流帧 → 增量状态机 → 工具/终态
```

同时追踪辅助请求（title、summary、usage、telemetry等）的来源、作用和是否必要。目录成功不证推理权限；主请求对齐不证OAuth/辅助链路对齐。不要因为主请求之外还有流量就归因给模型重试，也不要仅凭tools=0猜标题。

## 2. 认证模式分别恢复

对每个实际需要支持的模式独立核：个人OAuth、企业OIDC/联邦、device、PKCE或公开API key。模式相似不等字段/主机/编码相同；region不能单独决定模式。

- 注册：public/confidential、clientName、grant、scopes、redirect、可选字段缺省/省略、客户端注册过期。客户端身份字符串需来源与允许使用边界，不能伪造设备证明或签名。
- 授权：state与PKCE的生成/校验、redirect精确匹配、loopback绑定、手动回填、取消、重复/迟到回调；不在日志中回显code/URL query。
- Device：poll interval、slow_down、pending、拒绝/过期和总deadline；不因轮询成功一次就忽略后续退避。
- Token：seconds/milliseconds/绝对时间、缺字段与非法字段区别、refresh轮转、客户端注册绑定。None缺省不等解析错误也可缺省。
- 刷新：锁内重读、single-flight、各caller独立取消、原子保存/失败保旧、旧结果不能覆盖新账号；过期注册不能用旧refresh静默配新client。
- 存储/退出：宿主注入安全存储，最小敏感字段；logout本地删除与远端revoke不同，活动请求取消与cache失效另证。
- 正常独立登录，绝不复制官方CLI认证缓存绕过流程；授权不足明确报错，不增加scope或换组织入口试探。

授权页卡住时先核现有页面是否属于当前流程、首个失败XHR、浏览器/后台代理与变量继承，不先改scope或重新登录；CLI输出解析器失败不等认证失败。对照须同认证模式/账号条件，个人成功不能证明企业路径。只在RAM内比较所需敏感值，保存“字段存在/格式有效/关系一致”的白名单结论，而不是token、code、完整profile标识或它们的hash。

## 3. 模型、profile与路由

核模型ID/alias真实映射、分页、唯一性、限额、profile选择、权限和服务region。auth region与inference region分开。目录完全读取才发布，循环分页/取消/账号变化不发布部分新结果。

缓存必须绑定可信账号/登录代际及必要profile，而非用户可改metadata；access刷新是否保留、refresh轮转是否换代由契约决定。refresh generation、防旧结果发布与全分页原子完成须一起测；失败可保留旧展示但不得报新拉取成功。

迁新版目录须核host/target/path/query/body、认证头、分页及default/required全契约，不只换域名；聊天profile修复不证明目录路径消费同一结果。实验/feature选路的局部精确ID补丁不等完整策略。能力声明、兼容政策、实际发送、服务执行效果分层，未知不当false/true或零费用，不用名称子串猜能力。thinking的顶层与嵌套required、enum/default、缺省/own undefined/显式off分别核；effort不是精确token预算。

## 4. 请求数据与动态身份

落实[首要准则](../SKILL.md)第1至3条：

- 从 CLI 证据为每条路径（认证、刷新、目录、推理、辅助）建 header 和 body 字段白名单，注明每个字段的来源和取值规则。发送层按白名单从零构造，不从 SDK options、caller headers 或宿主对象合并后再删减。
- 宿主或 SDK 能注入的入口（headers、onPayload、metadata、user、自定义 fetch 默认头）逐个列出处理方式：覆盖、丢弃，或由 payload guard 拒绝。注入值不得以别的字段名“漏”到请求里。
- 列出可能额外注入的宿主内部标识（会话/工作区/账号 ID、路径、用户名、主机名、产品名和版本），证明不进入协议身份/metadata。协议 ID 按 CLI 格式和生命周期生成，不复用宿主 ID；caller真实内容中的路径/名称仍须保留（首要准则第3条），不能用全文去品牌清洗。

- 保留system/custom/history/tool results与安全约束。只有协议明确需要的映射才转换；不能靠删除/改写用户内容对齐官方。
- JSON类型、null/缺省/空值、数组和有意义的字段顺序、编码、Unicode及字节长度逐项核。不得排序/归一化后把真实差异隐藏。
- 分开 session/conversation、root、continuation、logical run、model invocation、physical attempt、tool call、response ID。为每个ID注明“谁产生、何时新建、何时复用/恢复、范围与格式”。
- 逻辑轮进度不能由HTTP次数、历史长度、SDK私有turnIndex猜；工具后续、SDK retry、summary/compaction和恢复的事件边界分别核。
- 工具：名称别名可逆、schema投影可解释且不扩权，call ID唯一与结果配对，增量参数完整后才校验，错误结果/多内容块不丢失；响应文本中的伪调用不执行。根object本地要求与远端不支持组合关键字分层测；wire投影仍保留原schema执行前严格校验，不能泛化扁平化开放/$ref/歧义union。测真实全工具集/MCP，不只read。
- reasoning/签名/opaque历史、图片/文件、缓存控制、输出限制各列证据；接收/解码不等请求侧回放已实现。不把思考降级普通assistant历史，图片须覆盖当前/历史/工具回图的实际识别。省略未配对工具不证明无副作用或可重执行；保留本地transcript及unknown诊断。opaque仅内存/正常会话存储，不作调试输出。

## 5. 传输必须沿真实运行路径核

找最终sender，而不止最上层fetch调用。检查SDK hooks、统计observer、代理注入、redirect和自动重试是否替换/修改了它。

对认证、目录、推理分别记录：method/path/query、content-type/accept、UA/SDK标识、privacy、profile/origin/attempt、content-length、压缩、HTTP版本、连接复用、代理/NO_PROXY、TLS/ALPN、超时/重定向。删除显式UA不等没有默认UA；构造对象正确不等wire无补头。最终 header 名单与白名单逐项比对，多出的项要么去掉，要么写出 CLI 也发的证据（首要准则第4条）。

固定或严格校验可带凭据的目的地，禁止用户/响应把token导向任意URL。代理认证只发代理；自定义可信transport可影响wire，应明确边界，不静默fallback。捕获代理会改变TLS/连接，对代理下HTTP一致与直连指纹分开结论。

## 6. 流式状态机与终态

先确认SSE、NDJSON、WebSocket、AWS eventstream、gRPC等实际格式，再按已证规则实现：
- 分片UTF-8、帧/事件大小、总量/事件数/深度/工具参数上限，不能以末尾一chunk读后检查声称严格硬上限。
- delta、item start/end、工具片段、usage、finish/DONE及HTTP错误分别处理；不要凭一个DONE或socket EOF就成功。
- 缺终态、身份不匹配、坏JSON/CRC、重复/孤立工具ID、截断与取消不得发布可执行工具。
- 未知事件按 CLI 的处理（首要准则第5条）：CLI 忽略就忽略，CLI 报错就报错；没有 CLI 证据时才保持严格。忽略或失败都在诊断中记过滤后的事件 type 名（如`^[a-z0-9_.:]{1,80}$`，不匹配记`unsafe`），不带payload。事件集合按模型与思考档位分别取证，不用一个模型的捕获推全目录。incomplete、refusal、opaque reasoning 等也按 CLI 的终态和展示语义映射，不自行加拒绝条件。
- 合法requires_action等工具终态不等incomplete；长度截断不得执行本轮工具。refusal去重、reasoning envelope与handoff按版本绑定CLI语义分别映射，不能仅凭事件名猜同类处理。成功路径也记录有界安全事件计数/固定分支结果以证明新路径命中。
- 使用“增量可展示、完整验证后才可执行”的边界；同一个事件只交付一次hook，hook失败不是可重放的网络错误。
- response/token usage、credits、计费和本地估算分开；未知不伪造精确token或免费。

## 7. 重试、恢复与资源状态

至少分三层：transport自动retry、Provider pre-response retry、Agent/session恢复。建立唯一owner/互斥策略，防预算叠乘；显式用户disable/zero/cap/deadline必须保留。

核分类的实际name/reason/code/status/body、hint优先级/单位/日期、jitter/cap顺序、capacity/refund、adaptive状态的归属与寿命。429可能是不可重试配额，未知5xx不自动可重试；不要拿现有UI错误分类器代替官方策略。重试头必须反映实际次数/预算。

成功Response后的SSE错误与pre-response失败分开；有任何text/thought/tool进展（包括空delta或内部缓冲）就不能按“无输出”重放。若CLI明确以特殊handoff终态要求compaction，须单列有依据的恢复例外、协调宿主并验副作用，不能把所有partial overflow暴露成可压缩错误文案以诱发隐式重放。未知远端副作用没有本地receipt的exactly-once保证，不静默换模型。

每个共享client的acquisition/锁/预算有owner；caller abort不等底层停止。pending未settle时保持隔离，后继受自身deadline和有界队列约束；账号/epoch切换后旧结果不能发送、覆盖凭据或污染新state。安全保守差异应声明，不装作官方并发语义。

## 8. 从矩阵进入实现

足够实现某能力就写合成fixture，不为补全无关调用图延迟。功能性差异、待用户决定的隐私差异、缺证的未知分别列出。若目标是全链路对齐，所有必需认证模式和辅助路径必须有对应验收；只完成推理不能替它们打勾。
