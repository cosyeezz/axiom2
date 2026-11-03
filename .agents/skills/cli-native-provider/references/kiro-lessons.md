# Kiro 版本化教训与证据

这是方法来源，不是下一家供应商的协议规格。核查范围为历史主会话、正式报告及本次关键源码读回；非逐条审计所有测试会话。本轮只整理技能，没有新模型请求、抓包、REA执行、重启或Provider实现。

下列 repo 文档相对链接用于在本仓库追溯；技能复制到别处时不应把这些案例路径作为执行依赖，通用步骤均在本技能 references 内。

## 1. 认证成功不等目标身份/操作可用

- 历史 Google 账号文本成功不能证明当前企业账号。企业缺 profile 是实际阻断：正常账号自身发现后，同条件从400转成功；后来的目录迁移同样先403、只迁接口后400、补该操作自己的profile后200。
- scopes、TokenType、region、profile来自绑定版本/真实账号，不从“标准OAuth惯例”猜。浏览器显示AWS logo转圈时先看现有授权URL和首个失败XHR；应用代理不等系统Chrome代理，取消后台任务不等旧页关闭。`whoami --format json` 返回文本时，JSON投影器失败不等未登录。
- 目录失败和聊天失败分别定位：老Windows CLI2.12的q/CodeWhisperer query+body不能盖过macOS CLI2.36控制面AWS JSON1.0 `POST /`、body-only证据；只换host/target不足。显式profile保留，企业多profile不猜选、不借profile。
- 来源：[认证说明](../../../../docs/kiro-auth.md)、[企业profile实证](../../../../docs/kiro-profile-fix-20261028.md)、[目录修复](../../../../docs/evidence/kiro-catalog-repair-01/REPORT.md)。profile报告33次run含取消/失败、29 completed中严格断言27通过，不能缩成“全部绿”。

**复用**：认证模式/active binding/profile/region和每个操作契约先对齐；CLI对照身份不一致只能参考，不能裁决当前权限。

## 2. 目录与能力必须看完整契约

- 目录的defaultModel可缺省/null；thinking内部required不等顶层thinking必填，enum有adaptive不等应主动发type。实际生成schema/serializer优先于trait路径拼接；缓存实时失败不可伪装刷新成功，分页必须完整后原子发布，取消/generation/账号变更要隔离旧结果。
- KAS的Responses选路有feature条件。当前Axiom对DeepSeek3.2、Sonnet5.5、Opus5.5的精确ID路由是**版本绑定局部兼容**，不是完整实验resolver，不按claude/sonnet子串推广。
- 当前Sonnet5.5默认high，Opus5.5默认medium；它们是有目录/构造证据的例外，不是新模型默认。Sonnet type enum没有disabled，SDK off兼容入口实际high并记unavailable，不代表关闭思考；初始own reasoning:undefined也不证明用户主动off。token预算、native effort和服务执行效果分别报告。
- 来源：[目录审计](../../../../docs/kiro-catalog-audit.md)、[目录取消](../../../../docs/kiro-catalog-cancellation.md)、[思考配置与历史阶段](../../../../docs/kiro-thinking.md)、[新版企业验证](../../../../docs/evidence/kiro-enterprise-validation-01/REPORT.md)。

**复用**：能力声明→适配兼容政策→实际发送→执行效果分层；模型特例记录版本/来源，不以降档或改ID取得通过。

## 3. 真实工具集暴露了两层schema问题

- 根缺`type:object`最初在本地拒绝，补type后真实宿主含组合根的工具又遇远端400。只测一个read工具会漏第二层。发送侧对受限闭合object分支作可解释投影；复杂开放分支、$ref、歧义不支持就拒绝。
- wire可表达范围不等宿主执行许可；原union schema仍是本地最终校验，工具集合、工具名与审批不删不降级。根投影不是“服务器支持完整JSON Schema”。
- 来源：[企业验证中的Schema两次修复](../../../../docs/evidence/kiro-enterprise-validation-01/REPORT.md)、[当前projection](../../../../app/src/native-providers/kiro/protocol.ts)。

**复用**：测试真实全工具集合（含MCP），分开本地拒绝与远端不支持；serializer负例和本地严格validator都保留。

## 4. 先查CLI，避免“更严格”误伤协议

- Opus/high“你好”原条件失败到`response.reasoning_part.added`。Rust strings找不到不证明不支持；CLI2.35.1/2.36.0/2.37.0旁带的KAS均0.66.70且本次核到相同bundle digest，bundled JS直接给出parser。它忽略reasoning_part边界，接受reasoning.delta，而非我们自己增加slot/内容条件。
- 随后统一unknown事件有界计数、incomplete分类、refusal delta/done去重、encrypted_content JSON envelope。合法requires_action工具终态与incomplete/长度截断必须区分；收到了完整参数不等允许执行。unknown事件仍不能绕过坏JSON/身份/工具schema防线。
- 曾把所有partial overflow暴露为overflow文案，触发AgentSession自动压缩重试并破坏7项回归。修为**仅明确COMPACTION_REQUIRED_FOR_MODEL_HANDOFF终态**可进入该恢复；普通已有进展的错误禁止隐式重放。
- 最终592项相关回归和部署chat-live-13通过；成功诊断reasoning_part added/done各1证明实际命中新忽略路径。这个PASS仍不证明完整CLI parity或所有长会话。
- 来源：[新版企业验证的KAS统一与部署](../../../../docs/evidence/kiro-enterprise-validation-01/REPORT.md)、[当前parser](../../../../app/src/native-providers/kiro/responses.ts)、[当前client](../../../../app/src/native-providers/kiro/client.ts)。

**复用**：错误seed→版本绑定CLI处理→最小流fixture→实际SDK副作用→一次精确原条件验收。合法终态由协议定义，不自己限定只能completed。

## 5. 历史与图片不能只验序列化

- 把thinking文本包装成普通assistant历史曾诱发下一轮思考泄漏；历史兼容策略改为本地保留、发送省略并记诊断。接收/解码signature不等请求侧opaque历史回放实现。
- 中断工具在归一化user边界省略未配对调用，只是wire修复，不改本地transcript、不伪造result。该边界可能是custom/合成/摘要，不证明真人取消；更不证明工具没执行或可安全重做。
- 图片当前消息、历史图片、工具回图要独立验证实际内容识别。假的base64 serializer通过不代表服务能看图；旧profile阶段冒烟不能代替新Opus阶段未做的图片验证。
- 来源：[思考历史](../../../../docs/kiro-thinking.md)、[图片覆盖与限制](../../../../docs/kiro-images.md)。

**复用**：上下文保真和不泄漏都要验；不能靠丢用户真实内容、伪造工具结果或错误重执行来对齐。

## 6. 观测器可能改变了被测对象

- 成功抓包路线是mitmweb解密→OpenCLI浏览器同源flow API→RAM白名单。最初自动官方CLI60秒超时、代理无新增flow，原因未知；后来用户手动交互成功。命令变量是否export是已知坑，但不能倒推为那个超时唯一原因。
- 初始Axiom GAR/eventstream与官方Responses/SSE不同。迁Responses后live-04仍HTTP2与Fetch补头，确证为**Axiom provider-request-observer替换native sender**，不是Pi本体强制Fetch。live-05修正常SDK路径限定HTTP验收，live-06工具结果/下一轮身份历史通过。
- sender前hook不等wire；header键集合不等字段值/顺序；MITM终止TLS不证直连TLS指纹。optout差异仍保留用户保护，不以服务端不可识别为目标。
- 来源：[抓包过程详单](../../../../docs/cli-native-capture-comparison.md)、[live-04](../../../../docs/evidence/kiro-macos-native-02/responses-live-04/REPORT.md)、[live-05](../../../../docs/evidence/kiro-macos-native-02/responses-live-05/REPORT.md)、[live-06](../../../../docs/evidence/kiro-macos-native-02/responses-live-06/REPORT.md)。具体通用工具步骤在[采集参考](capture-comparison.md)。

**复用**：观察器仅包装真实sender，最小本地SDK路径先证未替换，再动用真实额度；历史抓包授权不能转移到新会话。

## 7. 重试、缓存与连接优化都有独立owner

- 原生retry设计已完成但**未实现/启用**，生产native sender仍单次；宿主仍可能retry。直接在上游叠原生3–6次和session9次会乘出30–60次发送。pre-response成功、SSE失败、已有进展、compaction边界分别核；用户disable/zero不可被默认策略覆盖。
- 异步acquisition不接受signal时，caller可先取消，但owner/锁保留至真实settle；不能Promise.race后立刻放锁让后继共享状态，迟到对象不得发送或复活新账号。
- supportsPromptCache字段/usage读数不证caller主动建cache；目录/profile缓存、prompt cache、warming和连接池各自独立。Kiro忽略maxTokens时`maxTokens:1`不能限制预热成本，因此warming门禁关闭。旧全局Undici池保活测试不覆盖后来Responses HTTP/1.1 native sender的Connection:close。
- 来源：[原生重试设计](../../../../docs/kiro-native-retry-design.md)、[旧池策略历史范围](../../../../docs/kiro-connection-pooling.md)、[当前warming守卫](../../../../app/src/server/kiro-cache-policy.ts)、[当前native request](../../../../app/src/native-providers/kiro/request.ts)。

**复用**：先核消费者/真实sender与预算，不因字段/SDK/设计存在而宣称能力已启用，优化不得新增未授权付费请求。

## 8. Harness、分发与部署的假通过

- 当前app测试以实际安装loader和cwd为准；继承AXIOM执行profile/account binding等5变量会污染受控子进程。旧fixture仅允许q域名会把新的management路径误报产品失败；raw baseUrl与展示URL不能混用。
- starting阶段用同一session恢复默认曾把真实测试切回kiro.rs；run settled后用**单独空会话**恢复，并核DB中测试selection与全局默认。SDK独立入口只覆盖它自身，不证worker自动注入/UI。
- 共享dist与多人构建会漂移，冻结快照只能证明该产物；live前harness/源码/依赖/产物绑定，claim仍唯一。build/restart后核当前PID、启动时间和关键产物，而非沿用旧PID。
- 组件化首次构建漏index/account/factory；修build include后全部21模块发射、分发闭包及无Pi plain runtime导入通过。npm10.9.8的pack dry-run即使ignore-scripts仍观察到prepare，不能仅凭flags说无脚本。
- 来源：[目录harness修正](../../../../docs/evidence/kiro-catalog-repair-01/REPORT.md)、[实际组件离线交付](../../../../docs/evidence/kiro-native-component-01/REPORT.md)、[独立SDK实发范围](../../../../docs/evidence/kiro-native-component-live-01/REPORT.md)、[企业验证的默认竞态](../../../../docs/evidence/kiro-enterprise-validation-01/REPORT.md)。

**复用**：先排harness/环境，分列源码、分发、SDK、常驻服务、worker/UI；原生core独立不等整个认证存储独立，也不等全SDK即插即用。

## 9. 旧结论何时被替代

- [早期进度交接](../../../../docs/kiro-native-request-progress-handoff.md)记录0个正式配对、调查扩展和未修Provider，是当时状态；后续抓包/live报告替代“尚无样本”的结论，不复活自然preload/完整进程树计划。
- 旧目录Windows证据仍保留历史意义，但新版控制面serializer和成功目录修复裁决当前操作；思考文档中的旧GAR映射也不覆盖新版精确Responses模型。
- REA不只是读已有capture；也有runtime/browser采集能力，需要单独授权。当前关闭不证明历史未使用，也不授权本次启用。retained结果/局部11函数成功不代表整链已闭合。
- 当前未补齐：完整实验路由、请求侧原生thinking历史回放、完整官方重试、全部长会话Opus400原因、最终wire宿主身份负例代码测试。源码读回还显示request.ts对extraHeaders仅保护部分名称、payload guard主要限制身份字段，并非本技能要求的完整协议白名单；不能把新准则写进技能就称当前实现已满足。这些不由本次文档整理自动解决。

**效率结论**：够回答一个实现决策就回实现/夹具；保留原始历史报告，用版本化替代关系消除旧“下一步”，不要用调查规模和测试数量替代用户可用结果。
