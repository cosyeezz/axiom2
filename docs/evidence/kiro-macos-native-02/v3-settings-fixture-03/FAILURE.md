# 冲突override假设被反例否定

`check_paths.py`父exit1；两个getter均exit0、stdout5B的JSON string `v3`、stderr0，无timeout/cap。HOME-only输入v3的首case成功（2.125s）；冲突case本预期`_KIRO_HOME/../settings/cli.json`的v2，实际仍v3（2.129s）。两个已知settings均未变。

故本轮**只支持当前版本在该自有最小环境下从`$HOME/.kiro/settings/cli.json`取值**；不能沿用“_KIRO_HOME覆盖普通settings路径”结论。当前配置中的`_KIRO_HOME`可能未启用或用于其他资源，原因尚未恢复，不猜其优先级。不重跑、不改原预期/父failed结果。

已通过的HOME-only子case、case02两值敏感性及当前产物JSON常量足以支持下一项最小本机读取：不运行会初始化真实data.sqlite3的CLI getter，而在只读父进程中仅打开已证非secret`$HOME/.kiro/settings/cli.json`、只输出精确`chat.agentEngine`投影。不存在/无key/非法值均如实报告；不全量显示、不读登录DB/Keychain，不擅改开关。此路径事实仍不是effective engine证明。
