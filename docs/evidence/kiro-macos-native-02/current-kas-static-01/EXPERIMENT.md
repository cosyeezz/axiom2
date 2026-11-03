# 当前2.36 KAS嵌入资源的有界静态核定（未执行）

目的：解除“只能拿2.35.2源码设计2.36自然安装”的版本缺口；只确认当前签名绑定产物内的资源身份/JS包元数据与entry静态内容，不证明native实际使用或NODE_OPTIONS继承。不是恢复旧目录caller/无INPUT runtime01/任何已耗尽gate。

## 输入与判据

唯一目标 `/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli-chat`，预期436339984B/SHA609480f7c590ea84a53556fdf81e37057594fe8d7ddbec48c0728b3cd73e83a9（metadata03已独立verify签名）。同一no-follow只读FD，解析当前fat/ARM64 Mach-O头和load commands，找到当前`__TEXT,__const`，**不沿用旧VA或assetoffset**。完整hash+前后stat必须一致，否则失败结束，不追新版本自动重试。

仅在当前const范围扫描zstd magic，最多8候选，保留offset/计数，不落任意字符串窗口。每候选读至多32MiB、只用frame grammar定位压缩帧长度及≤512B解码前缀区分tar与非tar；最多2个tar候选，选出包含三个精确KAS public成员的单一archive，不把frame长度冒称native ptr/len。

精确成员：`node_modules/@kiro/agent/package.json`、`dist/server/acp-server.js`、`dist/server/acp-server.externals.json`。每文件≤24MiB、总≤32MiB，tar≤40000成员、单archive解码≤256MiB、window≤16MiB，严格frame checksum/EOF、frame内无trailing，成员regular/no-symlink/no-path-traversal/no-duplicate。不执行任何解压成员；只保存这三public implementation文件和固定身份/范围结果。

成功必须证明完整目标身份、当前Mach-O范围、zstd framing校验、唯一选中tar完整扫描/三成员SHA及源stat稳定。缺成员/多匹配/超限保留失败，不扩大范围、重复冷跑或按猜测截短帧。三成员若与旧冻结逐byte/SHA相同可复用相同内容的静态对照；仍不能推2.36 native caller同一或自然sender实际发生。若不同，只对明确entry/transport相关代码做后续有限静态核对。

## 资源与副作用

先预存driver与manifest，CreateNew gate，仅一次own Python执行，CPU15秒、独立tooltimeout30秒/内部deadline20秒；只读目标1次全hash及当前headers（≤68KiB）+候选≤8*32MiB，总target application read≤705MiB；计数必须实测，OS/loader另unknown。只新own0700TEMP/本case输出；不安装依赖、不启动官方/提取Node/JS、不读取真实HOME/auth/settings、无HTTP/模型/LLDB/dyld_info/全Ghidra分析。

REA current binary_session已核openfalse/cleanupfalse；当前Ghidra defaultautoanalysis才服务，不为本问题启动全binary分析；inspect_macho可能启动native工具，不借此调用被禁止dyld_info。使用已存在libzstd与有界Mach-O/frame parser，仅静态源提取；旧source04算法可只读复用，旧driver绝不import/执行或改gates。新driver尚未写，正式执行前必须核实现符合以上预算与限定。
