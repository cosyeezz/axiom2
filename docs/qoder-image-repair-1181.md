# Qoder 1.1.81 图片修复与验收边界

## 当前结论（2026-11-01）

**图片准确识别尚未通过，不能宣称已修好。** 已补齐官方 CLI 的优先上传流程，并完成离线、构建、部署及编译产品的真实上传检查；上传成功不等于模型看懂图片。

| 层级 | 结果 | 证据 |
| --- | --- | --- |
| 官方 CLI 图片基线 | 两次均未准确识别随机 OCR 和三个颜色形状 | [首次](evidence/qoder-image-repair-1181/cli-before-01.json)、[诊断](evidence/qoder-image-repair-1181/cli-diagnostic-02.json) |
| 修前原生内联图片 | 图像字节完全保留、HTTP 200、stop，但回复否认视觉，答案未通过 | [原生基线](evidence/qoder-image-repair-1181/native-before-01.json) |
| 私有 URL 投影实验 | 上传成功，但推理 HTTP 200 的流内返回业务 406，无答案 | [最后一次 URL 实验](evidence/qoder-image-repair-1181/remote-probe-08.json) |
| 修后编译产品上传 | 正常账号路由、1 次真实 PUT；最终 payload 图为 URL，下载的 PNG 10206 字节逐字节相同；0 推理 | [产品上传预检查](evidence/qoder-image-repair-1181/compiled-upload-preflight-01.json) |
| 离线检查 | 旧五文件 50 项通过；新文件纠正 fixture 后 9/9 通过，分轮而非单轮 59/59 | [六文件首轮](evidence/qoder-image-repair-1181/image-regression-01.log)、[新文件最终](evidence/qoder-image-repair-1181/image-regression-03.log) |
| 构建与部署 | 根完整构建退出 0；独立重启 96136→5441，08:22:37 +08:00，HTTP 200、WS connected | [构建](evidence/qoder-image-repair-1181/build-image-02.log)、[重启](evidence/qoder-image-repair-1181/restart.json) |

预检查在最终 `onPayload` 主动终止，因此 SDK 的 `stopReason:error` 是预期的本地阻断，不是新模型失败，也不是图片识别成功。它没有真实 worker、工具执行或模型回答。新后台从含补丁的 `dist` 启动，不代表已经在实际 worker 推理中命中上传分支。

## 已补齐的实现

- 新增 [qoder-images.ts](../app/src/server/providers/qoder-images.ts)，由 [provider](../app/src/server/providers/qoder.ts) 在原生 payload 构造后、调用方最终 hook 前执行。用户与工具图片都原位更新 `content/contents`，不改调用方 context、文本、system、工具 ID 或错误标记，不额外合成 user 图片。
- 普通账号向对应地区的 `site.center` 发送 `PUT /algo/api/v2/image/upload?request_id=<32hex>`；multipart 为 `file`／`image.<ext>`，JPEG 用 `.jpg`；签名输入是 multipart 长度的十进制字符串，时间戳按秒。
- 由 Fetch 自动计算 Content-Length。当前安装 Undici 后混用 builtin Fetch 与 installed Fetch 时，显式长度头会形成重复值；本地最终 HTTP receiver 已分别验证两种 Fetch 的唯一正确长度。没有修改全局代理策略。
- 接受官方五种 URL 封装：`url`、`result.url`、`result.oss_url`、`data.url`、`data.oss_url`，仅 HTTPS 且不带用户名密码。不跟重定向；产品不对返回 URL 再带认证下载。
- 上传最多 3 并发、每次 30 秒；512 项已完成 URL 的 RAM 缓存，key 哈希包含账号、令牌、endpoint、MIME 和图片。单次 prepare 去重，不跨调用共享可取消的 in-flight 操作，防止交叉取消或迟到结果污染缓存。
- 上传失败保留内联图片；401/403 不额外刷新再 PUT，不自动重试推理。取消传播，取消后不缓存、不执行最终 hook、不发 SSE。原始、上传后及最终 hook 后的请求体预算都保留，未放宽 6 MiB 限制。
- [错误分类](../app/src/server/providers/qoder-protocol.ts)将已知**业务码 406**显示为固定的内容安全拒绝，且说明未自动重放。不输出未知上游 message；单纯 HTTP 406 没有业务码时，不武断归为内容安全错误。

## CLI 证据与未解决的问题

国内 `@qodercn-ai/qoderclicn@1.1.81` 的实际入口 SHA-256 为：

```text
55fa18137d1f6d2ac06f555a9e207e44ff86e7029f18a24a82909bd1435f0b97
```

独立公开国际 bundle 的 SHA-256 为 `dcabbcaece1c0683ee4929ac7c0cf0ea00bbea4d319f5abeaae8216088b9888f`，两者不能混称。406 定位使用国内 bundle，上传链定位使用国际公开 bundle；以下偏移是字符偏移，不是 UTF-8 字节偏移。

- 国内 bundle 约 23864650：`case "406": return rs.sensitiveContent`；约 85276 的不重试集合包含 406。由此确认业务错误的官方类别，**不猜具体拦截原因，也不绕过检查**。
- 上传静态链路包括 `nSA→egu→Agu`、`S0o/D0o`，约 24048k–24053k；WASM 签长度而非二进制。CLI 的逻辑路径可能不带 `/algo`，最终 HTTP 路径必须带。日志函数可用逻辑 path 替换 URL path，不能把日志当最终 wire。
- [官方预发送观察](evidence/qoder-image-repair-1181/cli-preflight-06-body.json)证明 CLI 在推理前已把图改为远程 URL，`dfmodel` 目录声明 `is_vl:true`；这是预发送投影，不是最终 wire 或正确识图证明。没有读取或复制 CLI 的凭据。
- [私有上传完整性](evidence/qoder-image-repair-1181/upload-integrity-07.json)和[身份预检查](evidence/qoder-image-repair-1181/identity-preflight-08.json)排除了已观察到的图片损坏及 user/machine/policy 串路由。`Cosy-Key` 每次随机 AES/RSA 包装而不同是正常设计，不修成固定值或伪造 UMID。
- 对齐 legacy 的空 chat_context 文本投影、把输出预算改为 32000，均未消除 406。这些实验没有进入产品：产品保留真实调用方正文，不为规避拒绝而删改上下文。
- 原生内联回复否认视觉；官方 CLI 两次也答错。因此缺少上传是已证实现差异，**不是已证的全部根因**。补上传不能证明 grounding、原先被拒请求或 OCR 已恢复。

早期 CLI observer 的父子进程共写同一文件，父进程的零计数覆盖了子进程记录；该零不能证明没有推理或不经过某网络栈。宽关键词分类中 `block` 也曾误命中 lock/safety，不据此认定锁竞争或具体安全风险。最终错误类别依据官方码映射；未知原文只在 RAM，[清理确认](evidence/qoder-image-repair-1181/ram-diagnostic-cleared.json)已完成。

## 检查与预算

在 `app/` 执行，隔离运行时账号环境；测试只用 fixture 或本地 receiver，不调用真实推理：

```sh
env -u AXIOM_EXECUTION_PROFILE -u AXIOM_MODEL_ACCOUNT_BINDINGS -u AXIOM_MODEL_MANAGED_ACCOUNTS \
  TMPDIR=/private/tmp ./node_modules/.bin/tsx --import ./tests/vite-assets.mjs \
  --test --test-concurrency=1 tests/qoder-auth.test.ts tests/qoder-stream.test.ts \
  tests/qoder-runtime.test.ts tests/qoder-parity.test.ts tests/qoder-wire.test.ts tests/qoder-images.test.ts
```

首轮 58/59 的唯一失败是新测试期待成功工具显式发送 `is_error:false`，而既有 serializer 省略此可选字段；改正断言后新文件 9/9。首次[构建失败](evidence/qoder-image-repair-1181/build-image-01.log)也只涉及新测试联合类型，改为显式 tool fixture 变量后最终根 `npm run build` 退出 0。产品代码未因这两项 fixture 修正再改，其余五文件 50 项沿用首轮通过结果，不重复计算。

新九项覆盖五种响应、multipart 内容与签名、账号/令牌/endpoint 缓存隔离、512 淘汰和并发 3、上传失败/无重试、取消/迟到结果、SDK 工具图片回放与最终 hook、406 分类及本地最终长度头。构建含 TypeScript、Vite 和 server 编译，只有非阻断的大 chunk 提示。未变的外层 zero-replay 回归 19/19 是[前一修复](qoder-repair-1181.md)的结果，不冒充此次重跑。

- 原[图片合同](evidence/qoder-image-repair-1181/case-contract.json)的 **8 个逻辑模型调用已耗尽**：CLI 2、原生 inline 1、URL 实验 5；不声称精确统计了 CLI 物理 attempts，不扩旧账或借旧多轮额度。
- 修后仅新增独立[零推理合同](evidence/qoder-image-repair-1181/postfix-contract.json)：最多 1 次上传、0 次模型调用。exclusive claim、最终 hook 停止和精确网络路由白名单共同约束；实际 1 PUT、0 推理，没有重放被拒推理。
- 历史受控工具的 10605 仅代表当时 case，不推广为当前所有工具都不可用，也不拼入之后外部用户的完成记录来签收。

## 剩余验收和恢复条件

1. 上游业务 406 的具体原因需供应商确认或解除；目前没有正确的官方图片基线，不能继续靠改身份、删安全上下文、换题重发碰运气。
2. 获得可用的官方视觉基线及允许继续的独立受控范围后，才能新建有明确预算的准确识图实验；不能扩大已耗尽合同。
3. 真实新 Axiom worker 的 `read` 图片→匹配 toolCallId/image result→续轮→精确答案仍未完成。不能用离线投影、上传成功、HTTP 200 或 stop 替代。

白名单结果和日志集中于[证据目录](evidence/qoder-image-repair-1181/)。没有图片内容、标准答案、URL、凭据、真实用户正文、未知错误原文或官方 bundle。运行 `node docs/evidence/qoder-image-repair-1181/verify.mjs` 可离线检查证据、预算、相对链接和源码快照；不发网络请求。源码快照用于界定本次检查，不代表后续改动自动继承结果。
