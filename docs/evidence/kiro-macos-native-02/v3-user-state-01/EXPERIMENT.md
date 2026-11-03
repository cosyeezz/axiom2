# 真实非secret设置的单key最小投影

已知前置：当前launcher常量与case02两值/03 HOME-only子case证实`$HOME/.kiro/settings/cli.json`单keygetter路径和JSON格式。case03的_KIRO_HOME覆盖假设失败保留，不当成功。

本项**不执行官方CLI**（避免其初始化或打开真实登录SQLite），不触碰auth DB/Keychain/登录目录，仅用本机只读父进程打开这一个非secret JSON settings文件，拒绝路径任一层symlink/非预期类型，文件cap1MiB。解析只投影`chat.agentEngine`的存在性、类型是否合法和精确v1/v2/v3值，其余所有键/值不输出、不保存；不hash/复制整份用户配置。缺失/非法/IO失败仅报告状态/errno，不输出异常中可能含正文。

预算一次已知文件read、10秒，不扫描HOME/进程/其他产品，不读写用户配置；报告仅保存到本证据目录。0模型请求、0凭据存储读取。读出的stored不等同当前session effective；不据此切V3或迁移配置。
