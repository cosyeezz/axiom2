# SDK02 实发结果：失败，claim 已耗尽

唯一 `HARNESS.mjs --live` 自然退出1；不得重跑。预先通过53项生产回归、build、selftest/import、观察测试02及preflight/readiness，详情见[READINESS](READINESS.md)和[readiness.json](readiness.json)。

## 实际结果

[PROJECTION.json](PROJECTION.json)：1语义轮/1逻辑及物理model、HTTP200、1537B、4个白名单JSON帧；refresh/catalog/profile/其它aux均0。工具审批/执行均0，未发第二请求及下一轮。

请求的目标模型/off/max256、正常OAuth与官方UA、caller system/history、安全工具schema、continuation/唯一invocation检查均通过。收到首帧null legacy/空finish已不再立即报错；随后正确工具名首片段已被识别，diagnostic为 `stage=stream, partial=true, protocolCode=tool`。

确证新兼容缺口：后续现代工具片段 `function.name:""`，id/type缺省，arguments为非空字符串。当前core对已存在工具仍要求任何声明的name与初始name完全相等，因空增量拒绝。可用已保存形状做离线回归；不能据此放宽首次工具名、改名、id/type或schema。

出站保存的4帧均model匹配、finish为空；首工具片段name匹配声明/arguments为空，之后两片段name为空、arguments长度2及4。预读可以超过parser消费位置，不能称4帧全部已解析。观察出口为 **consumer-cancel**，DONEfalse，不是自然EOF；终态及末帧legacy内部仍未取得。

## 清理和边界

observer start/end各1；activeBodies/activeCancels/activeAux/forbiddenAux均0；Agent settled、providerDisposed、refreshSettled、dispatcherClosed、TCP资源回基线、configUnchanged均true。没有部署/重启。

session `d8156d26-4262-4a88-99ad-b985f015cf01`；首run `97f664ab-bf4c-4ac2-b549-de515f33e82c`；第二run已分配但未发送。

当前未完成工具闭环，也未完成修复后的文本/下一轮实发。后续只针对已证空name增量做最小修复与离线验证；若需要新实发必须独立合同/新冻结/新claim，不复用本目录剩余预算。
