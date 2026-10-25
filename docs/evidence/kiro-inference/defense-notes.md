# Kiro 推理防御静态研究（独立子任务）

范围：仅 read/rg 本地参考源码；没有执行第三方程序、测试、构建、联网、凭据读取或 API 调用；未改项目源码。下述“官方”为提供的 amazon-q-developer-cli 历史源码，不能代表当前闭源 Kiro CLI，参考注释中“实测/官方 IDE”也不是本任务验证结果。

## 路径约定（下文根目录 + 相对路径 + 行号即完整定位）
- H = C:/Users/dane/AppData/Local/Temp/axiom-kiro-rs-research-551521254d8c430680481850c604da97/hank9999
- Z = C:/Users/dane/AppData/Local/Temp/axiom-kiro-rs-research-551521254d8c430680481850c604da97/ZyphrZero
- O = C:/Users/dane/AppData/Local/Temp/axiom-kiro-catalog-research/amazon-q-developer-cli

## 1. 消息与工具合法化：优先无损、可审计，不能直接照搬宽松过滤

H/src/anthropic/converter.rs:244-268 检查空 messages，但尾部任何非 user 都当 prefill 丢弃，直到最后 user。Z 同路径:750-765 同行为。未知 role 不应被视作 assistant；主实现应在转换前明确拒绝不支持的 role/content 类型。若不支持 prefill，返回可诊断错误或显式适配，不可悄悄删除。
H converter.rs:367-425 对内容块使用 if let Ok，反序列化失败、未知 block、非法图片格式直接忽略；非字符串/数组内容也忽略。这会把有意义输入变成空字符串。Z converter.rs:945-1000 仍应审查此类宽松路径。主实现应为所有内容块决定明确结果（保留、显式降级、报错），记录变换原因及数量，不记录原始敏感内容。
H converter.rs:495-565 / Z:1092-1162 用全历史 HashSet 验证当前 tool_result，跳过孤立/重复 result，删除无结果 use；无法证明历史中每个结果时序正确，也不拒绝历史重复 use id。Z:826-835 只有非 Generate purpose 才用严格检查；Z:1165-1222 的 validate_compaction_tool_sequence 以 seen+pending 拒绝重复 use、无 pending result、最终未配对，是可借鉴的状态机，但仍需逐轮顺序规则。
H:707-800 合并连续 user/assistant，系统消息伪装成 user+assistant 确认，孤立 user 后补 OK。H:304-315 为历史缺失工具添加占位定义。它们都是协议适配，不能使原本不可执行的历史工具重新可执行，也不能把合成确认当成真实助手输出。
O/crates/chat-cli/src/cli/chat/conversation.rs:1121-1214：保留有效历史范围；孤立工具结果转为文本；最后 assistant 有工具而新 user 无结果时补 cancelled 结果，保留用户 prompt。相比静默删除更可审计。极端历史溢出仍可能清空并替换成说明文本（1134-1157），不可概括成完全无损。
O 同文件:1219-1275 对历史工具名检查当前工具表；唯一后缀匹配才还原，多义/不存在转 dummy。调用执行必须独立校验当前工具白名单；历史补全不可增加执行授权。
O/crates/chat-cli/src/cli/chat/message.rs:123-143 构造取消结果；conversation.rs:391-396 对空 prompt 用 Empty prompt。建议区分纯空消息和合法仅图片/仅工具结果消息，避免一律塞空占位。

## 2. 工具名称、ID、schema 与超长输入

H converter.rs:605-630 / Z:1262-1288 用 63 上限、54 前缀+8位 SHA256；使用 name.len() 判断字节，char_indices().nth(54) 截字符，非 ASCII 仍可超字节限制；没有在此证明短名碰撞/大小写碰撞检测。名称和 tool_use_id 是不同字段，不可对 ID 套用 63/64 限制或截断。Z/src/kiro/model/requests/tool.rs:64-65,121-132 只是 String，没有 ID 长度校验；本轮没有找到可靠的服务端 ID 上限依据。建议非空唯一、不含控制字符、明确本地资源限额；如映射 ID 必须跨 history/use/result 双向一致且防碰撞。
O/crates/chat-cli/src/cli/chat/tool_manager.rs:1766-1815 注释正则 ^[a-zA-Z][a-zA-Z0-9_]*$；实现 >64 拒绝、非法名称 sanitize 后碰撞处理、空 description 拒绝、>10004 字节截断并告警。注释“less than 64”与代码允许64有差异，别把参考63当官方硬上限。官方 spec.description.truncate(10004) 在多字节边界可能 panic；应使用安全 UTF-8 字节裁剪。
H converter.rs:652-664 description 最多10000个字符（不是字节），同时注入 Write/Edit 分块建议。Z:183-196 还对 Bash 追加100行/~8000字符建议。提示词只是建议，不是防止超长 JSON/内存消耗的硬约束，不建议污染用户工具描述或系统提示来替代限制。
Z converter.rs:32-179 强制顶层 object、补 properties/required/additionalProperties，删顶层 oneOf/anyOf/allOf（仅取首个 object variant），删数值 exclusiveMinimum/Maximum 和 i32 范围外 minimum/maximum。这改变 schema 语义。注释“Draft07 exclusiveMinimum 仅bool”错误：Draft-07 接受数字（旧 draft-04 才是 bool 搭配 minimum）。不能以此证明当前上游不支持。递归仅 properties/items，未全面处理 $defs/$ref、combinator、additionalProperties 内 schema。
建议：缺省补齐与语义改变分开；仅按实证能力进行转换；不支持的 schema 显式拒绝或给出能力错误；保留原始 schema 用于执行前本地验证。禁止以静默删除约束换取请求成功。
O/crates/chat-cli/src/cli/chat/consts.rs:6-12 历史10000、工具结果400000、用户消息400000（历史实现限额，非当前 API 契约）。message.rs:81-103,362-382 安全截断并加后缀，必要时 JSON result 转文本；conversation.rs:696-704 仅压缩策略启用时截用户历史。主实现宜请求总字节+单内容块+图片解码+工具累积+历史数量限额，拒绝/明确截断，按完整轮次裁历史，保留工具配对；不能截断可执行参数 JSON。

## 3. 流完整性、防静默成功及工具执行边界（P0）

H/src/anthropic/handlers.rs:579-680：decoder feed/解码错误仅 warn；Event::from_frame if let Ok 吞解析失败；完整工具 JSON 解析失败用 {} 替代；其他 exception 被忽略；未 stop 的 buffer 未完成也没有统一 EOF 校验。这可能返回正常 end_turn/tool_use 而工具或文本已丢失，禁止照搬。
Z/src/kiro/parser/frame.rs:26-30,82-153：最小16、最大16MiB 帧，prelude/message CRC，header 边界。decoder.rs:38-41 最大缓冲16MiB/连续错误5；:111 暴露 pending data。解析器有恢复逻辑，但主推理 handler 应遇损坏即显式失败，不能恢复后假装完整。
Z/src/anthropic/handlers.rs:1158-1230：feed/帧/事件解析/上游 error 均 interrupt；零字节 EOF、残帧 EOF 报错；最终 tool JSON 错误标记 error；已发200时通过 SSE error 传播，不伪造正常终止。:1438-1456 upstream_event_error 对 Error/Exception 统一判断，但 ContentLengthExceededException 特殊作为 max_tokens（应结合 incomplete tool 优先报错）。
Z/src/anthropic/stream.rs:899-1065 ToolJsonAccumulator：按 tool_use_id 拼接，stop 后整体解析，invalid JSON/非空未stop EOF 报错，避免半截工具交给客户端。缺陷：serde_json::Value 接受数组/数字/null；未见每工具/总累积大小界限；未拒绝同id名称变更/完成后重复id。finish 把任何空/空白未stop 调用推定为无参 {}，但函数没有输入 schema 验证，因此不能证明是合法无参工具。
O/crates/chat-cli/src/cli/chat/parser.rs:467-575：收集工具输入，非 object JSON 返回 ToolValidationError，非空坏 JSON EOF 返回 UnexpectedToolUseEos；构造告警参数仅作为失败历史，不执行。空输入兼容 {}。O chat/mod.rs:2971-3048 记录失败消息并形成工具错误反馈；这属于代理层修复后续请求，不等于 provider 在已发事件后透明重试原请求。
Z stream.rs:784-850,1905-2008 额外从文本 <invoke> 推断工具调用、坏 JSON fallback {}；有已知工具/代码围栏等启发式也不能证明文本是执行意图。建议禁止文本/XML恢复为可执行调用，只接受正式 toolUseEvent；也不要默认删重复文字、tool XML 或看似推理标签内容（会误伤用户要求的字面示例）。
Z/src/kiro/model/events/base.rs:19-24,146-147 未知事件退化为 Unknown {}，丢类型和payload。仅“收到非零字节”不足以防 unknown-only/metadata-only 流被算成功。建议保存未知事件类型诊断、允许已知非内容事件、要求至少有效内容/明确终止语义；未知重要事件明确报不支持。
建议错误出口一处：中断后禁止正常 done/stop；已完成部分内容可留作 partial，未完成工具不得执行；无首字节/idle/总时长超时、AbortSignal 取消、SSE ping 不能刷新上游idle计时；取消与usage结算幂等。Z handlers.rs:1260 起 StreamSettlement/Drop 可借鉴记录一次最终状态。

## 4. 限流、异常及重试（P0/P1）

H/src/kiro/provider.rs:23-26 每凭据3、总9；:397-479 认证失败可切凭据，408/429/5xx退避，其他4xx失败；:509-517 指数+抖动。不要照搬账号轮换。
Z provider.rs:31-38 总预算降至4；:1185-1221 优先拦截伪装5xx的请求校验失败及524/网关超时，避免重试风暴；:1226-1260 对瞬态有限重试；:1356-1379 普通2000ms上限、429 8000ms上限再加抖动。
Z/src/kiro/error.rs:32-52 解析 Retry-After，有有效值直接让调用方处理而非本地立即重试；provider.rs:930,969-971 model overload 类型化；handlers.rs:472-509 映射503/429并保留 Retry-After。普通429和账号配额/容量应区分；错误体字符串匹配只作为兼容fallback，优先结构化 reason。
O/crates/chat-cli/src/api_client/mod.rs:525-566 识别 Input is too long、INSUFFICIENT_MODEL_CAPACITY、429及MONTHLY_REQUEST_COUNT；:569-594 设置连接/read/operation/attempt超时、adaptive最大3次、stalled stream保护5分钟。retry_classifier.rs:31-75 月额度 RetryForbidden，高负载500按节流分类。注意 mod.rs 的429判定在monthly之前，但classifier独立月额度禁止重试。
建议：坏请求/上下文超限/无权限/额度耗尽不自动重试；401最多一次明确刷新（有合法刷新流程时），403不能假定过期；429尊重Retry-After且总等待预算可取消；有限网络/5xx重试仅在无对外内容/工具事件阶段；流内error与HTTP error统一分类。禁止多层各自重试乘法、禁止因短暂限流禁用凭据、禁止已完成工具被自动重放。

## 5. 思考内容（P1，与普通回答分离）

Z/src/kiro/model/events/reasoning.rs:14-29 支持原生 text/signature/redactedContent；base.rs:30-38 识别reasoningContentEvent。Z stream.rs:2238-2277 透传原生thinking/signature/redacted；但thinking关闭时把reasoning转普通text。handlers.rs:1870-1932 非流关闭thinking且有普通text时丢原生thinking，只有thinking时转text：与流模式不一致。
Z stream.rs:2216-2234,2320-2333 和 handlers.rs:1881-1897 缺signature时造占位；文本<thinking>解析是启发式，不等价于原生reasoning。建议主实现优先独立thinking内容块、保留原生签名/加密块为opaque数据；无签名应表达缺失而非伪造真实签名；未知/不支持思考回传能力应显式报告，不转为普通回答掩盖失败，也不把标签示例误判为思考。
O/crates/chat-cli/src/api_client/model.rs:574-581,662,718 当前历史归一化 ChatResponseStream 未发现原生reasoning分支，未知SDK事件归Unknown。只能说明该历史版本不足以核对新原生reasoning契约，不能宣称当前官方不支持。

## 6. 争议兼容策略：单列，禁止直接照搬

1. profile占位：Z/src/kiro/model/credentials.rs:975-1005 effective_profile_arn 过滤占位而 streaming_profile_arn 缺值推断默认ARN；Z provider.rs:232-282 尝试解析真实profile失败仍沿原ARN继续。该“官方IDE行为”仅仓库作者注释，本任务未验证。O api_client/mod.rs:246,297,357,418 用 self.profile 真实所选profile Option传入，未见此位置制造默认ARN。建议仅显式/官方流程获取profile；需要但缺失则清晰失败。
2. 机号/客户端伪装：Z/src/kiro/machine_id.rs:48-85 优先配置，随后API key/refresh token派生hash，缺料随机UUID且进程缓存(:94-105)。这不是推理稳定性防御的必要措施；不可把凭据派生标识、伪装官方客户端或轮换机号照搬。应采用项目合法客户端标识规范，不从真实凭据派生日志可见标识。
3. 跨区试探/去profile重试：Z/src/kiro/token_manager.rs:456-475 把SSO region映射US/EU两候选；:490-504 对区域枚举带/不带profile；:513-526 对403及部分400退无profile。适用于其REST目录/用量兼容，不可推广为推理授权修复；主实现应固定用户选择/可信元数据区域，权限失败不要跨区或删profile试探。
4. 账号轮换/禁用策略同理与本任务单用户推理防御无关；没有用户授权不能借鉴为绕过限流。

## 推荐落实优先级及离线验证（测试未运行）

P0：输入结构及状态机、无静默丢块；帧CRC/残帧/空流/exception错误传播；工具整体JSON对象+本地schema+白名单+唯一ID，完成前不可执行；累计大小/超时/取消；输出后禁止透明重试。
P1：请求/历史限额与显式截断报告，名称可逆映射+碰撞检测，保留工具结果文本/取消记录；结构化错误+Retry-After+有限抖动预算；原生thinking独立事件及流/非流一致。
P2：必要schema能力协商、未知事件诊断、usage/终止幂等、明确语义的压缩；不加入文本工具恢复、schema破坏性修剪、profile/机号/跨区试探。

建议主代理只运行合成离线fixtures：UTF8切片/多字节超长名称/映射碰撞；空prompt vs仅图片/工具结果；未知role/block；重复ID、孤立/逆序result、取消工具；字节分片每边界、CRC错、残帧、metadata-only、未知事件only；error/exception后不得done；工具合法对象/数组/null/坏JSON/无stop空工具有required/重复stop/交错ID/超大累积；原生reasoning+签名+redacted混排、字面thinking/XML示例；429秒值/HTTP-date、月额度、5xx校验错误、取消重试与流发出后的重试禁令。