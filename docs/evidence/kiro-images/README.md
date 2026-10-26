# Kiro 原生图片验收

本目录记录补图后的实现与离线验收，不代表真实账号、企业 profile/权限/费用或 AWS 图片推理接受性已验证。未执行官方 CLI/第三方程序、请求受保护 API、部署、重启或提交。

## 当前结果

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| Kiro auth/callback/catalog/chat/images/runtime/pooling，串行 7 文件 | **56/56，exit 0**，无失败/取消/跳过 | [日志](kiro-tests.log)、[命令与真实退出码](kiro-tests-exit.json) |
| 其中图片专项 | **8/8**，包含 Agent 三请求工具循环、历史图、真实 read 工具实现 | 同上；[测试源码](../../../app/tests/kiro-images.test.ts) |
| 通用图片、能力、目录、配置、覆盖、模型复制、认证兼容，串行 8 文件 | **35/35，exit 0** | [日志](compatibility-tests.log)、[命令与真实退出码](compatibility-tests-exit.json) |
| full/server TypeScript noEmit | **0 / 0**，无诊断 | [日志](typecheck.log)、[真实退出码](typecheck-exit.json) |
| 生产构建 `npm run build` | **exit 0**，仅 Vite >500 kB chunk 警告 | [日志](build.log)、[命令与真实退出码](build-exit.json) |
| 更新后的 adapter characterization | **8/8，exit 0**，绑定新 protocol SHA256 | [执行记录](probe-run.json)、[结果](../kiro-cli-parity/adapter-probe.json) |
| 本轮证据、链接、产物、scoped diff，以及原 PE/dumpbin/79 文件冻结清单 | 由下述检查脚本断言 | [检查脚本](check.cjs)、[结果及 SHA256](checks.json)、[原审计检查日志](parity-check.log) |

通用 35 项执行后，仅修正新 `kiro-images.test.ts` 的两处 SDK 用法；业务源码未改，因此该通过结果仍有效，未无理由重复跑。最终 Kiro 56 项与两项类型检查是在测试修正后重新执行，build 则在测试全部结束后运行。完整命令、工作目录与真实退出码见各 JSON，Node v24.19.0 / Pi 1.1.0。

复核命令（仓库根目录）：

```powershell
node docs/evidence/kiro-images/check.cjs
```

脚本检查 56/56、35/35、类型与 build 的 exit、初次失败留档、新旧 probe 归属、三个编译产物包含本轮逻辑、7 份说明的本地链接和源码行锚点、scoped diff 空白；随后运行原 parity 检查验证 PE 身份、两次 dumpbin、8 个 probe 及原 79 文件 SHA256 不变。`checks.json` 包含相关源码、测试、文档、编译产物及本目录证据的大小和 SHA256，自身不进入清单以免循环。它是当前文件完整性记录，不是官方请求 golden 或线上响应比对。

## 首次失败及修正留档

- [首次 Kiro 日志](initial-kiro-tests.log)、[exit 1](initial-kiro-tests-exit.json)：56 项中 54 过、2 败。Agent 测试把内容块数组错误传给 `prompt`，SDK 当作消息数组，导致零请求；改为 `prompt(text, images)` 后通过。
- [首次类型日志](initial-typecheck.log)、[退出码](initial-typecheck-exit.json)：full tsc exit 2（同一 prompt 重载 TS2769），server tsc exit 0；修正后两者为 0。
- 首次退出码 JSON 的 `log` 字段保留执行当时的 `kiro-tests.log` 路径；留档复制后应读取本节链接的 `initial-kiro-tests.log`，不要将原路径现在的最终通过日志误当成首次失败日志。原执行记录未改写。
- 第二项首次失败是测试层次不符：Pi 通用 `completeSimple` 对**请求开始前已取消**的 signal，在进入 provider 前将认证阶段抛出的 AbortError 映成 `stopReason:error`。没有修改或声称修复 Pi 该行为。新测试在原生适配器入口验证预取消得到 `aborted` 且零 fetch；原有测试继续覆盖公共 SDK 请求进行中的取消。没有放宽断言或修改依赖。
- 本轮生产构建第一次有效启动即 exit 0；此前一次 Node `-e` 包装因 Windows PowerShell 原生命令引号处理而语法失败，未启动 npm/build、未生成构建输出，改用 stdin 脚本启动。

## 覆盖与限制

- 原生 `images:[{format,source:{bytes:base64}}]`，PNG/JPEG（含 MIME jpg 别名）/GIF/WebP；合成字节验证编码，另有有效合成 PNG 通过 Pi 的真实 read 工具实现。未调用服务端图像解码。
- 当前、相邻合并及历史用户图片；纯图占位；工具 ID/status、各文本块、并行工具图片顺序；三请求工具循环后历史回放。
- 畸形/不支持 MIME、非规范 base64、完整请求超限、适配器预取消零发送；未削弱已有 CRC/schema、票据、认证隔离、固定端点或整体 10 MiB JSON 预算。
- `supportedInputTypes` IMAGE 导入、保存、重开、快照再发原生图片；V2 保留来源；V1 离线迁移为未知，不改磁盘，不把旧适配器 text 标记当作上游否定。
- 缺声明/旧 V1 **不会自动启用附件**：刷新得到 IMAGE 声明，或用户确认后手动开启；不按模型名猜能力、不绕过用户主动禁图。

原拒图/工具文本合并的 8 项特征探针保留为[基线源码](baseline-adapter-probe.ts.txt)和[基线结果](baseline-adapter-probe.json)。新结果在[现行目录](../kiro-cli-parity/README.md)。原 79 文件静态证据保持冻结，旧回归数不挪用为本轮结果。

接口结构、当前 CLI 序列化静态证据、历史 caller 与未知边界见[实现说明](../../kiro-images.md)；错误分类、跨层重试、思考历史续接、缓存控制等仍未完全对齐，见[请求等效审计](../../kiro-cli-parity-audit.md)。
