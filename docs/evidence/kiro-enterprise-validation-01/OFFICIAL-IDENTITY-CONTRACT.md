# official-identity-01

用户明确要求助手自行验证官方Kiro可用性。本case只调用一次官方kiro-cli 2.37.0 whoami --format json，不调用chat/profile/login/logout、模型、登录切换，不读取/复制CLI credential文件。官方CLI正常读取自身身份是其独立认证行为，不能用其token代发Axiom。

当前CLI --version及--help/chat --help/whoami --help已只读执行，exit0。身份观察在空临时cwd运行，继承正常HOME，不改默认/代理/隐私/TLS。15秒超时，stdout+stderr合计64KiB上限；输出只RAM，白名单保存退出状态、是否JSON、有限已知schema字段类型及已知登录模式枚举，不保存email/startURL/profile/token/未知错误及其hash。

执行前official-identity-01.claim wx独占，任何结果耗尽；超时/超限终止自有进程组，核直接子进程退出并清空自有临时cwd。此为身份状态命令，不宣称已观测其所有辅助网络；不宣称同企业身份或模型可用，后续依据真实输出决定比较方法和新模型case。
