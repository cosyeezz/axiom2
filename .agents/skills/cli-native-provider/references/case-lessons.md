# 个案提炼：方法可复用，参数不能照搬

本页用历史Kiro与CodeBuddy接入说明检查点，不把它当新供应商规格。CLI版本、UA、端点、预算、scope、进程地址和授权均须重新绑定；WorkBuddy/CodeBuddy等相近产品名也不能直接视为同协议。

新接入/排障先读[快速路径](fast-paths.md)，需要Kiro认证、目录、Schema、流、缓存、harness的因果和版本替代关系再读[Kiro版本化教训](kiro-lessons.md)。本页保留跨供应商检查点和原报告索引，不把历史待办恢复为任务。

## 已发生的高价值教训

| 问题 | 应带入新接入的动作 |
|---|---|
| 推理先按旧AWS eventstream实现，指定模型实际走Responses/SSE | 绑定精确模型路由，检查真实serializer/parser，不以厂商统一名猜全目录协议 |
| 文本成功但工具requires_action被误拒绝 | 逐项核终态与工具条件；工具终态不能由文本路径的规则外推 |
| 原生单测正确，SDK实发却变成Fetch/HTTP2及补头 | 检查observer是否替换sender，测试实际SDK注册与中间件路径 |
| 删除显式UA仍出现默认客户端UA | 验证最终传输；对齐值须版本绑定，不把去品牌当对齐（首要准则第1、4条） |
| Pi/caller传入的UA与`x-*`头可能透传到Kiro请求 | 发送层按CLI白名单从零构造并覆盖UA；测试注入宿主头后最终请求不含它们 |
| 新普通逻辑轮continuation已实现，但恢复/辅助路径未知 | 区分run与HTTP请求；同轮稳定/新轮变化需要分别验证 |
| 官方重试有共享adaptive state、两层等待、特殊refund | 不凭attempt头实现循环，沿factory/cache/token/caller核全策略 |
| Pi会话retry叠加原生retry可能倍增 | 明确单一retry owner；成功Response后错误不能被外层重放 |
| Smithy构造器传options会丢函数预算 | 对实际依赖版本做小probe，不只看类型/上游文档 |
| caller取消后SDK仍在acquire | 旧owner保持到settle，隔离晚结果，不能race后立即放锁 |
| 原生核心脱离Pi，不等完整认证组件已独立 | 依赖图验证core；另验auth/store/catalog和SDK adapter |
| 已编译被引用模块，却遗漏公共index/account/factory | 验实际发射与包内闭包，再用无Pi/TS loader的plain Node导入分发入口 |
| SDK已有锁内刷新，又考虑叠account helper | 保持唯一刷新owner；分别验证logout、流取消、dispose和凭据删除 |
| 工具片段完成后仍可能出现坏终态，validator也可能coercion | 候选事件不执行；完整成功终态+严格schema+未改写原始参数后才交给host |
| npm10.9.8 pack带dry-run/ignore-scripts/offline仍执行prepare/build | 这是该版本观察；审阅实际生命周期/日志，不把flags当隔离保证或直接推广到所有npm |
| Pi1.4包仅提供import条件，require.resolve选不到入口 | 按安装版exports使用ESM入口；先验证加载，不误判为Provider或认证故障 |
| 测试会话agent.model会写全局默认 | 先核副作用；可用隔离SDK进程显式选模型，但不能宣称现有服务已部署 |
| 测试host显式传入continuation并成功 | 只证明该helper接线与身份关系，不证明UI worker自动注入 |
| 全包native分析超时，minified bundle全文/AST爆输出 | 先精确定位、有界窗和必要caller/callee，summary只管显示不管分析 |
| hook ready/TCP owner/pcap成功被误当HTTP正文证据 | 按证据阶梯写结论，未知保留；先非模型观察fixture再live |
| 失败入口exit0、空集合all通过、latecallback翻绿 | 检查权威结果/schema/非空集合/清理终态，不能只看退出码 |
| 官方已精确回答，但观察器只在end保存，abort丢掉SSE | 功能与观察验收分开；全部退出保存有界白名单，不为补证反复盲发 |
| await reader.cancel期间并发pull.done先把出口记成EOF | 先锁存取消意图，另等底层cancel计数归零；DONE、EOF和cancel分别记录 |
| CN流的null legacy、空finish及现代工具后继空name被过严拒绝 | 用实际字段形状建立修前回归，仅最小no-op兼容；首次工具身份/改名/schema/完整终态仍严格 |
| 官方与Axiom均成功却system/工具/预算不同 | 报告功能与字段匹配，保留差异；不把不同成功场景称同输入/字节等价 |
| Opus5.5只凭xhigh一条短回复就称已修；用户high仍间歇失败，5次简化prompt未复现，改用用户原输入“你好”首发即复现 | 验收覆盖用户精确模型/思考档位/输入；相近档位或简化prompt成功不关闭问题（首发复现是观察，因果未证） |
| Responses白名单按先前模型捕获建立，Opus high多出`response.reasoning_part.added`；失败诊断无事件名，只能等复现 | 事件集按模型与思考档位分别取证；未知事件失败提前带过滤后的type名（不含payload）；新事件按CLI语义接入。（历史“带内容即拒绝”的猜测已被KAS证据替代：reasoning_part直接忽略；未知事件、incomplete、refusal、encrypted_content已按0.66.70统一，见下方企业报告及[Kiro教训](kiro-lessons.md)第4节） |
| 只在失败时记录事件名，修后成功无法证明走到新分支 | 修后实测要能证明新路径命中（如有界白名单事件计数），否则报告“功能成功，新分支命中未证” |
| 测试结束对测试会话执行agent.model恢复全局默认，把该会话显示也改成另一provider，用户误判请求走错 | 用单独空会话恢复默认；读回测试会话selection、全局默认和UI显示，再向用户报告 |
| 后台PID被他处重启更换；另一次重启早于dist生成，加载旧代码 | 实发前核当前PID、启动时刻晚于产物mtime且产物含本次改动；不沿用记忆中的PID |
| Opus high unknown-event：只试一次从kiro-cli Rust主程序strings提取事件名，失败后改靠Axiom多次实发等复现；后来在`~/Library/Application Support/kiro-cli/kas/<版本>/`捆绑的KAS JS中找到解析函数，发现reasoning_part被CLI直接忽略，我们推测加的校验反而多余 | 修复时先查CLI对同一事件/错误的处理：静态落空换路线（格式inventory、公开源码、CLI自带日志），授权后用CLI自有登录按相同条件跑基线；修复依据写明来自CLI哪一处 |

## 本仓库可核的实现与边界

- [Kiro Responses实现与live范围](../../../../docs/kiro-responses-implementation.md)：限定模型/普通轮、HTTP/UA与工具闭环的证据；不是整个OAuth或服务端不可区分。
- [原生重试设计](../../../../docs/kiro-native-retry-design.md)：设计/离线probe完成不等生产retry启用；不要因为技能举例就恢复该待办。
- [设计probe报告](../../../../docs/evidence/kiro-macos-native-02/responses-retry-design-05/REPORT.md)：4项通过沿用+1项修正oracle后通过，初始加载/断言失败保留。
- [独立组件接口与接回](../../../../docs/native-provider-component.md)：公开core与Pi薄适配、唯一刷新owner和工具执行边界；Pi适配可分别组合client/auth/catalog，不必调用聚合factory。
- [组件离线交付](../../../../docs/evidence/kiro-native-component-01/REPORT.md)：32文件379不同测试及95项受影响复测（不相加）；21模块分发闭包、入口遗漏与pack脚本观察。不是最终整轮重跑或完整安装生命周期。
- [组件真实SDK验收](../../../../docs/evidence/kiro-native-component-live-01/REPORT.md)：Kiro/DeepSeek3.2/off、Pi1.4，2输入/3模型HTTP200/1工具/1OAuth刷新，工具回传及下一轮历史通过；默认/代理/服务未变。限定独立进程功能，非UI部署、新登录、AWS其他模型、任意SDK或TLS/wire等价；不执行其已耗尽harness/claim。
- [Kiro企业目录与Opus5.5 high修复](../../../../docs/evidence/kiro-enterprise-validation-01/REPORT.md)：chat-live-10按用户原条件复现`reasoning_part.added`，后按KAS 0.66.70统一未知事件/incomplete/refusal/encrypted_content，chat-live-13（kiro/opus/high）通过且诊断证实命中忽略分支；incomplete/refusal/encrypted_content的live形状未捕获。
- [CodeBuddy真实对照与边界](../../../../docs/codebuddy-native-parity.md)：CLI2.179.0/headless文本功能成功与观察case失败分开；两处最小字段兼容修复，SDK03固定Flash/off真实2轮/3模型/1工具通过。不同system/prompt/预算，不称完整wire等价，所有claim耗尽。
- [旧技能完整归档](../../../../docs/evidence/cli-native-provider-skill-01/legacy/kiro-native-parity-evidence/SKILL.md)：原始Kiro/Windows深层教训与来源指纹。它是历史资料，不是现行执行计划；旧case/claim、失败和放弃状态不恢复。
- [迁移说明与验证](../../../../docs/evidence/cli-native-provider-skill-01/REPORT.md)：旧路径→原样归档的对应关系。

移出本仓库使用时，这些外部案例链接可能不可用；只影响案例追溯，不影响主流程、四个模板和通用参考。不要为补齐案例而运行旧脚本或下载官方二进制。需要特定旧结论时先核完整原件、版本和原观察边界；不能把摘要变成新的运行授权。
