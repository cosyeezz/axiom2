# 当前KAS anchor01：资源边界假设

static01宽constmagic扫描已失败结束，不改旧driver/gate或增加8magic上限。新问题限定为：当前const中精确公开`KIRO_KAS_NODE_PATH`文字之前是否恰结束一个zstd ustar资源？旧2.35.2存在这类邻接，但当前只作为可反驳假设，失败不宽化offset/阈值。

唯一当前chat同FD完整SHA必须为609480f7c590ea84a53556fdf81e37057594fe8d7ddbec48c0728b3cd73e83a9/436339984B；重解析fat/ARM/const，不套旧VA。const只定位该18B文字（实际字节长度由程序len计算），≤4hits，全hash成功后才用位置。每anchor前最多32MiB且不越conststart；仅该窗内magic≤8，不消费其余constmagic。frame grammar必须给出end恰等anchor，且≤512B解码prefix为ustar；全局唯一才提取three KAS public成员，否则结束。无邻接/多候选不尝试padding偏移。

复用static01纯Decoder/selector源码但不import/执行旧driver。当前case源与manifest先写，CreateNew一运行；CPU15/内部20/alarm22/tool30，target application read≤600MiB（436339984B全hash+≤68KiB头+≤4*32MiB窗口），最多1archive decoded≤256MiB/window≤16MiB、members40000，每selected≤24MiB、总≤32MiB。只own0700TEMP/exclusive本case文件、记录实际读取，OS/loader/whole-author预算unknown。

身份/EOF/checksum/三成员/稳定stat全过才可静态绑定源码；frame adjacency不证明native ptr/len/caller/生效模式/NODE_OPTIONS/自然安装。没有官方/Node/JS执行、模型/HTTP、真实auth/settings读取或系统配置变化；不调用LLDB/dyld_info或启动全Ghidra。若currentSHA变化、cap或其他失败，保留退出，不自动重试。
