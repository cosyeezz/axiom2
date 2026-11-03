# 已知单key JSON设置的路径与值敏感性

前置：[case01](../v3-settings-fixture-01/FAILURE.md) 空HOME/全file-write禁止返回EPERM，原结果不改不重跑。当前launcher静态常量支持`$HOME/.kiro/settings/cli.json`候选，但未证拼接/优先级。

新假设：仅由父在自有TEMP内构造`.kiro/settings/cli.json`的`{"chat.agentEngine":"v2"}`/`v3`，分别设置隔离HOME与`_KIRO_HOME`，执行`settings chat.agentEngine --format json`，输出应随唯一已知设置变化。可证**这个隔离环境**的路径/读取行为，不推断真实用户状态、无覆盖时的路径优先级或session effective engine。

预算：2个独立自有目录、每值1次CLI（总2），每次15秒，stdout+stderr cap4096B。最小env无secret；sandbox禁network、真实HOME读取、securityd，以及自有TEMP之外的一切文件写入；已知设置文件另行禁止write并核前后SHA。相对case01允许自有空目录的非设置初始化，是有实质前提改变的排查，不是重复旧失败。父只写这两个已知非secret JSON。目标产生的自有目录文件只盘点路径/大小，不读正文。

仅保存精确JSON字符串/单key对象或精确plaintext白名单v1/v2/v3/null投影（必须匹配已知输入）；其余stdout/stderr仅长度/hash。若任何失败，保留结果，先查新证据再决定新假设；不为取绿冷重试。整个实验0模型请求/0真实设置或登录存储读取/0真实用户设置修改/不执行V3或升级。
