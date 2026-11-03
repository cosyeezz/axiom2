# 新冻结2.35.2 KAS候选完整帧实验

假设：新版已重新绑定的__TEXT,__const内，slice-relative75706006、22001675B候选（绝对290729622）是完整zstd tar，可选择同三public成员。该范围来自旧线索在新section内验证，头部仍为zstd，但新compressed SHA不等旧版；**目前不是新native pointer/caller使用或可达证据**。

输入：只读新冻结chat副本，不再访问live。完整SHA `7f684ad558ea35de830086a6d44f3eff4835ce381b70c861f365c8842729b94f`、413051920B；新ARM64 offset215023616/198028304B，const slice offset73916416/112409560B。候选已在新section边界内并经同FD hash：`463c215fb7f1d6b75416d6745dd52f69ad98a245863b171b432150d49bbdc997`（identity-rebind-01/resource-candidate-01原exit2保留）。

从source02已21合成测试通过的自写extractor复制，仅改输入snapshot path、完整SHA、TEMPprefix；先AST核精确三常量差异，其余算法/selector/oracle/预算不变，不重复未变算法已过测试。选择仅acp-server.js、acp-server.externals.json、package.json；单文件64MiB/总128MiB，window16MiB、decoded512MiB、tar40000成员，CPU120s/内部170s/工具180s、不宣称AS硬限。1MiB同FD完整hash后流式解压，同FD前后stat稳定，tar结束后继续至frame EOF/checksum且无压缩trailing；不自动放宽长度/预算。

唯一一次main：`/usr/bin/python3 -I -B docs/evidence/kiro-macos-native-02/v3-kas-source-03/extract_source.py`。失败保留原件，不重跑本case取绿。成功只证明这个新版候选完整解包及三成员SHA；需比较三文件与旧版后，才决定可否复用相应旧静态实现。0目标/JS执行、0依赖安装、0模型、0真实HOME/settings/auth读取；不import/require官方成员或依赖。
