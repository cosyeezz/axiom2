# Provider架构与SDK适配

## 1. 统一的是契约，不是供应商的wire

```text
Host Agent SDK（会话、调度、工具执行、安全审批）
    ↓ SDK adapter（消息/事件/身份/设置映射）
Native Provider contract（版本化域类型与能力）
    ├─ Vendor A：auth + catalog + protocol + transport + parser
    └─ Vendor B：auth + catalog + protocol + transport + parser
```

同一包放多个Provider很合理；将两套凭据、profile、retry state揉成一个“通用fetch”不合理。不要因厂商相同推断两个产品共享认证。默认进程内直连；CLI代发、OpenAI兼容HTTP服务或另起进程是不同架构，须用户另行选择，不由“统一协议”自动推出。

## 2. 最小公共边界

以下是通用设计槽位，不是所有SDK都支持的标准API；具体已实现入口与覆盖须查对应组件文档，不能把表格当接口声明。按目标能力确定类型：

| 边界 | 输入/输出与责任 |
|---|---|
| identity/capabilities | 稳定provider ID、实现/协议版本；模型能力true/false/unknown及来源 |
| auth | 显式login、refresh、logout/dispose；通过注入的交互与安全存储处理凭据 |
| catalog/profile | 正常账号scope内模型/限额/路由；各操作profile消费独立核，分页原子发布、generation/账号代际防旧结果覆盖，取消与缓存失败可解释 |
| stream | 统一messages/tools/options/signal/context identity；返回受约束的事件流 |
| events | 文本/思考增量、工具片段/完整调用、usage、终态或固定错误；不能半成功 |
| diagnostics | 固定phase/code/attempt/布尔事实；不暴露token、原始上下文或未知服务错误 |
| lifecycle | owner/epoch、进行中的资源、retire、迟到结果隔离；本地退出和上游撤销分开 |

公共输入不依赖Pi的Model/Transcript/Agent对象；原生sender/parser也不从全局读取Agent状态。Agent依赖只留在adapter包。auth交互/存储/时钟/随机源/transport按真实需要注入；不为了测试而暴露可绕认证或重定向凭据的生产接口。

多供应商统一错误形状，但保留各自分类语义；参数不能表达时明确unsupported，不默默丢弃。模型特有字段使用命名空间和验证后的扩展，不把整个未知服务body塞进公共metadata。

## 3. 凭据与状态所有权

- 每个可信账号登录代际拥有自己的Provider/client state。外部message metadata不能指定或替换owner；账号切换、profile/region变化、retire按明确规则使旧操作失效。
- 不把OAuth令牌当通用API key向任意baseURL发送。SDK只有apiKey槽时，可用进程内短期一次性opaque ticket适配；ticket不是上游secret，生命周期必须与SDK重复取auth行为一致。
- 刷新锁、scope缓存和pending请求不能串账号；安全存储由宿主实现或独立模块提供。独立core不含凭据store，不代表整套认证已独立封装。
- 指定唯一刷新owner：若SDK已在存储锁内刷新，adapter复用它，不再叠加独立account helper；独立host可选用同一核心协议加存储helper。协议、刷新调度和凭据存储是不同责任。
- 存储revision须覆盖删除/退出等变更且不可ABA；取消后的晚到登录/刷新不得复活已失效账号。不合作回调未settle时保留锁/owner，跨进程互斥须另证，不能只靠内存锁。
- 分别规定logout/invalidate、取消活动stream、dispose、删除本地凭据与上游撤销的效果。account退出不自动等于另一个client的流已停止；client.dispose也不必删除宿主凭据，宿主须协调账号切换。
- 连接池、代理和retry state限制在指定provider/client；不改global fetch或全局CA。释放失败与迟到对象要有可审计的owner，不把caller不再等待称资源全部释放。

## 4. SDK接线清单

对**安装版本**读公开API、类型和实际行为，先找官方扩展点；私有bridge确有必要时绑定版本、明确失败策略与替换计划，不修改node_modules。

1. 注册native provider或自定义model调用；阻止默认OpenAI路由吞掉它，核显式model override。
2. 输入转换保留system/history/工具schema、call ID/结果、用户安全约束、能力和生成设置；可逆别名必须能返回原工具。
3. 输出映射流事件、usage、stopReason、错误和取消；工具候选完成事件不是执行许可，须协议认可的完整工具终态与严格schema校验后交宿主审批/执行，不把合法requires_action误拒绝为非completed。真实全工具集/MCP的wire投影不替代原schema；缺宿主validator在发送前拒绝，隔离可变输入，拒绝静默coercion或改写JSON。Provider不执行工具。
4. session/run/invocation由可信宿主入口提供；retry不加逻辑进度，工具后新调用如何计数按契约；title/summary/resume显式标记，缺字段不猜。
5. 明确一个层级控制该次retry episode；用户禁用重试不能被默认native策略覆盖。不要为躲SDK错误正则而改写文案，应有结构化owner/phase协调。
6. hooks/observer只能包装真正sender。核注册路径和默认transport，实际SDK测试不准绕过中间件直接调用core冒充集成通过。
7. 同账号刷新、切模型、reload、compaction、辅助请求和取消各测；SDK可能预取auth后多次复用，不能复用过期或一次性ticket。
8. 控制台/会话错误保持脱敏，SDK内部诊断不能意外复制完整上游错误。
9. core返回目录事实、未知能力/限额及原生usage计数；SDK映射、展示缓存、价格/tier和摘要计价留adapter。未知不当0或免费；后续无效usage快照不能沿用旧完整状态。
10. 迁移期旧模块可用兼容重导出，但须与core共享实际sender和错误类身份，避免双实现或observer识别失效。adapter可组合core子接口，不要求为了统一外观再包一层工厂。
11. cache capability/schema字段存在不证caller消费；目录/profile缓存、prompt cache、warming、连接池分别建策略。输出限制被忽略时不能用极小maxTokens假定预热廉价，应能力门禁关闭额外请求。更换sender后重核连接复用，不把旧Fetch/全局dispatcher结果外推到native transport。

若SDK只允许固定供应商API而无扩展点，明确不能直接插入原生Provider；选择适配扩展或更换SDK需用户决定，不偷偷加反代。

## 5. 分层交付，不把“文件搬家”叫独立Provider

建议包层次：contract、各供应商core/auth、各SDK adapter；是否拆npm包取决于实际复用需求。包接口有版本、exports、运行环境、直接依赖、许可证/来源说明及最小用例。

验收至少包括：
- 检查构建include/入口与发布files/exports：源码存在或间接import已编译，不证明公共index、account、factory也被发射或打包。
- 从实际分发产物提取core及声明依赖，在无目标Agent SDK/TS loader的plain runtime导入公共入口，检查传递依赖闭包；不能靠仓库node_modules偶然补全依赖。外部可选依赖单列。
- 本地HTTP完成文本/工具往返，工具由测试host执行；若保留旧入口，验证sender/错误类仍是同一实例。
- 独立登录/存储接口可接，取消/刷新/账号切换有测试；不能用复制CLI凭据的示例。
- 一个真实SDK适配通过，包括最终sender、hooks/统计、错误/取消及工具循环。
- 另一SDK未测就只称“可适配”，不称任意SDK零配置即插即用；语言/runtime要求明确。
- 安装/升级/回退不覆盖宿主配置，不静默改变模型、隐私或认证方式。

快速路线是先固化契约和一个供应商的最小纵向闭环，再加第二家；不要先造庞大抽象层，也不要以封装完成代替供应商功能或parity完成。
