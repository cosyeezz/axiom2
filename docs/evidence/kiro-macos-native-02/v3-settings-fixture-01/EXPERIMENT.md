# 单key settings读取的自有空环境实验

用户已确认V3提示并要求自行完成，不再等用户确认。当前先排除假设：`settings chat.agentEngine --format json`会要求提供VALUE或进行隐式写入，不能当只读getter。帮助只给出KEY/VALUE可选语法，不代替此实际行为证据。

本case只在自有空TEMP HOME/cwd/XDG目录运行已绑定官方launcher2.35.1 ARM64，精确argv `settings chat.agentEngine --format json`，**没有VALUE、delete、global/workspace写入参数或chat/--v3**。最小env不带任何登录变量；sandbox禁止network/文件写入/真实HOME读取/securityd lookup。父进程不创建模拟settings，空目录起始/终态清点相符是只读的附加证据；不是用户实际设置状态或完整schema证明。

预算1次getter、15秒墙钟、stdout+stderr总cap4096B；只保存白名单JSON投影（null/v1/v2/v3或精确已知key对象），未知正文只保留byte计数/hash，不落盘。若非0/超时/未知形状则如实保存未通过，先定位契约/错误原因，不冷重试此case。此运行不代替Mac runtime观察fixture/整树生命周期证明，不发模型请求。

后续需已知非secret设置路径及自有已知v2/v3输入成功交叉验证，才考虑真实设置的单key最小投影；不打开登录DB、不读取/复制凭据，不改用户开关或升级配置。不能把空环境标称默认当用户effective engine。
