# 工具增量修复后 SDK03 单次合同

固定 codebuddy-cn / deepseek-v4.1-flash / off，官方基准CLI2.179.0。SDK02已捕获并定位既有工具后继function.name空串被错误拒绝；本case验证仅对此空增量的最小修复。首次name仍严格匹配声明，改名/id/type异常、坏schema、非空legacy拒绝，完整finish+DONE+干净EOF后才交宿主审批。

正常Agent→ModelRuntime→Pi薄适配→真正native HTTP；不CLI代发、不兼容反代，不改后台/全局配置/默认模型。保留system/security/custom history/tool-call-result。2语义轮、最多3逻辑及物理model：唯一read_component_fixture（path=fixture）经一次审批读取自有FIXTURE，模型复述marker；下一轮仅从历史输出marker_NEXT。同session、前两请求同run/新轮新run、invocation唯一。maxTokens256；重试/fallback0。

正常账号路由RAM认证，Pi锁唯一refresh owner及独立15秒signal，不race旋转/持久化。refresh至多1，继续共用比较01的refresh-live-claim.json（此前所有真实refresh为0）；catalog/profile/其它aux0。禁真实auth直接read、CLI缓存复制、原文/敏感hash落盘。

请求1MiB、model响应64KiB/45秒、refresh响应1MiB、白名单最多100帧；case180秒/cleanup20秒/hard200秒，报告128KiB。只存字段形状、known-name/marker谓词、usage数值、脱敏diagnostics；全部EOF/error/cancel出口保存partial，cancel先锁存意图并等待activeCancels归零。未知正文/工具参数不落盘。

执行前需：修前1FAIL1PASS；修后41core+14SDK=55测试及build0；新冻结1089文件与62关键产物核SHA；selftest含现代工具空name增量/坏终态/取消/late/多tool/刷新中取消/限额；import无副作用；观察8项取消/EOF/白名单/core边界检查；当前OAuth/native/direct/系统代理未启用/config未变preflight；READY绑定全部证据。

旧SDK01/02、官方01/02、Axiom文本01的claim全部耗尽。SDK03仅新wx claim一次；成功/失败/超时均耗尽，任何失败不发送后继请求。本轮不自动建立SDK04实发，若03失败先离线定位，额外实发预算需用户确认。JS门禁不是OS沙箱或独立wire/TLS证据；本case不验证常驻服务加载/UI端到端。
