# 独立KAS slice的有界zstd前缀分类

前置：ASM定向找到fileoff290729622/22001675B slice；header143B实际读回证实zstd及path为`node_modules/@kiro/agent/dist/server/acp-server.js`。这些是新定位资源，不是此前两个native frame；此前研究不构成“整个产物只有两个zstd”的穷举证明。

本项只为判断archive格式/前缀索引：已装libzstd（先核API），最多读取压缩前缀1MiB、输出64KiB到内存，不写资源、不执行代码；输出最多12个可完整解析tar header路径/尺寸及校验，不输出成员正文。CPU/墙钟5分钟；明确frame未EOF时checksum未知，不冒充完整校验。若为tar且有真实server包线索，下一项另设预算流式读取已定位22MB资源、只提取必要public源码，而非执行归档或全程序分析。
