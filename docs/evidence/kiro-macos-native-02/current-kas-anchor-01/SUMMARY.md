# 当前KAS anchor01：部分定位、实验失败结束

唯一actual工具exit1/.4s、内部.29173075s，`window-candidate-cap`。完整目标SHA已匹配预定2.36身份；在**第二个**anchor前窗遇第9magic而停止，最终afterStamp/全局唯一性未证。原driver/gate冻结，不增加cap重跑。

[结果](RESULT.json)、[工具返回](TOOL-RESULT.json)、[manifest](MANIFEST.json)、[源码](inspect_once.py)。source13889B/b6a538b3f1b3acacc8ee63bfeee56f5f375a4251f55015cbabeed683d5c8ac69，实际target application read493693750B，ownroot`/private/tmp/kiro-current-kas-anchor01-zydbh7gr`。无任何成员提取/目标执行/模型。

保留有效局部事实：当前ARM226885632/209454352B、constfile300867584/123747288B，exact `KIRO_KAS_NODE_PATH` 命中两处324658718、383884750。第一个anchor前窗内候选fileoffset**302659302**，zstd frame grammar长度**21999416B**，exclusive end恰等324658718；解码首512B含ustar标记。只是明确的**单个静态frame候选**，不是原生ptr/len/caller证明，完整checksum尚未验证。第二窗因cap中止，其具体magic offsets未存，不补跑。

原“全局唯一邻接tar后才可提取”验收未满足；不把候选当成功或补绿。后续可另定义**只核这一个明确frame的成员/完整checksum**，不声称全局唯一或native使用。新问题不扫描其他候选、不重跑失败窗口；即使三成员与旧版相同也不能确认当前native选择/运行/NODE_OPTIONS。原失败继续保留。
