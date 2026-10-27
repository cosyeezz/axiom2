# 会话费用准确性核查

## 核查结论

会话卡片显示当前会话自己的账务，不包含子 Agent；费用弹窗的家族总计包含子 Agent。两者并非同一范围，不应直接要求数值相等。主 Agent、子 Agent、工具、原生/后台压缩、记忆查询/整理及标题生成都有计费来源；历史分支、失败及重试不应因最终回复成功而排除。

本次会话原始已记录费率为输入 `$2`、输出 `$10`、缓存读取 `$0.10` / 百万 Token。缓存输入单价是普通输入的 1/20，大量缓存会令金额明显低于“全部按普通输入价”计算的预期；这本身不是漏算证据。该费率仅是本次核查记录，不是通用模型价。

发现并修复的路径：

1. **非 Kiro 原生压缩失败尝试漏记**：Pi 最终摘要 usage 不能保留所有失败重试，以及 split 摘要前半成功、后半失败的用量。新增逐逻辑 stream 尝试采集，只补 checkpoint 未覆盖的尝试；未知响应不冒充零消费。
2. **缺价无法估值**：维护精确型号的通用原厂公开价格表；完整 Token 才可补估，并明确标记“含估算”、估算子额、来源和核实日期。已有请求正金额保持原值；不能用当前价覆盖已有历史账务。
3. **成功原生摘要的模型身份**：新 checkpoint 保存版本化的逐请求模型/usage 元数据；核对其与 checkpoint 严格相符后逐请求处理，避免 split 汇总 Token 误触 Gemini 长上下文阶梯。混合“已记费＋缺价”也分别处理：已记费金额不变，另一次独立估算或保留未知，不能用合并后的正金额掩盖缺价。旧摘要没有身份仍保持未知。
4. **台账文件变动导致数据库账单被误跳过**：文件末尾校验失败时，暂存数据和已应用压缩的去重集合一起回滚，使独立可核对的数据库 billing 仍保留。

## 公开价口径

实现：[公开价格表](../app/src/server/public-model-pricing.ts)、[费用解析](../app/src/server/usage-cost.ts)、[原生压缩采集](../app/src/server/native-compaction-usage.ts)。

当前覆盖 DeepSeek Flash/Pro、GLM-5.3/5、GPT-5.3-Codex、Claude Sonnet/Opus 4.6、Gemini 2.5 Flash/Pro。精确型号、别名、官方 URL、核实日期及价格全部保留在表内；[详细价格与计费规范](provider-usage.md#缺价记录的公开参考估算)是维护说明。

`estimatedCost` 是 `knownCost` 的子集，不是需要再叠加的一笔费用。公开价仅为原厂参考，渠道折扣/加价、订阅、峰谷、优先档位和额外工具费都可能改变实际扣款。历史缺价补估不代表当时价格。缺 Token、模型不明、缓存写价不明、未知失败请求继续显示未知。

## 不能保证还原的消费

- 历史未保留或未上报的 Token、底层 transport 内部隐式网络重试，以及供应商实际扣款。
- `navigateTree` 分支摘要的失败重试不触发 compaction 事件，本轮原生 guard 不覆盖。
- 原生补账在操作结束时追加，不具备进程崩溃原子性。
- 工具记录没有自身模型身份时，不借主 Agent 的当前模型猜价。

因此，修复提高本机可核对账务的完整度，但不把本机统计宣称为官方账单的完全复刻。

## 验证与生效范围

本轮使用临时数据根、mock 模型响应和本机 Chrome，不写生产 SQLite、不改用户模型价格，不重启后台。最终构建输出到 `/tmp/axiom-public-price-build-verified` 和 `/tmp/axiom-public-price-server-build-verified`，没有覆盖生产 `dist`。

最终验证：

- **139 / 139 后端回归通过**：公开价、历史费用保留、未知用量、混合已记费/缺价 split、逐请求 Gemini 阶梯、Costs/SQL 聚合及来源、文件变动回滚、原生与 Kiro 压缩去重。
- **三组真实 Chrome UI 通过**：费用卡片（含估算标记和来源）、费用弹窗、模型用量页；覆盖会话范围隔离、未知金额、分页筛选、刷新/重连和 320px 等视口。UI fixture 不进行真实模型推理、OAuth 或消费，主账号配置不变。
- **类型检查、前端和服务端隔离构建通过**。仅有前端部分 chunk 大于 500 kB 的构建提示。

[精确命令、退出码及限制](evidence/cost-accounting/verification.json) · [后端日志](evidence/cost-accounting/backend-tests.log) · [类型与构建日志](evidence/cost-accounting/type-and-build.log) · [UI 结果](evidence/cost-accounting/cost-indicator-results.json) · [估算标记截图](evidence/cost-accounting/public-estimate-popover.png)。三组 UI 日志也保存在同一证据目录。

源码修复、隔离测试通过与运行后台已部署是不同状态；**本次没有重启或部署后台，不能认为当前运行实例已经生效**。
