# CodeBuddy 2.179.0：原生组件与真实对照

## 结论

已完成独立原生核心、Pi薄适配及 **`codebuddy-cn / deepseek-v4.1-flash / off` 的真实SDK工具与下一轮闭环**。官方CLI也已真实执行并返回精确文本；两侧指定模型/off/默认UA及流字段已有实际对照。

这不是完全等价证明：官方与SDK最终成功场景的system/prompt/工具/输出预算不同；官方观察case仍保留失败状态。没有部署、重启或UI验收，不声称服务端不可区分。

## 真实执行记录

| Case | 结果 | 证据与限制 |
|---|---|---|
| 官方文本01 | CLI exit0，精确marker；观察失败 | [报告](evidence/codebuddy-cli-compare-01/OFFICIAL-REPORT.md)。1model/200，abort时未保存SSE；不可恢复 |
| Axiom文本01 | 1model/200，流解析失败 | [报告](evidence/codebuddy-cli-compare-01/AXIOM-REPORT.md)。同用户文本但系统上下文不同；旧投影未记录null/空值，不能事后猜实际值 |
| 官方文本02补证 | CLI exit0，精确marker、stop+DONE；观察仍失败 | [报告](evidence/codebuddy-cli-compare-02/REPORT.md)。4849B/13帧，确认null legacy及空finish；末帧legacy为object但内部未记录，严格观察器拒绝 |
| SDK工具01 | 1model/200，终态失败、工具0 | [报告](evidence/codebuddy-native-component-live-01/REPORT.md)。旧原流及诊断不足，精确根因未确认 |
| SDK工具02 | nullable帧通过；工具后继name空串被拒 | [报告](evidence/codebuddy-native-component-live-02/REPORT.md)。1model/200/1537B；已有工具name空增量成为可复现缺口 |
| SDK工具03 | **2语义轮、3model/200、1工具、两次精确文本，通过** | [报告](evidence/codebuddy-native-component-live-03/REPORT.md)。tool_calls/stop/stop，三次DONE+干净EOF，宿主审批钩子1次，完整历史及身份、资源清理通过 |

全部claim已耗尽，不能重跑。官方两次各有geo/catalog GET各1；SDK各case辅助请求均0。真实refresh均未触发，不把合成refresh覆盖称真实刷新验证。

## 匹配、差异、未知

| 维度 | 实际匹配或支持 | 明确差异与未知 |
|---|---|---|
| 基准 | 官方macOS CLI2.179.0，`--print`实际headless；Axiom固定CN/Flash | 不包含WorkBuddy桌面。旧full bundle静态窗口不能代替headless执行证据 |
| 模型/思考/路径 | deepseek-v4.1-flash、reasoning_effort=none、POST /v2/chat/completions、stream+usage | 不外推其它模型/effort或全部配置 |
| UA/认证 | 两侧请求边界检查 `CLI/2.179.0 CodeBuddy/2.179.0`、Bearer；已有账号正常路由 | 官方custom-token注入仅RAM；Axiom继续正常Pi存储/唯一刷新owner。不是独立wire/TLS采样 |
| 身份 | conversation/session、conversation-request/run、request=message/invocation关系 | SDK03显式身份已验；不证明常驻worker自动注入/所有恢复场景 |
| 流默认值 | 官方中间null legacy/空finish；Axiom同类字段及工具后继空name实际通过 | 官方末帧legacy内部未知；Axiom03才观测到name/arguments均空串，不能反推官方 |
| 成功终态 | 两侧都有stop+DONE；SDK工具额外tool_calls | 官方随后aborted→error→close，不能报自然EOF；Axiom三次干净EOF。官方取消分类不用于放松Axiom工具安全 |
| 请求内容/传输 | 均保留各自真实caller上下文，不删安全策略制造相同 | 官方内置system、gzip、max_tokens128000、temperature1、条件extra_vars/cache_retention；SDK自有system/history/tools、max256。不是同字节/同token预算比较 |
| 工具 | SDK03严格schema+完整终态后宿主审批/执行1次，call-result配对、下一轮历史通过 | 官方本次tools禁用，无真实官方工具闭环；审批为宿主钩子，不是人工UI审批证明 |
| Retry/资源 | Axiom无native自动重试，三个物理请求均按预算；清理完成 | 不实现官方完整retry/keepalive；scope外HTTP/TLS/账户行为不宣称一致 |

## 已交付修复和验证

1. null/安全空legacy占位、null tool_calls、空非终态finish兼容；非空legacy/未知键仍拒绝。[修复02报告](evidence/codebuddy-native-fix-02/REPORT.md)。
2. **仅已存在且已验证工具**的后继空name视为无新增；首次空名/变ID/坏type/改名/nullname及schema仍拒绝。[修复03报告](evidence/codebuddy-native-fix-03/REPORT.md)。
3. 候选必须完整stop或tool_calls、DONE、干净EOF、严格无coercion，再交宿主；组件不执行工具、不刷新、不重试。
4. 最新 **41core+14SDK=55测试**通过，完整tsc/Vite/server build exit0。旧session重试覆盖保留，不算本轮重跑。
5. SDK03冻结1089文件/62关键产物，selftest/import/8项观察门禁/preflight/readiness及真实verification通过。相对02关键产物仅client.js变；node_modules链接不等全依赖不可变。

接口、分发和支持范围见[组件文档](codebuddy-native-component.md)及[协议矩阵](evidence/codebuddy-native-component-01/PROTOCOL-MATRIX.md)。无额外依赖或公共API变化；历史分发闭包结论沿用，最新公共组件/SDK及build验证了修复后的实际emit。未重新执行pack/install生命周期或发布。
