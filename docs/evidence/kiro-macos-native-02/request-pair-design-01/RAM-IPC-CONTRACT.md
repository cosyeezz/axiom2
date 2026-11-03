# 私有 RAM 配对传输：候选帧组件合同

这是新私有比较通道的 **candidate-only** 组件，不是 live collector、完整 IPC、owner 终态协议或模型执行门禁。旧 Failed snapshot 协议不恢复。已验证的 adapters/body_pair 不修改。

## 唯一用途

冻结的内部 controller/sink 之间传递原始候选值，接收端只在 RAM 比较。不得写入文件、stdout/stderr、日志、异常消息/stack、input hash/HMAC 或诊断 dump。组件导入/调用无 IO；同步可信回调才能接收 raw packet。非可信 hooks、Proxy、修改全局 intrinsics 不在支持范围。

完整通道尚需：0700 own TEMP 内的单次 Unix socket、接受数/时间/总字节限制、固定 fault/status relay、进程与流退出证据、失败后释放与收尾。路径权限/peer自报PID不证明自然官方sender；socket EOF、closed snapshot和direct child exit也不能拼成全应用终态。认证只由程序正常机制不透明使用，不在agent侧读取authstore/Keychain。

## 候选帧

16字节固定prefix：ASCII KPR1，header-boundary code（1 Node缓存、2 Undici H1 prefix、3 Undici H2文本），adapter ordinal（1–4），两字节零保留；big-endian uint32 header字节数、body UTF16 code-unit数。随后原ASCII header bytes与body UTF16LE code units。

header必须符合既定候选过滤、ASCII/64KiB/label一致。body保留完整primitive JS字符串，最大256KiB UTF8及262144 code units。UTF16LE只为跨进程无损保存原字符串（包括孤立surrogate），**不是把HTTP wire编码改为UTF16**。之后的provided-UTF8比较仍由body_pair定义；不能静默替换surrogate、normalize JSON或删字段制造相等。完整输入必须精确耗尽帧，拒绝未知标签、保留位、截断/多余字节及不支持的值。

每单端reader：至多4候选、正文UTF8合计512KiB；Node/Undici各自ordinal连续（Undici H1/H2共用ordinal），不重排。最大总frame bytes = 4×16 + 4×65536 + 2×524288 = 1310784。每push至多64KiB、至多1024次push；固定最大frame buffer589840B，不能按未验证长度分配。超限/非法/重复/reentry/sink异常为fixed stickyfault，原值不投影。snapshot只有固定schema/state/fault/counts和恒false证明标志，不含原值。

`finish()`仅表示本receiver没有未完成的candidate帧；不是上游无遗漏、未丢fault、observer卸载、进程退出、完整请求或server receipt。finish后push仍产生sticky late fault。引用释放或局部buffer清零不等全内存物理擦除。

## 下一步验证边界

先对纯codec/fragment reader做一次own synthetic验证：原值roundtrip（含非ASCII/孤立surrogate）、截断/额外字节、labels、限额、分片/合并、ordinal、sink异常与late/reentry；只输出fixed结果。不重复旧adapter/body_pair测试。通过后再实现真正的Unix socket与fixed fault/status传输；**candidate-only编码器通过也不授权发模型**。
