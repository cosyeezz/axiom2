# Kiro 目录修复工作单

目标：功能修复当前 Axiom 账号模型目录拉取，并对一个明确模型做最小真实可用性测试；不做完整 CLI parity。

对象：macOS arm64，Kiro CLI 2.37.0，/Users/dane/.local/bin/kiro-cli，436718000 bytes，SHA256 b88fe85d0c847b55af6212017c140722ff84bf081f18bc7bdba5188ade2fa54e，universal x86_64/arm64。宿主 Pi 1.4.0 / Node；当前 CLI launcher→chat 的版本绑定尚未核验，旧 Windows 静态证据仅作协议参考。

授权：用户要求修复并测试模型；允许本地实现/离线回归及当前 Axiom 独立认证的有界验证。禁止复制 CLI 凭据、改默认模型/代理、重用旧 live claim、抓包/降低隐私或自动换账号模型。生产服务加载单独报告。

已完成：当前独立Axiom identity-center/direct账号，固定deepseek-3.2；旧目录403，迁移控制面后400的profile校验问题通过同账号企业发现解决。目录21模型、单次SDK模型完整stop/精确标记通过，52测试+类型检查+构建通过。未启动REA、未重启服务/UI验收。详见REPORT.md；所有live claim均耗尽，不重用。

既有证据：../kiro-native-component-live-01/REPORT.md（历史 DeepSeek SDK 成功，不代表当前目录）；../../kiro-catalog-audit.md（Windows CLI 静态目录操作）；../../kiro-profile-fix-20261028.md（历史企业推理 profile 修复）。所有旧实验均不重用。

步骤：定位实际失败→最小修复与离线回归→新合同有界目录/模型实发→交付边界。共享账号网络仅主代理执行；子代理只读分析。工作树大量已有改动不回退。