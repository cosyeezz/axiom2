# 环境探针01：探针兼容性失败

`/usr/bin/python3 docs/evidence/kiro-macos-native-01/probe_environment.py` exit 1。宿主与基础工具命令均exit 0，随后在可选下载来源元数据读取处失败：系统Python的 `os` 无 `getxattr`。这是探针实现兼容性错误，不是CLI或Ghidra能力失败。尚未执行CLI、未启动Ghidra、0模型请求。

原源码保留不改。下一case改用macOS原生`/usr/bin/xattr`只读可选来源元数据，URL仅保留scheme/host/path；不读取凭据。新case使用独立目录和输出，不在此路径重跑。首次命令结果保存在Axiom工具历史；完整环境报告未生成，不能称该探针通过。
