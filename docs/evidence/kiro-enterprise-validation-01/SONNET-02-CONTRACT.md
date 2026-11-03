# sonnet-02 企业 SDK 功能验收

用户授权仍为重启后验证企业Sonnet5.5编码、工具、图片；不切账号、不换模型。sonnet-01已失败并耗尽，不能重用。新问题：把有官方KAS0.66.70完整serializer证据的GAR服务target从旧CodeWhisperer修正为KiroRuntimeService.GenerateAssistantResponse后，指定能力是否可用。根路径、AWS JSON1.0与二进制eventstream不变；不迁Responses，不自动fallback。证据 sonnet-routing-static/REPORT.md；403原因此前未知，target是明确协议差异而非预先确认的因果。

沿用 SONNET-CONTRACT.md 的固定 claude-sonnet-5.5/off、正常 ~/.pi/agent identity-center/direct/无显式baseUrl、调用方system/历史/tools及图片保真、工具可信子进程判分、配置不变与隐私要求。新运行使用修复后完整构建app/dist，独立SDK实发不是UI/worker端到端。后台尚需单独部署验收，不冒充已加载修复。

三阶段：第一轮只允许verify_code提交mergeIntervals函数，10个真实边界测试通过且不改输入；可信Node子进程1500ms/64MiB/权限模式、VM禁字符串代码生成、每次100ms、数据descriptor判分；第二轮原调用ID/参数/结果保真回传随机receipt，答案须精确匹配；第三轮自有三形状PNG要求精确颜色/形状JSON（prompt不含答案）。代码只RAM/stdin；不执行额外工具或未完整终态的调用。

硬预算：最多3次模型物理请求、3次美国profile、1次正常OAuth刷新；0目录/重试/title/summary/warm。单轮60秒，总180秒+4秒cleanup+185秒硬停；模型响应96KiB、辅助响应2MiB、模型请求256KiB。上游maxTokens不受支持，不伪称token预算。任何阶段失败即停止后续模型阶段。

观察仍包装实际global fetch（GAR原生sender委托该函数），不替换sender。核HTTPS runtime.us-east-1.kiro.dev/、精确新target、模型ID、origin、optout、上下文与工具图片。新增错误投影只观察现有reader，不tee/clone/额外请求；错误数据最多16KiB只RAM，仅完整JSON才投影有限已知代码及 reason===kiro:model_requires_user_opt_in 谓词。未知代码、reason、message、header值一律不落盘；保存bodyState枚举及HTTP状态，不把本地分类当供应商根因。

先离线9场景：正常、坏帧、错图、cancel、late、stalled、budget、已知403、未知403；两种代码判分攻击须拒绝。所有场景清理成功，未知错误字符串不出现报告。指纹覆盖sonnet-02.mts/本合同/code-runner、eventstream fixture、server/shared/native分发树、三项Pi SDK dist、undici、TypeScript及lockfile。构建结束后才生成selftest，独立复核门禁后 --live。

输出均新名sonnet-02-*；sonnet-02.claim独占wx，成功/失败/超时均耗尽；不覆盖01任何证据。前后models/settings/账号索引RAM相等，正常OAuth刷新原存储允许。finally取消所有body、等pending acquisition settle、关闭dispatcher；pending0/body0/dispatcherClosed/configUnchanged才clean。cleanup失败保留硬停。完整帧+EOF仍仅本地推断终态，不声称CLI完整一致、图像生成或所有功能验证。
