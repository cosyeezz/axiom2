# Windows历史进展与来源指纹

这是可携带的**派生摘要**，不是原件重验、Mac基线或执行许可。不携带凭据、原始正文、pcap、全量内存/环境转储或二进制。下列原件在Windows会话971742f3的冻结证据目录；文件名与SHA可供另行受控转移后校验，原件缺失时不得补写其结论。完整Windows交接包`kiro-parity-handoff-01`不被本次改写。

## 工程已做与尚缺

- 原生provider已包含认证、目录、流帧、文本/图片/工具及恢复等实现；本次保存的增量是OIDC注册字段顺序/中性名称、显式UA去除、生成prompt/recovery/compaction标识按来源中性化，以及目录独立取消等待与相应测试。
- 用户custom/system/history/tools/results、安全策略和协议origin等不能全局替换。删除显式UA不等最终传输无UA，Undici可能补默认值。未来注册名称改变不倒写历史注册。
- Pi默认retry一次failure episode额外3次，2/4/8s；provider单fetch不等session单请求。partial进展、同步取消、未知工具副作用、receipt与server幂等分别处理。
- 历史去品牌190是多批覆盖，不是本次全跑。IPC189=188旧PASS沿用+1新oracle执行；JS02为74VM/静态；controller02为38partial pure，互不累计。
- 尚无当前官方完整请求、去品牌后新Axiom实际出站、多场景server不可区分验收。HTTP200/同答案不代验收。

## 版本与范围纠正

旧Windows静态快照528630968B/SHA `0ff1d24eea11aa2e244524d635e1cfc8f9820522f4c5bc192fb99590d909320a`：现存一手证据只直接确认chat/ACP v2组件自报2.12.0，不把它当已复核launcher版本。旧VA只能用于该快照。

较新Windows安装launcher/runtime各407386296B/SHA `6f8898ee80578e2a22848fe06fc109c6b0afd1ef48a555a103b05baec548abdc`，后续本分支运行基准2.35.1/deepseek-3.2。官方下载MSI、安装EXE、mapped image和Mac产物均需分开绑定。

旧External一条消费路径成功解析expires_in为None才取3600秒；Some取整数、非法字符串/解析错误不是默认分支。**这不等于Axiom当前OIDC/social可在expiry缺失时补3600**，也不证明Mac该路径相同。源码未新增External/API_KEY接入。

## 最后真实采集及安全停点

- 新采集分支case02/05/08/10各1语义prompt，共4；不是整个会话或物理API计数。case09 DNS门禁失败0prompt，但namespace占用。旧09/10不能重跑，无第5次空发。
- case10 CLI正常自然退出，但Root/driver失败，NUL init/sinks/writes/bytes全0。另一个已结束的自有held/live exact-runtime进程有两个候选443 TCP row keys，不是已证HTTP sender；不补开旧PID。
- wire33帧/2流，runtime握手TLS1.3；q只有SYN/SYNACK。content_type23计0不等无密文：补充实际runtime9帧opaque23，仍不证明HTTP。
- JS01和controller01永久Failed禁Native。controller01缺独立截止终止、TermFalse仍卸SDK、empty waits假绿、export后late callback假绿，另有句柄登记和SDK迟到对象缺口。测试入口exit0只是复现成功，audit_exit1仍阻断。
- controller02/draft-a均30929B/SHA `ae2f7cd241be4f3a0dbb15c1e7d802cb612e0108eac182f1bc5c22d99983518d`，DRAFT_READY=False。仅部分修复，supervisor未实现，未执行新Native。现改走Mac，不续写Windows方案作为前置。

## 关键原件索引（历史原件SHA，非本摘要SHA）

| 原件 | SHA256 |
|---|---|
| KIRO-AXIOM-FINAL-GOAL.md | `16a0e84a7847779a826b28daa835ff4d52ad05719b193d7c55473d03550bc7a5` |
| kiro-parity-handoff-01/HANDOFF.md | `8b3f96f6a17ce20ea1ff7db82da664ba5935e07092747f8dceb059f858be321b` |
| kiro-parity-handoff-01/manifest.json | `a3b9c63d9deaf5677bf28006a2c57d8d9f5f8ef40b546d089efafd3ed90b634f` |
| kiro-parity-handoff-01/verification.json | `ebd759032e23a41559137e90216f8939e6f1d9e3416917bd1e4e2f541da62823` |
| skill-history-early-review.md | `64c8bb010b2ef0d05787fbd8f30e86a2e9fc89c6e87017e3e776f75b7d8b867e` |
| skill-history-runtime-review.md | `d8f0f647828cc0ff1f0aeba8158957d0b37b1ae28f0dfa88bf8eea60f656a172` |
| owned-resume-controller-evidence-digest-01.json | `ea4decc2c5703d6d4c70185d48193b7e52b66e0d17782159e987070afa194e84` |
| owned-resume-owner-design-review-02.md | `90ae94bb0bd753dcf5b53d3ce193c80080ea2594d4383984d20fd92a27a3b635` |
| owned-resume-fixture-ipc-qualification-01.json | `2bcf1dd1570e68be1df7ade83c8e76e388d6e29513e92a4c5dffbc07ebb16ae9` |
| cli-nul-recorder-current-cli-10.json | `f1c3b2b07b5b8a96335305a1f7a6121f96edd315834341b46a4c62858e43f9a7` |
| cli-owned-tcp-evidence-review-10.json | `6ef0e8cb9129630af77fef53c9b579233750903edad3fc35c683e1867a84ac3f` |
| cli-owned-tcp-wire-review-10.json | `9fd5e97615cf1a8d430e1b41f37fe15bd7ecb4f8c5ff096ab792fef721a2e2d4` |
| kiro-parity-handoff-01/evidence/wire10-supplement.json | `241f8dc4ade12c426749fbf14b53e283c4b030295cd2bc230d69e8be7226ebc1` |

精简digest继承历史parser，不是重跑23checks；主曾全文读digest，但1.3MB原index只读前180行，F1–F6原record未逐条全部主复核。不要为迁移重跑旧64场景或制造大副本。
