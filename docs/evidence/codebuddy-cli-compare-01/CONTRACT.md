# CodeBuddy CLI真实对照01

用户已明确要求执行真实对比。固定官方CLI2.179.0/macOS与Axiom原生CodeBuddy：`codebuddy-cn / deepseek-v4.1-flash / off`，同一输入 `Reply exactly AXIOM_CODEBUDDY_COMPARE_01.`。保留各自系统上下文并报告差异，不为字节相同删除安全约束。旧SDK工具live01失败且claim耗尽，禁止复用。

## 独立两轨与预算

官方、Axiom各是独立一次性轨道，各最多1次模型发送，不重试；一轨失败不重开，其结果仍用于另一轨独立对照。每轨须先通过自己的零外网夹具、import检查及产物绑定，再wx claim。官方先行，Axiom文本轨须另完成准备门禁。全case正常Pi刷新最多1次，另有共享wx刷新claim；不读取真实auth.json，不自建refresh客户端。

- 官方：CN HTTPS POST `/v2/chat/completions`≤1；GET `/v3/config`≤1、GET `/v2/geoblock`≤1。其余认证/目录/账号请求0，redirect和外层重试拒绝。
- Axiom：同目标model≤1，目录/profile/辅助0；正常账号路由→Pi薄适配→真正native sender。不是CLI代发，也不是通用Fetch替换推理。
- 官方 `/v1/traces`、`/v2/report` 合计≤4，在自有loopback discard server本地204，绝不外发；body/headers不保存。这是明确观察轨差异，不是假造模型响应。
- 官方默认max_tokens128000，发送前允许正整数≤128000，不改官方原始body；Axiom固定256，记录差异。两端无工具/MCP/fallback，无额外semantic调用。
- request编码/解码各≤1MiB；模型response编码/解码各≤64KiB，目录≤1MiB，geoblock≤64KiB；请求45秒，官方child总90秒/heap512MiB；夹具child25秒。
- parent stdout≤64KiB、stderr≤16KiB，仅RAM；FD4最后白名单报告≤64KiB、总输出≤512KiB，超限杀owned child。不落原文/原body/账号/敏感hash。原OFFLINE诊断中的合成stdout片段不得沿用到live。

## 发送与凭据门禁

preload在原request创建前扣预算/核host/path/transport override，允许真实TLS握手，但缓存write/end并禁止Expect/flushHeaders，检查model/none/stream/prompt/tools/auth及长度后才发送HTTP body原字节；不改官方序列化。Socket/TLS/DNS/fetch/http2/dgram/worker与child出口有进程内门禁。仅允许自己的loopback `/internal/agent` 和本地discard server；不是OS沙箱或完整系统网络审计。

Token仅经正常 `ModelRuntime.getAuth` / `readModelCredential` 路由RAM取得，fd3私有pipe传给官方custom-token，refresh不给官方。Pi锁内刷新使用其自有15秒signal，准入后不与caller abort合并，正常旋转和持久化完成后才供access。官方不担任第二refresh owner。凭据不放argv、证据、CLI缓存；same-user进程环境可读不是被本工具消除的风险。

正式claim前复核当前Axiom proxy=direct及scutil系统proxy-enabled布尔；若不支持当前代理则阻断，不篡改系统设置。官方可调用真实只读系统ioreg/scutil，固定系统命令及净化env（不继承token），其余child拒绝。私有HOME/config/cwd/TMP，抑制文件写，路径归一与realpath约束，禁止link/symlink和fd写旁路；不伪造设备身份。

## 验收与边界

官方必须正常exit0、唯一model200、完整SSE stop→DONE/EOF、无工具/错误、RAM累计文本精确marker且stdout最后assistant精确marker；仅stdout包含marker或HTTP200不算成功。Axiom须正常stop/marker并保存diagnostics白名单；失败不吞协议码。敏感输出仅形成布尔谓词，不能原文投影。

核模型、off、UA、动态身份关系、caller/工具结构、usage/terminal、物理预算及清理；保留完整请求上下文的存在/差异而非记录原文。冻结Axiom运行产物核全部1069文件及62关键artifact。退出读回child close、活动请求、provider dispose、parent server关闭、私有目录删除及配置不变。

官方安装、全局CA/代理/TLS、服务和默认配置不改；0部署/重启。此观察是原生Node发送前/响应tap，不证明独立wire/TLS、完整认证/重试对齐或服务端不可区分。真实对照与SDK工具复验未完成前不交付完成。
