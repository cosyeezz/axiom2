# KAS资源指针的限定ARM64语法定位

已有raw JS种子未找到源码，两zstd前缀是native Mach-O，两个gzip前缀更像文档索引。不再盲解压，当前具体缺口为`embedded_tui`资源slice指针/长度。

本项只读当前chat ARM64 `__TEXT,__text`（69216220B）一次，以已知三个资源字面量与两个zstd起点的精确VA为锚，寻找ADRP后8条内同base register的ADD-immediate语法匹配；由LC_FUNCTION_STARTS提供候选包含范围。**不把语法匹配当完整dataflow/xref、运行可达或sender**。可以漏掉经DATA_CONST/fixup/非邻接/间接构造；不扩展全程序分析。

预算一次69.2MB代码扫描+194096B起点表，4MiB chunks+32B overlap，CPU60秒/墙钟90秒；候选cap40，仅存PC/word/解码pointer/函数范围与hash，不执行官方目标、不读凭据/HOME、不联网或解压资源。若定位到少数函数，另设问题/预算后才局部反汇编，禁止直接全局decompile/std闭包。
