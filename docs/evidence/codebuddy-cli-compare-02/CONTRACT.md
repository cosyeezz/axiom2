# CodeBuddy 官方流字段补证 02

目的：补齐01观察器在aborted出口丢失SSE的已证缺口，确认可空delta字段/空finish_reason实际形状；不是重跑已耗尽claim。固定官方CLI2.179.0 macOS、正常Axiom CN OAuth路由、deepseek-v4.1-flash/off、同文本 `Reply exactly AXIOM_CODEBUDDY_COMPARE_01.`。不部署、不改全局代理/CA/安装/隐私，不读原始auth文件或输出凭据。

新case仅官方轨一次真实模型请求；GET /v3/config与/v2/geoblock各最多1，遥测仅本地discard204最多4，其他0。通过正常Pi锁唯一刷新owner，共用01的refresh-live-claim.json，01与02累计refresh最多1。官方仅接收RAM access token，不持久化凭据，不承担刷新。独立wx official-live-claim.json，一经开始成功/失败/超时均耗尽。

继承01隔离与固定参数：无tools、单turn、strict空MCP、无plugin/session persistence、私有HOME/TMP/cwd、request<=1MiB、response<=64KiB、catalog<=1MiB、child90秒、stdout64KiB/stderr16KiB/单report64KiB/总512KiB；TLS不降级，HTTP发送前参数/认证/预算通过。JS门禁不是OS沙箱或独立wire/TLS审计。测试deadline到时终止，不自动重试。

新投影仅保存已知字段存在/类型/null/empty谓词、模型白名单、finish白名单、长度、精确marker、usage数值；禁止未知字符串/原文/敏感hash。所有end/aborted/error/close出口保存已收投影，首先记录出口原因再清理；未知或中断终态失败。官方SDK若消费stop+DONE后取消连接，分别报告protocolComplete与transportComplete，不将其冒称自然EOF或完整TLS证据。最后assistant精确marker和CLI自然exit0仍是功能判据。

执行前：当前binding全部文件、安装bundle/launcher和冻结runtime验证；真实参数合成CLI夹具、早期abort/完整DONE后abort/EOF/error的collector测试、13门禁负例及正常Pi合成refresh、import-safe封网封写验证全部通过并绑定readiness。旧case01文件/proof/claims不改。此case不包含Axiom修复后实发，那个必须用新构建、新合同与claim。
