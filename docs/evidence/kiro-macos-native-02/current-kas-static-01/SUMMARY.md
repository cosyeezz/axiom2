# 当前KAS静态01：失败结束

唯一运行actual工具exit1/.4s，内部.234998209s，固定原因`candidate-cap`。在当前const扫描到第9个zstd magic时触发预定≤8阈值，**没有解码、提取或启动任何目标**。不放宽阈值/重跑该case；RUN.lock与RESULT已占用。

[完整结果](RESULT.json)、[工具返回](TOOL-RESULT.json)、[预存manifest](MANIFEST.json)、[源码](inspect_once.py)。source12855B/SHA213cb58c31c007d5d69ca4eb07d9f9739693f79434822491d497405421ba2e48，AST-only检查另有证，不是运行验证。

- target application reads379592712B；仅包含到失败为止的头和扫描/hash块，不是完整源SHA读完。未产targetSha256/afterStamp，不能声称当前全身份/稳定性已核。
- beforeStamp与metadata03公共stamp相同，但不是原子/完整SHA证明。读头得ARM slice226885632/209454352B，const fileoffset300867584/123747288B、VA0x10468e000，仅此次部分静态解析。
- candidate/matches空是解码阶段未开始，**不是零magic**；第9次命中使扫描结束，hits数组仅RAM未保存，具体命中偏移未知，不补跑取回。
- own目录`/private/tmp/kiro-current-kas01-3jxjdicl`，未写成员。0 target/model executions来自此driver无目标执行路径，不是全系统网络审计。

原先“const内最多8magic”假设不足。下一如推进，先从已有public资源标识/布局语义制定**更窄选择标准**，而不是增大magiccap或重复同一宽扫描。此失败不说明当前KAS不存在，不说明auth/NODE_OPTIONS状态。当前官方2.36源码身份缺口仍未解。
