# Kiro 原生组件离线接入验收 01

## 结论

按 [合同](CONTRACT.md) 完成独立组件、Pi 接回与离线验收。**未部署、未真实 OAuth/模型调用，不代表运行中的 4317 已加载新代码，也不代表完整官方 parity。** 第二供应商未接入。

- [公开入口](../../../app/src/native-providers/index.ts)：自有认证/账号契约、目录、profile、原生请求/传输/解析、工具校验、用量计数和流生命周期；无 Pi/宿主反向依赖。
- [Pi 薄适配](../../../app/src/server/providers/kiro-chat.ts)：认证票据、SDK 上下文与消息事件、工具 schema、thinking、价格/摘要用量；原 CredentialStore 保持唯一刷新 owner。旧纯模块成为兼容导出，未留双份协议实现。
- [使用说明与示例](../../native-provider-component.md)。独立 plain Node 合成 OAuth/刷新、注入存储、目录/profile、HTTP 工具往返及下一轮已验证，不靠“目录独立”宣称可复用。
- Responses 保留 native HTTP/1.1、既有 UA、精确长度、Connection close、单次 `1;max=1`、`optout=true`、caller system/tools/history/hooks 与 continuation。工具仍由宿主审批/执行，流候选不构成执行授权。

## 实际检查

环境：Node 22.23.2、npm 10.9.8、Pi 1.4.0；沿用现有依赖，无新增 SDK/依赖安装。下列命令的 `tsx/tsc` 均为 `app/node_modules/.bin/`，工作目录为 `app`，另标 repo 的除外。

| 检查 | 结果和证据 |
| --- | --- |
| 独立核心：`tsx --test tests/native-provider-account.test.ts tests/native-provider-stream.test.ts` | 13/13，exit 0；[core-test.log](core-test.log)。同期 `tsc --noEmit` exit 0，[core-tsc.log](core-tsc.log) |
| 首轮 Pi：`tsx --import ./tests/vite-assets.mjs --test $files` | [29 文件完整清单](pi-tests-01.files)，365/365，exit 0；[pi-tests-01.log](pi-tests-01.log) |
| 首轮接回 `tsc --noEmit` | exit 2：4 处 SDK 边界类型不匹配；[pi-tsc-01.log](pi-tsc-01.log) |
| 类型修正后 `tsc --noEmit` | exit 0；[pi-tsc-02.log](pi-tsc-02.log) |
| 类型修正后 9 文件受影响复测 | chat/responses/thinking/tool-input/usage/continuation/native-observer/profile/diagnostics，使用同一 tsx 参数；95/95，exit 0；[pi-tests-02.log](pi-tests-02.log) |
| 隔离 worker/pooling：同一 tsx 参数，`kiro-pooling.test.ts kiro-worker-warming.test.ts kiro-compression-worker.test.ts` | 14/14，exit 0；[pi-workers-01.log](pi-workers-01.log)，所有实际 worker 均关闭 |
| `npm run build` | exit 0；[build-01.log](build-01.log)。首次发现公开入口未被 server import，后续修 include 并重新完整构建，见下 |
| repo：`npm pack --dry-run --ignore-scripts --offline --json` | 两次 exit 0；最终 [stdout](pack-dry-run-02.stdout)、[stderr](pack-stderr-02.log)。实际包含 root prepare/build，非“无脚本运行” |
| repo：`node docs/evidence/kiro-native-component-01/verify-distribution.mjs` | 最终 exit 0；[结果](distribution-verification-03.json)、[空 stderr](distribution-stderr-03.log) |
| repo：`node --check scripts/check-package.mjs`、限定路径 `git diff --check` | exit 0；未运行安装/服务生命周期脚本 |

不同测试共 **32 文件、379 项通过**；13 项独立核心包含在首轮 365 项内，95 项为受影响复测，不能相加当作不同覆盖。最终源码并非又执行了一次全量 379 项：chat 类型改动后复跑相关 95 项，其余未改变运行行为；后续只调整 server 构建 include 和文档/证据。

### 覆盖要点

- 独立认证/存储：合成 device OAuth 与刷新；串行刷新一次、失败保留、晚到登录不复活、revision/空注销 ABA、取消且不合作回调仍持锁至 settle。Pi 侧仍走原锁与票据/账号路由。
- 独立流：本机 3 个原生 HTTP 请求、一次工具执行、工具结果回传、下一逻辑轮；无 Pi/TS loader。严格 schema、拒绝 coercion、缺 validator 零发送、截断终态/取消不放行工具、晚到 response 清理、profile 账号隔离、完整用量后无效快照先失效。
- 接回：真实 ModelRuntime sender observer；真实 Pi Agent/AgentSession 工具成功与错误流不执行、部分输出守卫、每物理调用新票据、系统/工具/历史、Responses/AWS、thinking/图片、诊断、目录缓存、取消、continuation、压缩计费和合成重试路径。这里的重试是保留的宿主路径，不是实现旧原生重试设计。
- worker：8 个真实隔离 compression worker 场景；4 个 loopback TLS/CONNECT/pooling 场景（含非 Kiro 回归）；warming baseline 实际产生 warm，guard 保持同 worker 复用且无 warm。
- 分发：21 个组件 JS 全部发射/列入包，45 条相对依赖全部存在且不越出组件；唯一非 builtin 直接依赖为已声明的 `https-proxy-agent`。临时环境只复制组件、纯 shim 和五个既有依赖，无 Pi；plain Node 验证真实 sender/错误类 identity 和 dispose guards，禁用 fetch/socket/http/子进程触发计数为 0。该软件级拦截不是 OS 网络审计。

## 发现与修正

1. **SDK 类型边界**：Native 契约的 `unknown` metadata/JSON 比 Pi 类型宽，导致 4 处编译错误。适配侧作窄类型断言；metadata 仍由原生 serializer 校验，工具参数仍由原生 JSON/严格 schema 路径验证，诊断来自白名单。修正后类型检查与 95 项相关复测通过。
2. **npm prepare 行为**：npm 10.9.8 即使带 `--ignore-scripts` 仍执行 prepare。首次输出 [pack-dry-run.json](pack-dry-run.json) 实际是构建文本加 JSON；[首次分发失败](distribution-stderr.log) 为 JSON.parse 失败。保留原文件，不伪装为有效 JSON；verifier 精确定位独占 `[` 行后的完整 JSON。已审阅 build-bootstrap/build-native：本地生成/编译，无安装、下载或服务启动；macOS native 步骤仅跳过。生成的 install.ps1/install.sh/setup-runtime.json 无 HEAD diff。
3. **公开入口缺失**：[第二次分发失败](distribution-stderr-02.log) 发现只输出 18 个模块：server 的 import 闭包遗漏 account/index/provider。给 [tsconfig.server.json](../../../app/tsconfig.server.json) 显式增加组件目录后，第二次 pack 执行完整构建，全部 21 个模块通过静态与隔离运行验证。该 config 修改前无工作树 diff，SHA256 `8b356309939f1dd5baf1415e4429e937e98132246b88350b25d3ff9c9bbf31c0`。

修改前 [baseline.json](baseline.json) 和 [已有 diff](baseline.patch) 保留；修改旧 Provider 前重新核对 25 文件，changed=[]。未 reset、提交或修改其他供应商。最终指纹与检查索引见 [verification.json](verification.json)。

## 验证边界

- 本轮不读 CLI/Keychain 凭据、不访问真实 OAuth/模型上游、不启动 CLI/ACP 代发，不改用户模型默认值/凭据/代理/全局信任，不重启 4317/4319；旧 live/static claims 未复用。
- `check:package` 全套会安装、启动隔离服务及升级恢复，未运行。仅做构建、pack 清单与组件/纯 shim 的隔离导入；未宣称全应用安装或真实生产 worker 部署验收。
- 未做浏览器审批 UI E2E；审批与工具执行仍属宿主，组件不具备执行器。组件 `tool-end` 只是候选，必须成功终态；AWS 原有 EOF 本地推断策略保持不变，不将其作为官方终态等价证明。
- 第二 SDK 适配、第二供应商、原生重试、optout 改为 false、完整 OAuth/direct-TLS/server 视角不可区分均未实施或证明。
- 下一步如需部署/实发，先建立新的范围、预算和独占 claim；第二供应商身份需确认。此报告只完成当前离线组件合同。
