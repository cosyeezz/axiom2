# 官方真实轨：功能回答成功，观察验收失败

已执行一次官方CLI 2.179.0真实推理，`official-live-claim.json`耗尽，禁止重跑。证据：[official-live.json](official-live.json)、[合同](CONTRACT.md)、[准备门禁](official-readiness.json)。执行命令 `ulimit -c 0; node docs/evidence/codebuddy-cli-compare-01/OFFICIAL-RUN.mjs --live official-live.json`，runner exit1；其官方child自然exit0。

## 已观察

- 正常现有OAuth路由，refresh0；实际系统代理未启用、Axiom配置direct。不复制CLI认证缓存。
- 真实POST `/v2/chat/completions`恰好1，HTTP200，目标`deepseek-v4.1-flash`、`reasoning_effort:none`、stream=true、tools0、相同自有prompt。
- UA **`CLI/2.179.0 CodeBuddy/2.179.0`**；四身份头存在，request/message identity相等。
- 官方原始gzip body12466B，temperature1/max_tokens128000、usage requested，extra_vars/cache_retention存在，system/user均保留。
- 官方stdout最后assistant精确`AXIOM_CODEBUDDY_COMPARE_01`，assistant数1，child exit0。**因此官方功能回答确实成功，不只是HTTP200。**
- 真实GET geoblock1（200/39B）、catalog1（200/16901B）；无其他真实请求或遥测外发。

## 观察失败与未知

IncomingMessage触发`aborted`后关闭，门禁latch `RESPONSE_ABORTED`。采集器只在`end`时将RAM里的流投影，因而这次没有保存SSE frames/DONE/usage/字节数。不能确定是官方SDK收到完整终态后主动取消，还是上游提前关闭；不得把推断写成事实。也不能把该观察器错误称为官方推理失败。

本case按其原定完整终态验收记Failed，不重复使用claim。原响应与stdout不落盘，进程退出后不可恢复。后续新case的tap必须在EOF/error/abort/close/cancel所有出口保存已收到的有界白名单结构，并离线测试“已收数据后中断”。是否需要新官方观察轨，待独立Axiom文本诊断确定，不盲目重试。

## 清理与边界

activeRequests0、全部3 request closed、child close、parent server关闭/owned临时目录删除、runtime释放、配置不变、token未出现在捕获输出。35次写抑制，2次真实净化环境只读metadata，2个child尝试被拒。exit事件时ownedListeners1，随后由进程退出释放；不声称退出前显式close。

0部署/重启，无全局CA/代理/TLS/默认配置修改。此结果仅证明本次请求及官方精确回答，不证明完整SSE/TLS/认证/重试对齐或服务端不可区分。Axiom同文本真实轨及SDK工具闭环仍待完成，整体不交付完成。
