# 已知v2/v3路径与getter隔离验证结果

`check_known.py`实际exit0；2个独立TEMP各执行一次getter。分别exit0/2.142s与exit0/2.131s，stdout均5B，形状为JSON string，白名单投影精确v2/v3，stderr均0、无timeout/cap。已知cli.json前后SHA一致。允许的自有目录初始化生成了空lock、run-receipts锁与69632B自有data.sqlite3；**没有读取其内容或真实登录DB**。

这证实在同时设置隔离HOME和`_KIRO_HOME=$HOME/.kiro`的环境下，当前官方CLI `settings chat.agentEngine --format json`能读候选`.kiro/settings/cli.json`，且输出随已知值变化。设置文件写入由sandbox禁止。前一case的EPERM未变成通过；本轮未证明其具体违规调用。

局限：HOME与`_KIRO_HOME`同时指向同源，不证明无override默认拼接/优先级，也未读取真实用户设置，更不是effective engine或Mac观察整树通过。下一项仅需自有HOME-only与冲突override输入，完成路径优先级隔离；通过前不碰真实设置。
