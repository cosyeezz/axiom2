# 当前 CLI 的 REA 恢复结果

- 正式会话完整重载 `588eaece-68ea-406c-b05b-95df7b1c7a9a`：completed、resumed=true，保留原选择。
- 实际 MCP：REA 6.8.0，alignment aligned；连续状态与设置调用成功。不是仅工具发现。
- 目标：CLI 2.33.1 arm64 Mach-O，196434336 bytes，SHA256 `1061c72fc190e0772ab74202c9ce1acbb83e11e8ab7e6a68a3aa3cf2e41a19d4`。
- native `procedure_info(0x1007d2a98)`：Ghidra 默认全量分析在330秒超时；按返回指引仅将启动预算调整600秒后仍provider_timeout。两次均未产出函数结果。显式host deadline650/690秒，非host取消。
- 诊断有function body overlap修复错误、switch analyzer重启、无映射pcode目标；JVM 2G、无确认OOM。不能据此认定OS或内存根因。
- 两次PID/进程组77897/79825均ESRCH；最终MCP状态无cleanup_pending，activity not_observed，目标仍选中。没有持续运行的该Ghidra组。
- `native-probe-600000-result.json`完整保存。之后store大JSON失败是后处理RangeError；额外transport-error文件名不准确，不表示MCP再次断连。
- 未修改/部署Kiro协议，未发真实模型请求，桌面流错误候选已撤回。
- 不再提升超时原样重试。待改为有界CLI分析路线；OS切换没有性能证据，同一Mach-O与另一Windows CLI构建不可混同。
