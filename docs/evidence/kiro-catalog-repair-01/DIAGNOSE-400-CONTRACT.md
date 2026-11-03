# 独立诊断 diagnose-400-01
verify-01已耗尽：management目录1请求HTTP400，0profile/模型/刷新，清理通过。新case只定位400的白名单错误类别；不重复模型验证。当前正常Axiom ~/.pi/agent账号，既有direct，无凭据复制。
最多1目录请求，0模型/刷新/profile/重试，总20s（请求15s）；只允许management.us-east-1.kiro.dev+ListAvailableModels，原实现不改请求；响应16KiB，正文仅RAM，保存HTTP状态、预定义异常类型/谓词。wx claim成功失败耗尽，不自动重跑。不改配置。门禁离线分类器自测；未知错误仍只保存other，不导出原文。
