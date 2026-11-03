# 修复后独立SDK闭环02

固定codebuddy-cn / deepseek-v4.1-flash / off，独立Agent→ModelRuntime→Pi薄适配→真正native HTTP sender。使用刚通过回归与完整build的冻结产物，不借CLI代发，不改后台或全局配置。旧SDK01/官方01与02/Axiom文本01全部claim耗尽，禁止复用。

验收：2语义轮、最多3逻辑/物理模型请求。首轮仅调用声明read_component_fixture一次（严格path=fixture及宿主审批），返回唯一自有FIXTURE文本；工具后模型精确复述；下一语义轮保留system/security/custom history/tool-call-result，返回marker_NEXT。同session、首轮两请求同run、新轮新run、每invocation唯一。模型输出max256，禁止fallback/重试。

账户只经正常Axiom路由RAM取得，Pi锁唯一刷新owner；本case至多1次refresh，并共用比较01的refresh-live-claim.json（此前真实refresh均0），不合并caller signal，不race刷新或持久化。catalog/profile/其他aux均0；无真实auth文件直读、token/refresh/config原文或敏感hash落盘。

请求<=1MiB，模型响应<=64KiB/请求45秒，最多100个白名单帧；refresh响应<=1MiB且SDK owner signal15秒。Agent case180秒、清理20秒、hard watchdog200秒；报告<=128KiB。工具最多1次、审批最多1次；任何失败停止后续模型调用，wx live.claim只一次，失败/超时亦耗尽。

观察保存已知模型/finish、字段类型/空值、legacy name/arguments形状与未知键谓词、现代工具片段结构、usage数值、精确marker谓词和脱敏diagnostic，不保存任意响应文本/JSON/错误消息。EOF/error/consumer-cancel都投影，cancel先锁定原因再await，统计待完成cancel。空legacy对象只允许known name/arguments为空，非空/未知字段拒绝；工具候选仍须严格schema+stop/tool_calls+DONE+干净EOF，不沿用官方DONE后取消策略。

执行前：修前回归失败与修后39core+14SDK通过、build0；新冻结全文件SHA；import-safe、正常/坏终态/取消/late/多工具拒绝/refresh中caller取消/响应限额等selftest；当前OAuth/native sender/direct代理/系统代理未启用及配置未变preflight；全部指纹绑定到readiness。JS门禁不是OS沙箱/TLS审计，独立SDK成功不等生产UI/worker已加载。
