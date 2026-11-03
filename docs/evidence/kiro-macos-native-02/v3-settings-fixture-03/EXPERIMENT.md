# HOME默认路径与_KIRO_HOME冲突优先级

前置：case02已证getter在HOME和_KIRO_HOME同源下读两个不同已知值；不重跑。

新假设及预算：仅自有目录2次getter（每15秒、总cap4096B）：

1. HOME-only，无`_KIRO_HOME`或XDG变量，在`$HOME/.kiro/settings/cli.json`提供v3，应返回v3。
2. 同样HOME提供v3，但`_KIRO_HOME`指不同自有root、其`settings/cli.json`提供v2，应返回v2，若否则如实保留。

继承case02隔离与安全边界：真实HOME read/network/securityd禁止、自有TEMP之外filewrites禁止、两个已知设置文件都禁止写且核其前后，允许自有TEMP非设置初始化。只存白名单单key输出+其余输出长度/hash，绝不读登录数据库内容。全部0模型/0用户真实配置读取/0用户设置修改。

此case用于区分getter默认路径和override优先级，不证明运行中session effective engine。已知路径证明后，主侧才能直接对**这一个非secret JSON设置文件**作单key白名单投影，而不运行会初始化登录DB的真实HOME CLI getter。不打开真实auth/SQLite/Keychain、不全量打印设置。
