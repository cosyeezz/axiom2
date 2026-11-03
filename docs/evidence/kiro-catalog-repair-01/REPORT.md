# Kiro 目录修复与真实验证

## 当前结果
源码修复、完整构建和独立 Axiom ModelRuntime→Pi→原生 Kiro sender 实发通过。**当前后台未重启，服务加载和 UI 端到端未验收**；不宣称全部模型可用或与当前 CLI 2.37 完整对齐。

[最终实发](verify-02.json)：1 次目录 HTTP200，返回 **21 个模型**；固定 `deepseek-3.2` 原生目录成员，1 次模型 HTTP200，完整 `stop`，精确返回 `KIRO_CATALOG_OK_703`，无工具。目录及推理各自正常发现一次 profile（共2次，均200），OAuth刷新0，模型重试0。活动body0、dispatcher已关闭、models.json RAM全文前后一致。`networkAttempts`仅是离线禁网哨兵计数，live的0不代表没有网络；实际请求数以前述分类计数为准。

## 原因与修复
1. 旧目录 `q.us-east-1.amazonaws.com / AmazonCodeWhispererService.ListAvailableModels` 实测403。改为官方CLI控制面 `management.{region}.kiro.dev / KiroControlPlaneBearerService.ListAvailableModels`，AWS JSON1.0 `POST /` body-only，不保留旧query双写。
2. 仅迁移接口后仍400。当前企业账号没有保存profile，白名单诊断确认ValidationException且profile/arn/invalid词匹配；补正常账号自身profile发现后目录200。显式profile不重新发现；个人账号不增加发现；企业多profile拒绝自动选取；原凭据不修改或复制。此对照支持当前账号的缺失profile是第二个阻断点，不推广到全部认证模式。
3. `defaultModel`允许缺省/null，有值仍严格验证，不作为额外模型发布。
4. 响应body读取异常改固定安全消息，避免私密URL/token经底层Error泄漏，取消语义保留。

15秒总期限覆盖profile与目录，分页/大小限制、迟到body清理、scope隔离及失败不发布部分目录保持。profile发现继续使用已验证可用的原有接口；没有因目录迁移而盲改推理/发现地址。

主要文件：[catalog.ts](../../../app/src/native-providers/kiro/catalog.ts)、[目录测试](../../../app/tests/kiro-catalog.test.ts)、[取消测试](../../../app/tests/kiro-catalog-bounds.test.ts)、[worker fixture](../../../app/tests/fixtures/kiro-network.cjs)、[集成测试](../../../app/tests/kiro-runtime.test.ts)。集成测试同时适配现有多账号机制：隔离继承执行绑定、读取选中slot认证/cache、使用当前账号删除生命周期；未放宽生产账号缺失保护。

## 验证
- `cd app && node_modules/.bin/tsx --test tests/kiro-catalog.test.ts tests/kiro-catalog-bounds.test.ts tests/kiro-profile.test.ts tests/kiro-runtime.test.ts tests/kiro-responses.test.ts tests/kiro-native-observer.test.ts`：**52/52，exit0**，[日志](profile-catalog-final.log)。覆盖新增企业发现成功/失败、多profile拒绝、完整凭据/scope不变、两阶段认证一致、发现期间取消/迟到body/迟到拒绝、worker/reopen账号隔离及原生Responses sender。
- `cd app && node_modules/.bin/tsc -p tsconfig.server.json --noEmit`：**exit0**，[日志](profile-catalog-typecheck-final.log)。
- 根目录 `npm run build`：**exit0**，[日志和dist检查](build-final.log)。实际 `app/dist/native-providers/kiro/catalog.js` 含新host/target及企业发现，server适配器引用该产物。
- `app/node_modules/.bin/tsx docs/evidence/kiro-catalog-repair-01/verify-02.mts`：**exit0**，离线完整SDK好终态通过、坏终态拒绝、0网络；[源码/合同绑定与结果](verify-02-selftest.json)。
- 同命令 `--live`：**exit0**；[合同](VERIFY-02-CONTRACT.md)、[harness](verify-02.mts)、[结果](verify-02.json)。独立claim耗尽，不得重跑。

## 证据与边界
[官方CLI2.36抓取对照](../kiro-macos-native-02/mitm-manual-official-chat-01/SUMMARY.md)和[KAS0.66.70完整serializer局部窗口](static-current/REPORT.md)支持协议迁移。旧临时路径消失不等于完整公源码不存在：后来找到同SHA新路径，已保存必要窗口。当前安装CLI2.37身份已记录，但未执行新CLI抓包。条件TokenType头及完整认证/wire parity仍非本轮验收范围。

已耗尽历史case保留：[baseline](baseline.json) 403；[verify-01](verify.json) 400；[diagnose-400](diagnose-400.json) ValidationException；[diagnose-validation](diagnose-validation.json) profile/ARN校验谓词。前三类失败没有发送模型；仅最终verify-02发送一次模型。旧harness/失败日志未覆盖。

没有复制CLI凭据、改默认模型/账号/代理、降低opt-out或TLS保护、安装新运行依赖、使用CLI代发、自动换模型。原始token/profile/响应正文仅RAM，证据为固定白名单状态、计数与断言。未重新测试登录刷新、所有模型、图片或完整工具轮次；现有相关合成回归不能替代这些实发能力验证。
