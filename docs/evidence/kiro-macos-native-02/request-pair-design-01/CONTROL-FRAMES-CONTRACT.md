# 固定故障与状态帧（未验证）

[control_frames.cjs](control_frames.cjs)是无IO的纯组件，尚未执行/测试。与已验证candidate-only组件分开；本文件不是正式调用合同或模型门禁。

- KPS1：固定16字节，source为node-http/undici二选一；状态四选一，fault只传是否存在，计数calls/pending≤128、records≤16、candidates/submitted≤4及相互约束；保留位必须零。
- encodeStatus只接受对应adapter schema/coverage、已知fault枚举与恒false proof；只读own data properties，不coerce/getter。它不转发fault原文、任意keys、路径、异常或上下文值。
- KPF1：固定8字节，只表示某adapter发生故障，不虚构当时计数、安装状态或snapshot。source外值、错误magic/长度/保留位/范围拒绝。
- decode只有固定字段与恒false proof；`closed`只表示瞬时adapter状态，绝非进程终止。旧status后面仍可有fault；接收方必须累积sticky fault，不能把后来的无fault snapshot覆盖它。
- snapshot不是认证、身份或自然安装证明，可信内部client才可产生这些帧；消息自己声称node-http/undici或PID都不是peer鉴权。

已新增未测[multiplex_reader.cjs](multiplex_reader.cjs)，不修改既有candidate_frames的多路解析：按4-byte magic分辨KPR1（16B prefix后有界candidate数据）、KPS1（16B）与KPF1（8B）；candidate正文内部的magic样字节不得当控制帧解析。candidate段仅送既有reader，控制段仅送此decoder。先校验长度再转送，控制帧≤32、整流accepted bytes≤1311296、每push≤65536B/1024calls；非法、late、丢失/截断、sink异常只产固定fault。底层candidate reader仍有自己的1024calls限制，分片转送可能先触发它，不能把两层调用数混成一个。remote fault使整个多路reader sticky失败，不接受后续“无fault”洗掉失败；已交付给私有sink的候选须由owner判为不可用于验收并释放引用。

随后才连接0700 own目录下的有界Unix socket/双端RAM比较；目前只有未测纯mux，无server/client、故障relay实测或正式runner。读取/保留上限要分清与内核接收量，不能再把检测阈值或+1检测余量叫精确硬receive cap。原始candidate永不落盘；normal auth只由正常程序不透明使用。所有socket/status/EOF/exit信号须按实际层级报告，不能拼成未证的owner完整终态。
