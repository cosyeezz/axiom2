# 协议与证据矩阵

按供应商/版本/认证模式/模型分别建表，不将“同一家”当一个协议。字段来源至少区分 caller、auth、catalog、logical run、physical attempt、server。

状态只用：观察 / 推断 / 未知 / 不在范围。对照结果只用：匹配 / 差异 / 未比较；不把未知当匹配。

## 链路矩阵

| 项目 | 官方契约与来源位置 | 我方映射/文件 | 验证层级与case | 结果与限制 |
|---|---|---|---|---|
| 注册/client/scopes/grants/expiry | [填] | [填] | [填] | [填] |
| PKCE/state/redirect或device轮询 | [填] | [填] | [填] | [填] |
| token解析/保存/刷新/轮转/logout | [填] | [填] | [填] | [填] |
| profile/region/目录/分页/权限 | [填] | [填] | [填] | [填] |
| 模型ID/alias/feature选路/能力声明与实际发送 | [填] | [填] | [填] | [填] |
| thinking enum/default/required与缺省/undefined/off/预算单位 | [填] | [填] | [填] | [填] |
| 工具全集合/MCP、wire投影与原schema严格校验 | [填] | [填] | [填] | [填] |
| system/history/tools/images/reasoning | [填] | [填] | [填] | [填] |
| method/path/query/JSON序列化 | [填] | [填] | [填] | [填] |
| headers/UA/privacy/profile/attempt | [填] | [填] | [填] | [填] |
| 额外宿主注入剥离（UA/x-*/payload hook/ID/路径）与caller保真 | [填] | [填] | [填] | [填] |
| HTTP/连接/代理/redirect/TLS | [填] | [填] | [填] | [填] |
| 帧/delta/工具参数/合法工具终态/incomplete/usage | [填] | [填] | [填] | [填] |
| 未知事件/refusal/opaque接收与请求侧历史回放 | [填] | [填] | [填] | [填] |
| 安全失败诊断与成功路径命中证据 | [填] | [填] | [填] | [填] |
| 目录/profile缓存、prompt cache、warming与连接池消费者 | [填] | [填] | [填] | [填] |
| 错误分类/读取上限/脱敏 | [填] | [填] | [填] | [填] |
| retry/预算/hint/delay/adaptive/owner | [填] | [填] | [填] | [填] |
| 取消/late response/账号切换 | [填] | [填] | [填] | [填] |
| title/summary/telemetry辅助请求 | [填] | [填] | [填] | [填] |
| 恢复/compaction/中断工具历史 | [填] | [填] | [填] | [填] |

## 字段与身份子表

| 字段/ID | 生成者 | 类型/单位/省略/顺序 | 生命周期/重用条件 | 关联不变量 | 来源 |
|---|---|---|---|---|---|
| conversation/root | [填] | [填] | [填] | [填] | [填] |
| run/continuation | [填] | [填] | [填] | [填] | [填] |
| invocation/attempt | [填] | [填] | [填] | [填] | [填] |
| tool call/result/response | [填] | [填] | [填] | [填] | [填] |
| [其他必要字段] | [填] | [填] | [填] | [填] | [填] |

## 错误与重试子表

| phase及condition | terminal/retryable/未知 | owner与总预算 | hint/backoff/状态更新 | 是否已有输出或副作用 | 依据与负例 |
|---|---|---|---|---|---|
| [填] | [填] | [填] | [填] | [填] | [填] |

注意server reason可能优先于HTTP status；前置HTTP失败与成功Response之后的流错误分开。disabled/zero/cap、账号epoch及cancel如何传播必须写。仅有CLI明确handoff证据才单列compaction恢复例外，不泛化partial overflow重放。

认证模式/账号条件不同比较只作参考；schema字段存在不证caller消费。能力声明、兼容政策、实际wire、执行效果分层记录，局部精确模型补丁不记为完整实验策略。

## 来源与差异决策

| evidence ID或本地文件 | 版本/哈希/位置 | 观察或推断 | 完整性/覆盖 | 未知如何补证 |
|---|---|---|---|---|
| [填] | [填] | [填] | [填] | [填] |

| 差异 | 功能缺陷/安全保守差异/待决定/缺证 | 是否阻塞所选目标 | 下一动作 |
|---|---|---|---|
| [填] | [填] | [填] | [填] |

动态值不要全删后diff；比较类型、位置、长度及跨请求关系。敏感相等检查在RAM完成，表内只记谓词；独立OAuth凭据不要求字节相同。
