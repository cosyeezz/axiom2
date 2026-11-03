# Kiro 原生组件离线接入验收 01

依据：[迁移合同](../../native-provider-component.md)。先 Kiro，其他供应商不动。

允许：本仓库组件/适配代码开发；合成凭据和数据；独立 Node、localhost HTTP、Pi SDK 本地集成；受影响回归、类型/构建及发布文件检查。网络目标限定本机合成上游；OAuth/callback 网络使用测试注入，不访问真实账号。

禁止：真实模型/OAuth请求、CLI/ACP代发、调用旧live harness/claim、扩大已关闭官方静态窗口、修改用户凭据/模型默认值/代理/全局安全设置、重启4317/4319。真实部署实测若需要，另立合同，不由此case隐含授权。

保持原始行为：Responses native HTTP/UA，单次1max1，optout=true，DeepSeek3.2/off，完整上下文/工具校验、取消、hooks/observer及账号隔离。旧原生重试实现仍独立Waiting。

baseline仅保存当前源码/工作树差异的指纹与已有diff，不含真实请求、凭据或原始上下文。测试日志仅合成数据。测试期间不改被测源码；失败先核根因再重跑受影响范围，不将未跑或局部检查记为全量通过。

交付：依赖独立性、独立认证/存储/目录/流与工具闭环，Pi实际接回证据；实际检查命令、退出码、覆盖/限制及代码指纹。该case不证明整个官方OAuth/direct-TLS parity，也不证明运行中的4317已加载新代码。
