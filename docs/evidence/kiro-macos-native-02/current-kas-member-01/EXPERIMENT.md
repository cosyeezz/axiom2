# 明确frame的当前public成员核验

消费[anchor01结果](../current-kas-anchor-01/RESULT.json)中已定位的**单个**静态frame：当前chat SHA609480f7c590ea84a53556fdf81e37057594fe8d7ddbec48c0728b3cd73e83a9/436339984B，fileoffset302659302、len21999416、end324658718，frame grammar及首512B ustar候选已观察。anchor01第二窗cap失败和全局唯一性未证保留；本case不扫描该窗/其他magic、不提高cap，不把前一case改成功。

本问题仅为该已知frame内三精确public成员身份及完整checksum/EOF。sameFD nofollow全目标SHA+前后stat必须同，frame精确长度必须由ZSTD_findFrameCompressedSize再次与给定长度相符，完整decode checksum/EOF。解码≤256MiB/window≤16MiB/tar≤40000成员，每selected≤24MiB/总≤32MiB；成员regular/no-symlink/no-path-traversal/no-duplicate。三件为node_modules/@kiro/agent/{package.json,dist/server/acp-server.js,dist/server/acp-server.externals.json}。

独立新driver/manifest先保存，CreateNew gate、仅一次Python执行，CPU15/internal20/alarm22/tool30；只读目标436339984+21999416=458339400B，源hash另计，OS/loader/whole-author未知。只新own0700TEMP和exclusive报告。复用pure Decoder/selector但不import/执行旧driver；静态源而非运行基线。失败结束不扩cap/重试。

成功只证明当前完整产物中的该frame含这些public代码，**不证明全局唯一、nativeptrlen/caller/选择/生效runtime或自然安装**。仅与旧source04三成员作SHA/byte比较以决定旧静态分析是否能按内容复用，不执行任何成员/官方/Node/JS/模型/网络、不读真实auth/settings、不改配置/签名/CA，不开LLDB/dyld_info/全Ghidra。
