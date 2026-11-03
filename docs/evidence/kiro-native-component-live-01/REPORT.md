# Kiro 组件真实集成验收：通过

2026-10-31，固定 **`kiro / deepseek-3.2 / off`**。独立 Node 进程加载新构建，经 **Axiom ModelRuntime → Pi Agent → Pi 薄适配 → Kiro 独立组件 → 原生发送**，真实调用成功。

本次是组件与 SDK 集成的真实功能验收，**不是 4317 UI 部署验收或完整官方 wire/TLS parity**。没有重启现有服务、修改用户默认模型或代理，没有重放旧 case。

## 实际结果

| 项目 | 结果 |
|---|---|
| 用户输入 / 模型物理请求 | 2 / 3，全部 HTTP 200 |
| 首轮 | 唯一只读 fixture 工具执行一次，call/result ID 配对，结果回传后精确输出文件内容 |
| 下一轮 | 不调用工具，利用前轮历史精确输出原内容加 `_NEXT` |
| 文本终态 | 两轮均为完整 `stop`，无错误或截断终态 |
| caller 上下文 | 自有完整 system policy、custom history、工具 schema 三请求均保留 |
| continuation | 同一工具轮保持；下一轮使用新 UUID；conversation/root 保持 |
| 发送保护 | 真正 `kiroNativeFetch`，既定 UA、`1;max=1`、`optout=true` 保持 |
| 认证 | 正常 Axiom 账号路由完成一次真实 OAuth 刷新，写回有效凭据；profile 准备请求 0 |
| 辅助模型请求 | 0；无标题、摘要、缓存预热或自动重试 |
| 清理 | observer 开始/结束 3/3、活动响应 0、Agent settled、dispatcher 关闭、进程退出 |

首轮输出 `AXIOM_KIRO_COMPONENT_LIVE_01_5d781a6c`；次轮追加 `_NEXT`。原始响应、Authorization、完整请求体及认证响应没有写入证据。

SDK 内存会话 `44a36786-26f0-46c8-b0fb-eb2eb6c36ecc`。两轮身份分别为 `e7dc6a0f-f78a-4cbb-9f5a-925d50df27c2`、`2b15a4a9-5133-41f4-a444-488824c207fa`；本次由独立宿主调用既有 identity helper 显式传入，不冒称覆盖 UI worker 的自动注入。

## 门禁与运行证据

- [合同](CONTRACT.md)：最多2输入/3模型请求/1刷新，150秒执行和10秒清理，首错停止。
- [源码读回](source-readback.json)：此前离线验证的49个源文件指纹全部一致。
- 新执行 `node app/node_modules/typescript/bin/tsc -p app/tsconfig.server.json`，exit0；[build.log](build.log)为空。41个相关编译产物指纹记录在 [baseline](baseline.json)。
- [预检](preflight.json)：真实模型/账号元数据可用、sender 身份正确；阻断 Socket/fetch 时网络尝试0。
- [最终自测](selftest-02.json)：合成3请求闭环、坏终态禁止执行工具、活动流取消/清理、预算超限及发送前取消均通过，网络尝试0。[初版自测](selftest.json)不含追加的活动取消场景。
- [import 检查](import-check.json)：仅导入新 harness 不联网、不新增 case 文件。
- [独占 claim](live.claim)：2026-10-31 15:09:29+0800，PID98085，已耗尽。唯一真实命令 `node --max-old-space-size=256 docs/evidence/kiro-native-component-live-01/HARNESS.mjs --live`，exit0。**不得重发。**
- [真实白名单投影](PROJECTION.json)：36个Agent事件；模型响应字节6764/5558/5583，认证响应598，仅保存计数。
- [只读核验](verification.json)：41编译产物、49源指纹匹配；执行的 [HARNESS](HARNESS.mjs) 与最终自测 SHA一致；[VERIFY](VERIFY.mjs) exit0，所有结果已读回。

准备期未发真实请求的三次失败已解决：前两次为 Pi 1.4 import-only exports 无法由 `require.resolve` 选择入口，改用同一安装包公开 ESM 入口；追加取消自测时一次局部变量同名导致 TDZ，修正后完整自测通过。没有修改被测生产源码；未知错误只在 RAM，保存的是固定失败分类与修正事实。

## 环境与限制

[执行前](environment-before.json) / [执行后](environment-after.json) 读回一致：
- 用户默认仍是 `openai-codex / gpt-6-astra / high`；本测试显式选择 Kiro，不污染全局默认。
- Kiro 仍为用户当前 `direct`，没有恢复历史 builtin 设置。
- 4317 PID69592、4319 PID60548 均未变；没有重启或改动安装版。
- 仅正常 OAuth 刷新更新认证存储；刷新后有效性/profile存在性已只读确认，未复制凭据。

本次真实覆盖 Responses/DeepSeek、现有账号刷新、只读工具及续接；不覆盖新交互登录、其他模型/AWS路径、任意工具/SDK、生产 UI 部署、费用准确性或服务端不可区分性。请求头是实际 sender 输入检查，不是本次网络抓包；没有重新证明 TLS 指纹、线上完整 header 顺序或官方重试。旧原生重试实现与第二供应商均未实施。
