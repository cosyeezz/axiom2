# 官方精确 Sonnet 模型 metadata 只读核验

目的：sonnet04 Responses400后，公开KAS已证thinking/effort依实际模型schema选择；现核精确claude-sonnet-5.5的normalized metadata，不猜参数、不重放04。沿既有用户授权正常官方CLI自用认证，不读取/复制其token存储。

一次正常 `kiro-cli chat --v3 --list-models --format json`，不提供prompt，不改账号/默认模型/设置/代理/opt-out。复用已7项离线验证的official-sonnet-01.py监督器纯run函数；20秒、128KiB、进程组清理，独立临时cwd。CLI内部物理辅助请求数量未知，不冒充逐物理请求预算。新official-model-metadata-01.claim独占创建，失败/超时亦耗尽。

stdout/stderr只RAM。仅投影精确模型相等谓词、匹配对象数、JSON结构计数、固定字段存在谓词，以及thinkingToggleable/defaultThinkingEnabled布尔、effortSchemaPath的output_config/reasoning和已知effort枚举none/minimal/low/medium/high/xhigh/max。未知值只记other/presence，不持久化原文、身份、profile/token或其hash。递归最多12层/10000节点。没有metadata时明确输出缺失，不把缺失当不支持。错误只固定异常类型，保存监督器已有安全计数和清理状态；旧claims不复用。
