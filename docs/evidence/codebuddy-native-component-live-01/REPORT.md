# CodeBuddy SDK真实工具闭环01：失败，已停止

固定codebuddy-cn/deepseek-v4.1-flash/off；独立Agent→Axiom ModelRuntime→原生CodeBuddy，正常既有OAuth，direct。此次不是官方CLI对照，不能称对齐交付。

- 新冻结运行产物及最终03自测/import/零网络预检均通过，源码和构建隔离方法见[合同](CONTRACT.md)/[快照](FROZEN-RUNTIME.json)。未重建或回退并行Kiro工作。
- `node --max-old-space-size=256 HARNESS.mjs --live`实际exit1，自然退出。[claim](live.claim)已消耗，严禁重跑。
- [真实投影](PROJECTION.json)：仅1次模型请求，HTTP200，响应802B；0 refresh/catalog/profile/其他辅助请求，0工具审批/执行。8事件，首轮non-success，harness失败代码`STREAM_TERMINAL`。
- 请求发送前检查model/off、caller context、tool schema、UA/正常OAuth关系、session/run/invocation全部通过；这不是独立wire证明。
- 真实失败来自流/assistant非成功终态，但当前投影未保存core protocolCode/assistant diagnostics，原SSE不落盘，**具体上游或解析原因未知**。HTTP200不能算功能成功，不根据字节量猜错误。
- [失败与清理复核](failure-verification.json) exit0：observer1对，activeBodies/activeAux/forbiddenAux0；Agent settled、provider dispose、refresh settled、dispatcher关闭、TCP资源收敛、配置未变；没有HARD_TIMEOUT。该验证只证明失败记录及清理一致，SDK闭环仍失败。

下一步：执行新的官方CLI同模型有界对照，补齐白名单响应结构/终态与本地diagnostic投影，定位真实差异；若需SDK修复复验，必须新case/合同/claim，不修改历史投影或复用本claim。不以模拟测试或HTTP200替代真实验收。生产源码、默认设置、常驻服务没有在本步骤被修改或重启。
