# 企业 profile 修复后功能验证 case verify-02

verify-01已耗尽：新目录HTTP400；diagnose-validation-01明确ValidationException正文固定词profile/arn/invalid匹配。此次新增目录前正常企业profile发现，不改正文协议、不猜profile、不重跑旧case。

前置：目录合成测试及类型检查通过，harness自测通过；与baseline及verify-01不同case/独占claim。当前Axiom正常选中identity-center，direct，无覆盖；固定deepseek-3.2/off，不在实时目录则停止，不换模型。

目标：Axiom ModelRuntime→Pi→原生provider实时拉目录；成功后单次文本推理正确返回 KIRO_CATALOG_OK_703。自有caller system/history全保留，无工具。最多2目录页、1正常OAuth刷新、2profile物理请求（目录与推理各一次，各自正常解析，不跨层注入或持久化）、1模型物理请求；不重试、不title/summary。总90秒（85秒请求截止，最多4秒清理，90秒硬停止），响应每项2MiB（模型64KiB），异常立即停止。任何case失败/成功claim耗尽，不自动重发。

目录走当前fetch；推理observer只包装kiroNativeFetch；profile使用该sender原有委托路径，不替换模型原生HTTP。独立SDK目录固定为当前已预检的 ~/.pi/agent（并非agent继承的执行快照），清理子进程执行绑定后通过该目录正常账号索引选择当前Kiro账号，不复制凭据、不覆盖父环境；正常认证store读取/必要refresh写回；目录使用内存store，不写models.json/默认模型、不改全局代理。仅子进程配置既有direct网络。原文只RAM，白名单计数/status/predicates落盘。

验收：原生实时目录（不采用配置合成结果）非空且含固定模型，直接使用其模型对象；请求input按原生system包装全文/顺序及空工具数组精确校验；SDK完整stop、精确文本、0工具；物理请求计数在预算内；owned流清理与dispatcher关闭，配置RAM全文前后一致。此为源码独立SDK功能测试，不代表已部署UI。若profile接口失败，停止当前case，按实际分层状态保留证据；不得自动切换接口或重复claim。
