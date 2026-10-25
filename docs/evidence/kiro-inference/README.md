# Kiro 推理静态证据

本目录保存本机正式 Windows CLI 2.12.0 的 **PE 字节/定向 dumpbin 反汇编**，以及固定参考版本的协议研究。没有执行第三方项目、调用真实受保护接口或读取真实账号；没有新开 REA 会话。先前目录阶段的 REA/Ghidra 四函数结果仍在[目录证据](../kiro-catalog/README.md)，不混作推理证据。

## 入口与完整性

- [操作与字段报告](operation/report.md)、[结构化报告](operation/report.json)：target、JSON 序列化调用链、字段原始偏移及限制。
- [操作 dumpbin 执行记录](operation/dumpbin-runs.json)：六段命令与退出码，对应 `operation/*.asm.txt`。
- [端点映射与 Streaming 配置数据流](endpoint/endpoint-followup.md)：证明 region → runtime URL → resolver → Streaming config/client，明确覆盖与 q fallback，以及未恢复的异步操作链。
- [端点执行索引](endpoint/dumpbin-runs.json)、独立的 `endpoint/*.run.json`：保留研究过程的全部切片、脚本与候选，不只筛选有利片段。
- [防御措施对照](defense-notes.md)、[AWS 流与事件对照](stream-notes.md)：参考来源与行号。
- [静态文件 SHA-256 清单](manifest.json)：覆盖随研究复制的 79 个文件，不含本说明、清单自身或后续 `validation/` 验证记录。JSON/日志均保留原内容，未把研究环境路径改写成仓库路径。
- [最终测试、构建与完整性复核](validation/README.md)：隔离 mock 结果，不等于线上验收。
- [实现及策略说明](../../kiro-inference-audit.md)：固定公开参考 commit、采用与拒绝的策略、测试范围及未验证项。

原始 CLI：528,630,968 字节，SHA-256 `0ff1d24eea11aa2e244524d635e1cfc8f9820522f4c5bc192fb99590d909320a`，分析前后相同；身份/签名及隔离 `--version` 依据原目录阶段记录。未在仓库存放原 EXE 或执行分析目标。

## 如何复核

1. 先核对原始目标大小、签名及 SHA-256；地址以 `0x140000000` 为 image base。报告中的指令地址是 VA，字符串数字是**原始文件偏移**，不是 RVA。
2. 使用报告/`*.run.json` 给出的 Microsoft dumpbin 参数，对原文件只读反汇编；检查指令中的 RIP 相对地址、目标字符串长度、结构体复制与调用链。不以原始字节扫描候选当作已解码控制流。
3. `operation` 下包含定位脚本及六段反汇编；`endpoint` 下包含补充扫描、常量结构、配置键表及相关片段。脚本记录的是原临时输出目录；重跑时使用新的隔离目录，不修改任何正式配置或共享 REA。
4. 所有 dumpbin 调用记录为 exit 0。端点研究另有一次内联 Node 脚本引号失败，改用独立 `keys.cjs` 后成功；详见后续报告。它不是目标程序失败或测试结果。

文件名仅为分析者标签，不是恢复的 Rust 符号。尤其 `endpoint/streaming-setter.asm.txt` 是早期暂名候选，真正引用的 endpoint setter 是 `endpoint/endpoint-setter2.asm.txt`。所有初步候选/否定路径仍保留；不能把一次字符串引用称为完整操作路由。

**边界**：没有证明所有 GenerateAssistantResponse 必经 runtime，没有恢复活动账号/profile 的全优先级、HTTP/auth 的当前产物完整链或最新 stable 2.34.0；没有验证服务接受性。历史官方源码和 kiro.rs 支撑实现选择，不替代真实服务联调。
