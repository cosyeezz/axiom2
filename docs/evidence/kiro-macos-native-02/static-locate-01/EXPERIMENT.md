# 官方 Mac 请求序列化缺口 S1

## 单一问题与假设

目标为 environment.json 绑定的官方Mac Kiro CLI **2.35.1** 的 `kiro-cli-chat` ARM64 slice（SHA558b27343a899ea123db9f9edb52c6bb2f65d712fe4c137919feab490bf620f7）。检验：GenerateAssistantResponse请求中`profileArn`是否None时省略、Some时写字符串，及顶层写入顺序。Axiom当前构造conversationState后profileArn；静态观察如不一致需保留差异，不改用户字段取一致。

## 成功判据

1. strings/符号/导入定位序列化候选，literal地址与当前Mach-O映射绑定。
2. 以该文件符号/LC_FUNCTION_STARTS等定界，局部解码xref核到目标字段；区分语法xref、解码xref和运行可达。
3. 只反编译必要serializer及直接caller/callee，核全部bytes、ASM、gap/CFG；明确条件分支、字段顺序/省略规则或证据不足。
4. 无模型调用、凭据读取、官方产物修改、全程序自动分析，不声称真实请求可达或wire。

## 预算和停止

定位阶段一次只读Mach-O元数据/符号/字符串扫描，deadline120秒，输出≤128符号候选、每key≤40字符串命中。必要时追加一次有精确目标literal的ADRP+ADD语法xref扫描；不是全程序反编译。定向阶段至多3个函数，每个≤4096bytes/20秒decompiler；Ghidra启动导入deadline300秒、heap8GiB、CPU4，仅-noanalysis+禁incremental；预算自行提高须说明新增证据目的，不恢复std/allocator闭包。够用即停，若范围/解析/类型模型不确定则保留未知再调整，失败目录不复用。
