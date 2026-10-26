# Kiro 目录静态证据

结论、协议对照及线上限制见 [kiro-catalog-audit.md](../../kiro-catalog-audit.md)。这些文件不包含账号凭据、受保护 API 响应或目标运行抓包。

- `rea-*-v2.json`：独立 REA 6.7.0 / Ghidra 12.1.4 的完整 Evidence，UTF-8，未删减原始结果及 limitations。其 `subject` 是**人工派生的局部分析 PE**，不是原始官方 CLI。Evidence 中自动生成的 `authority: shipped-artifact` 不能改变这一边界。
- `rea-*-v2.run.json`：准确命令、仅对子进程设置的环境变量、退出码、时长。临时目录路径仅为本轮复现线索，不是运行时配置或部署依赖。
- [stderr-records.json](stderr-records.json)：四份原始 stderr 均为零字节的大小和 SHA-256 留档；不修改原 run JSON。stderr 为空不表示伪码无警告。
- `catalog-focused-ghidra-manifest.json`：原始 CLI、派生文件哈希、每段原始 offset / VA / SHA-256，以及人为修改的 PE 头。原始 CLI 与派生 PE 不随仓库分发。
- `catalog-focused-seeds.tsv`：人工函数入口及候选标签；不是恢复的符号。REA 记录其 SHA-256 与 seed 应用结果。特别是初始 `candidate_query_serializer` 标签经反编译已被否定：该函数显示 messageId/conversationId，不作为目录证据。目录 query 在 operation 内联路径确认；保留错误候选和原 seed 是为了审计可追溯。
- `serializer.asm.txt`、`origin.asm.txt`、`caller.asm.txt`、`body-wrapper.asm.txt`：Microsoft dumpbin 对**原始**正式 CLI 的定向反汇编，不是 REA Evidence。`caller` 仅覆盖函数前部，完整性不能从文件名推断。
- `origin-source-bytes.json`：从原始 PE 直接映射得到的 origin jump-table 项、目标指令、字符串、业务赋值的 offset / VA / hex。仅是静态字节及解释，不是执行观察。

派生 PE 保留指定代码、数据及原始 VA，删除导入、异常、重定位、签名等目录；外部 callee 缺失，伪码包含类型传播及未恢复 jump-table 警告。初版清除 executable-image 标志后被 REA Windows P0 拒绝，随后另一派生版本仅为静态导入保留该标志并将入口置零。**从未执行两个派生文件，也不得执行它们。** 不应将这些局部结果称作完整官方 CLI 的反编译或端到端网络验证。

## 复现要点

1. 获得文档所列 SHA-256 的合法原始 CLI；先验证大小、哈希和签名。不要把其他版本套用这些地址。
2. 根据 manifest 的四个 `regions` 从原文件提取精确原始区间，保持 image base / RVA。按 manifest 重建分析 PE 头并核对派生哈希；种子文件保持原字节。
3. 在隔离临时目录准备经完整官方 SHA-256 验证的 Ghidra 12.1.4，以及本轮所用 Java 25.0.2；不修改 Axiom 的 REA 配置或系统 PATH。
4. 仅对独立子进程设置 `GHIDRA_INSTALL_DIR`、`JAVA_HOME`、`REA_GHIDRA_SEED_FILE`；`REA_GHIDRA_DISABLED_ANALYZERS=Non-Returning Functions - Discovered`。使用已安装 REA 6.7.0 的 `node scripts/rea.mjs decompile <analysis-only.pe> <VA> --provider ghidra --format json`，四个 VA 见种子文件。保留完整 stdout / stderr、退出码和 Evidence。
5. 不执行目标、不读取真实凭据、不请求真实受保护 API。REA 每次命令关闭其临时 Ghidra 会话；本轮没有部署或重启 Axiom。
