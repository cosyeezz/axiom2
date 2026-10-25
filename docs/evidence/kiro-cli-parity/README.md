# Kiro CLI 请求等效性补充证据

结论见[请求等效审计](../../kiro-cli-parity-audit.md)。本目录独立于冻结的[原 79 文件清单](../kiro-inference/manifest.json)，没有改写原始静态产物。

## 当前产物的可选请求字段

- 来源：本机官方 Windows Kiro CLI **2.12.0**，528,630,968 字节，SHA-256 `0ff1d24eea11aa2e244524d635e1cfc8f9820522f4c5bc192fb99590d909320a`。
- [serializer-scan.cjs](serializer-scan.cjs) 只读 PE，先校验 SHA-256；在已识别的 user/assistant serializer 与 `.pdata` 中定位的 reasoning callee 内，关联 RIP-relative 字符串、MOV R8D 长度和 JSON key helper `0x1410c81b0` 的直接调用。它不是通用反编译器，结果要结合真实指令核对。
- [serializer-fields.json](serializer-fields.json) 保存地址、字符串偏移及长度。用户侧原始指令沿用 [user.asm.txt](../kiro-inference/operation/user.asm.txt)：images `0x140b96abb`、documents `0x140b96bbf`、cachePoint `0x140b96d0c`、clientCacheConfig `0x140b96dbe`；均有可选值判断，不能推导每次都填值。
- [message.asm.txt](../kiro-inference/operation/message.asm.txt) 的 `0x140ba16dc` 调用本轮重新输出的 [assistant.asm.txt](assistant.asm.txt)：cachePoint `0x140baea08`、reasoningContent `0x140baeab5`；在 `0x140baeafc` 直接调用 [reasoning.asm.txt](reasoning.asm.txt) 的 `0x140b80040`。reasoning 分支含 reasoningText/text/signature 及 redactedContent；不是把同名响应字段误当请求字段。
- 两段新增 dumpbin 命令、原始退出码与 stderr 保存在 [dumpbin-run.json](dumpbin-run.json)，**均 exit 0**。只运行微软静态工具，未执行目标 exe。REA/Ghidra 配置阻塞沿用前轮已记录边界，本轮没有安装/改配置，也不称为新完成的 REA 反编译。

这些证据只闭合**请求序列化可达路径和字段结构**，没有恢复 CLI 填值 caller、默认启用条件或完整异步 dispatch，也没有证明服务接受性、签名每次必填、缓存必定启用。不能据此猜补 agentMode、采样参数或缓存默认值。

重跑（仓库根目录；依赖相同本机 CLI 与 dumpbin 路径）：

```powershell
node docs/evidence/kiro-cli-parity/serializer-scan.cjs
```

## 当前 adapter 的纯离线特征探针

[adapter-probe.ts](adapter-probe.ts) 使用当前请求转换器和安装的 Pi 错误分类器，合成模型、消息及假凭据对象；只调用纯函数，没有调用 fetch、登录或执行模型/工具，也不加载实际账号。结果是 [adapter-probe.json](adapter-probe.json)，相关源码 SHA-256 一并记录。

图片补齐后探针已更新，旧拒图/合并文本行为见[补图前归档](../kiro-images/baseline-adapter-probe.json)。以下 8 项应以当前绑定源码的结果为准：

1. 原生请求骨架、完整系统前缀、稳定会话 ID；默认 current context 只有 tools。
2. thinking 被转普通文本，签名没有原生回放。
3. 用户图片按原生 images/source.bytes 序列化（合成字节，不验证图像解码）。
4. 空工具结果变为占位文本。
5. 多个工具文本结果块分别保留。
6. 传入“aborted 助手 + 保留工具结果”的特定历史会失败；不证明正常 UI 必定产生该历史。
7. 泛化 HTTP400 不会被 Pi 识别为 overflow；历史原文 `Input is too long.` 也不匹配，规范化类别文案才匹配。
8. HTTP429/ServiceQuotaExceeded 映射被 Pi 判为 retryable；实际是否重试取决于上层策略/设置，探针不执行重试循环。

初稿曾误认为 Pi 能识别 `Input is too long.`，该断言失败；核对当前 regex 后改成分别断言“原始 Kiro 文案不匹配”和“规范化溢出类别匹配”。仅修正研究探针，未改生产源码。最终结果不混入这次失败为通过数。

重跑：

```powershell
Set-Location app
node --import tsx --import ./tests/vite-assets.mjs ../docs/evidence/kiro-cli-parity/adapter-probe.ts
```

这不是官方线上报文对照/黄金样本，不是完整回归测试，也不能证明真实账号已聊通。原业务回归/build 保持[原验收](../kiro-inference/validation/README.md)及[保活验收](../kiro-pooling/README.md)的版本归属；图片能力的新回归/build 另见[图片验收](../kiro-images/README.md)。

## 最终文件核查

[check.cjs](check.cjs) 校验本轮证据结构、8 项探针结果与绑定源码哈希、dumpbin 退出码/关键指令、文档本地链接、原 79 文件 manifest、审计新增文本空白与 scoped diff；不访问网络。运行 `node docs/evidence/kiro-cli-parity/check.cjs`，结果保存 [checks.json](checks.json)，exit 0 表示该范围通过。原始 dumpbin 输出保留工具的换行格式，不对它做源代码空白风格修剪。
