# Qoder 原生接入

## 状态与使用

Qoder 默认作为普通供应商提供，不需要实验开关，名称不带“实验性”。**国内站已有 OAuth 的最小文本／工具调用，以及真实 Axiom 会话的首轮文本和 thinking 已通过；同会话续轮遭遇 `10605`，工具和图片完整验收尚未完成，不能据此宣称全面稳定可用。** 验证状态不作为隐藏入口或禁止调用的条件。本实现沿用 CodeBuddy 国内版的接入流程：参考 9Router、静态复核官方发布客户端、实现原生 provider、运行隔离测试。并非部署 9Router 网关，也不是把 Qoder 当成标准 OpenAI API。

原 `AXIOM_EXPERIMENTAL_QODER` 环境变量不再控制展示、登录、刷新、目录或推理；未设置或保留旧值 `0` 均可使用。去除门控本身不启动登录或改变真实配置；后续最终修复的构建、一次后台重启及会话验证另见下文，未部署。

“添加供应商”默认提供两个独立项：

| ID | 名称 | 认证 |
| --- | --- | --- |
| `qoder` | Qoder | 国际站 Personal Access Token（`pt-`）或浏览器设备授权 |
| `qoder-cn` | Qoder 国内版 | 国内站 PAT 或浏览器设备授权 |

添加供应商并保存认证后，手动拉取模型列表。已有旧目录的安装也应重新拉取，以更新视觉／思考能力描述。没有内置猜测的模型清单；目录不可用会明确失败。两个地区的认证与缓存隔离，不能混用 OAuth 凭据。PAT 无法从字符串本身判定地区，请选择其签发地区。

自定义 Base URL 不受支持；私有代理应使用其他供应商 ID，不能覆盖这两个原生 ID。默认展示不改变认证要求、地区隔离或协议限制；登录、刷新、目录和推理沿用正常认证与错误处理。

环境变量 PAT：国际站支持 `QODER_PERSONAL_ACCESS_TOKEN`（优先）或 `QODER_API_KEY`；国内站优先使用 `QODERCN_PERSONAL_ACCESS_TOKEN`，兼容 `QODER_CN_API_KEY`，避免误用国际站令牌。

## 已实现范围

- PKCE 设备授权、PAT 兑换临时任务令牌和查询用户身份。
- PAT 到期前重新兑换根 PAT；设备刷新采用官方公开客户端中的 `deviceToken/refresh` 请求结构，缺失字段、期限无效或失败时不伪造续期。
- COSY 签名、编码请求、动态模型目录及 legacy `agent_chat_generation` 流式接口。目录支持普通 JSON 和严格解码后的 JSON。
- V5 端点选举：只接受 HTTPS，国际站限定 `api1/api2/api3.qoder.sh`，国内站限定 `gateway.qoder.com.cn`；拒绝跨区、重定向、带凭据、非根路径和企业端点。不实现未验收的匿名 V3 降级，选举失败不会猜测端点。
- 动态目录同时规范化系统与账号 BYOK 模型、视觉／思考能力、effort 和上下文档位；`enable:false/0` 均排除。BYOK 私密配置只留在内存，按官方规则写入 `custom_model`，不进入公开模型描述或 `model_config`。
- 系统提示、文本、工具定义、分片/并行工具调用和工具结果；SSE 信封解包、延迟 usage 合并、取消及错误处理。
- 目录声明视觉能力的模型支持用户消息与工具结果中的 PNG/JPEG/GIF/WebP base64 图片；不根据名称猜测，不自动换模型。原始用户及工具结果图片先校验，不支持的模型／格式明确拒绝。思考开关、目录允许的等级、预算及签名／加密 reasoning item 多轮回放已接入；`preserve=false` 去除历史思考。
- 账号目录中没有所选模型时失败，不回退到其他模型；推理失败不自动重放已签名请求。
- 区分 HTTP 错误与事件流内的错误状态。对于嵌套错误体中的已知业务码，优先显示其含义：`10605` 为当前模型资源繁忙，`110/112` 为额度或频率限制；不会仅因外层状态是 403 就要求重新登录。未知 401/403 仍提示检查认证、权限、账号地区或服务端限制，不回显上游错误原文。
- 编码后请求体的**本地**上限为 6 MiB。全历史图片在解码和 SDK 序列化前先按双份 base64 预检；SDK payload 及最终官方 payload 都在 JSON 序列化前计算 UTF-8、转义和重复字段开销，编码前再次校验预计线长。编码器使用有界字节缓冲，不再创建逐字符数组。请求 JSON 嵌套深度本地上限 128 层；不接受循环或非普通 JSON 对象，也不执行访问器或可调用的自定义 `toJSON`（含函数自有、继承及非枚举钩子）。这些输入在序列化和网络请求前明确拒绝；无钩子的普通函数保持 JSON 的省略行为。JSON 响应及单个 SSE 事件上限 4 MiB，读取时累计检查。这些不是供应商限制，也不是整个进程峰值内存保证。目录缓存 5 分钟。
- 对 HTTP 非成功响应及设备授权等待响应的 body 采用非阻塞取消清理，清理 promise 不阻塞错误或等待状态的返回；仍保留调用者 abort 和 timeout，不因此增加重放。
- 可持久化公开模型描述以供离线快照恢复；令牌、用户/机器身份及私有目录配置不进入模型缓存。无外部并发改写时，冷启动不创建缺失的模型缓存，已有缓存恢复不重写认证或目录文件；并发删除/替换缓存的竞态尚未专项验证。

流式处理要求明确的 `finish_reason`；无结束状态的 EOF/裸 `[DONE]` 判为不完整响应。支持裸 JSON／envelope、quota／notification 控制帧和 `event:finish` 规则；检查结束状态冲突、结束后的新增内容及畸形工具参数。终态与最终 usage 后仍读取后续帧，仅在没有半帧且空闲一秒时本地完成，以避免无限 keepalive；此前的临时 usage 不满足完成条件。这与官方严格等到 EOF／裸 `[DONE]` 有意保留差异，详见[客户端行为对齐](qoder-client-parity.md)。

### 图像协议与能力边界

官方 CLI 1.1.78 的 legacy 和 modern 构造器都支持图文混合数组：内联图片投影为 `image_url.url = data:<MIME>;base64,<data>`，保留顺序，同时填写相同的 `content` 和 `contents`；`chat_context.imageUrls` 保持 `null`，不添加顶层 `image_urls`。Axiom 按此投影用户图片。合并后的原生构造器也直接在 `role:tool` 中保留图文混合数组、`contents` 和调用 ID，不再依赖 Pi 中间请求的合成 user 图片消息；后续真实 user 消息不会被去重。

Axiom 公共图片入口仍限制单条消息最多 4 张、单张 5 MiB、合计 10 MiB，并验证规范 base64、MIME 与文件头一致。**文件头校验不等于完整解码或有效图像证明**。Qoder 的双字段和 base64 膨胀还受整个历史请求的 6 MiB 本地上限约束，因此 5 MiB 的单图不保证能提交；超限需缩图或压缩会话。只接受内联图片，不拉取远程 URL，不复制未审计的上传／签名流程。官方上传失败后保留内联数据的静态分支，不等于已证明服务器接受所有内联图片；真实会话验收仍须单列记录。

旧的离线模型描述可能仍只有 `text`，请重新拉取目录并保存真实能力。目录视觉能力仅接受布尔值 `is_vl:true`，字符串或数值不作视觉声明。若当前目录撤回图片能力，旧的 image 元数据也不会绕过检查。高级调用方仍可通过原生 `customModelOverride` 显式指定自定义模型的 `isVl:true` 和 API Key（直接 options、`metadata.qoder` 或 `samplingParams.qoder`）；这不改变目录模型，不是自动切换，且不绕过图片格式和请求体预算校验。思考能力与等级按当前目录规范化，并支持原生多轮回放，见[客户端行为对齐](qoder-client-parity.md)。以下真实调用记录及回归统计对应各自当时版本，不代表此次合并后重新执行了在线验收。

输入输出上限采用账号目录中的值；缺失时按官方发布物回退到 200000／32000，不代表服务端能力已验证。显式输出预算不再由 provider 按目录上限裁剪；显式上下文只接受合法档位，不自动抬高计费档位。高级采样、预算、上下文和功能开关入口见[客户端行为对齐](qoder-client-parity.md)。费用元数据初始为 0，**只表示未知，不表示免费**。自动模型的实际选择、费用和权限由供应商决定。

## 真实调用记录

2026-10-25，操作者明确授权后，通过 Axiom 的 `ModelService.runtime()` → `completeSimple()` 和供应商网络配置，复用已保存的 `qoder-cn` OAuth 连接，以直连方式调用配置中的 `dfmodel`（DeepSeek-Flash）。未使用官方 CLI 或 9Router 代理，未发送项目内容。

- 输入：`Reply with exactly AXIOM_QODER_OK and nothing else.`；输出上限 128 tokens。
- 返回：`AXIOM_QODER_OK`，结束原因 `stop`，总耗时约 1.50 秒。
- V5 端点选举、签名模型目录、`agent_chat_generation` 三个真实请求均 HTTP 200；仅发出一次推理请求，无重试。
- 服务端用量经适配器报告：输入 119、输出 31、合计 150 tokens；不据此推算价格。
- 调用前后 `models.json`、`auth.json`、`models-store.json` 内容指纹一致。未修改正式配置、重启或部署。

这证明当前账号、国内站、上述模型的基础文本链路可用，不代表国际站、所有模型或长期运行已验证。本次复用未到期的 OAuth 认证，没有测试交互登录或到期刷新。

随后针对界面报告的 403 做了最小工具联调，同样通过 Axiom 已保存的连接调用 `dfmodel`，不发送项目内容：

- 给定一个仅返回整数加一的测试工具，模型正常生成 `axiom_probe({value:7})`，接收常量工具结果 `8` 后返回 `AXIOM_TOOL_OK_8`，两轮结束原因分别为 `toolUse` 和 `stop`。
- 两次推理均 HTTP 200，共用同一会话 ID，无自动重试；续轮报告输入 420、输出 32、合计 452 tokens。续轮助手工具调用消息的 `content:null` 被服务端接受，因此不能把这个字段直接定为 403 根因。
- 排查中另一次最小请求虽 HTTP 200，但事件流返回 `statusCodeValue:403`，其 `body` 是 JSON 字符串，外层业务码 `403` 的 `message` 中还嵌套 JSON 业务码 `10605 / RESOURCE_LIMIT`。最内层给出 `isQueued:true`、`serviceAvailable:false`、`retryAfterSeconds:30`。这是模型资源限制，旧适配器却丢掉业务码并误提示重新登录；现已修正分类，仍不自动重试。
- 选举、目录请求均成功，配置三文件指纹仍未变化。没有重启、部署或修改正式配置。界面最初失败的响应体此前未保留，不能断言历史所有 403 都是同一业务原因，也不能据成功/失败的会话 ID 差异断言 UUID 版本受限。

这只验证了一个无副作用测试工具的短两轮流程，不等于真实记忆工具、复杂工具、长上下文或长期稳定性验收。以上是前轮直连探针，当时未重启；它不能替代下面的真实 Axiom 会话验收。

### 真实 Axiom 同会话验收（2026-10-26）

最终产品版本完成 62 项关联回归、独立复审及第 5 次完整构建后，仅重启一次后台：PID `68911 → 88053`，2026-10-26 01:54（+08:00）独立流程确认 HTTP 200、WebSocket connected，随后再次核对端口和 HTTP。重启证据在 [restart 结果目录](/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/axiom-backend-restart-8x7qfvs9/)。没有再次重启或部署。

通过 Axiom WebSocket API 创建并持续使用同一隔离工作目录／会话，而非 provider 直连探针。Workspace `f77b7478-8f66-4eb2-adc0-ac478926ef55`，session `c5683762-56fa-46a0-a092-6136197aa7e2`，选择始终为 **`qoder-cn / dfmodel`（目录名 DeepSeek-Flash），Axiom thinking 选择 `max`**，没有静默换模型。刷新后的真实目录有 10 个视觉模型；本模型 context 为 180000，原生 levels 为 `["none"]`、`reasoning:false`。界面 `max` 不证明服务端接受了相同 effort；下面单独记录实际 thinking。

| 轮次 | 预期检查 | 实际结果 |
| --- | --- | --- |
| T1 文本／初始 thinking | 不用工具，返回“青石计划”、`QODER_E2E_P5`、`17+24=41` | 首次 `10605`；245.611 秒后仅一次显式手动复验成功（3701 ms），三项正确，实际 thinking 非空、无工具调用 |
| T2 上下文／推导续轮 | 不用工具，甲 3／乙 1／丙 2、公式值 5，并回忆项目名和标签 | 首次及 111.550 秒后仅一次显式手动复验均为 `10605`；答案与续轮 thinking 未验证 |
| T3 工具及结果续轮 | 实际 `read fixture.json`，返回 nonce 和 values 总和 | 未发送；等待 T2 完成，不以历史最小工具成功替代 |
| T4 用户图片 | 直接理解自生成 PNG，分别计数及总数，不使用 OCR | 未发送；目录与离线投影支持不等于真实服务接受 |
| T5 综合上下文 | 合并前述文本、推导、文件和图片结果 | 未发送 |
| T6 工具图片 | 实际 `read` 图片，核对 call→toolResult→image→回答 | 未发送；已另生成未透露计数的新本地图，不复用 T4 的图，仍未证明真实 grounding |

四次 prompt 都保存了独立 request/run 归属。三次资源失败的现存证据均没有 assistant text/thinking、工具调用或工具结果；手动复验额度 T1/T2 各一次已用尽，未绕过限制追加重试。成功 T1 的 usage 为输入 2073、输出 82、共 2155，cost 为 `null`；T2 看到的累计 2155 来自 T1、`lastRequest:null`，不能当作失败请求新增 usage 或供应商计费为零。离线 12 项检查复核了四次记录的归属、内容、间隔与默认保护，不能据此声称已独立证明供应商底层绝无重放。

验收结束检查默认继承时，发现并发选择已变为 `codebuddy-cn / glm-5.3 / off`，因此保留该选择，未恢复 OpenAI；原测试会话仍保持 Qoder。恢复脚本已加终态 guard 防重复操作，但没有服务端 CAS，不声称消除了所有 snapshot→update 竞态。证据在 [同会话验收目录](/private/tmp/axiom-qoder-e2e.NEKIrV/) 和 [四次调用离线核验](/private/tmp/axiom-qoder-offline.CYHpZP/report.md)。这些是本机临时产物，不随仓库发布。

为避免脚本把错误答案或异 run 数据误判为成功，私有驱动另增加发前 selection／thinking／cwd、message.get 与分片 hydration 后的归属及内容一致性、request/inputIds 精确关联、工具调用／结果 ID 和顺序、原文单行 JSON、新图片 API bytes/hash 等本地断言；`run.completed` 与独立 `verification.passed` 分开。独立纯 helper 初轮 195 例发现 6 项漏拒，保留旧失败后修复，最新原 195 加相邻边界共 **528/528** 通过；重新冻结后的 mock 驱动及补充检查共 **66/66** 通过，各命令 exit 0。原记录重 grade 的 T1 仍通过，非 completed 记录仅为 not-completed。修复后 helper/client 及受保护记录的首尾 SHA 一致；没有因此发送真实请求或改动原 state、四次调用记录、默认选择及已发送文本。见 [纯断言复测](/private/tmp/axiom-qoder-recheck.8iefbebo/REPORT.md) 和 [mock 驱动复测](/private/tmp/qoder-offline-refreeze.PDJ46H/REPORT/index.md)。这些验证只覆盖本地记录断言和注入数据，不能独立证明远程图片字节真实性、实际 provider 或六轮真实效果；新图也仅在本地生成、未发给模型。

**当前阻塞是模型资源繁忙；完整续轮、真实工具／图片和稳定性尚不能签收。** 不通过换模型、重复建会话、自动排队恢复或只看 `completed` 来替代剩余验收。

## 仍未验收

1. 真实 PAT → 用户信息 → 模型目录 → 最小聊天全链路；完整 COSY 签名及机器身份字段与官方客户端的逐字节等价性。本次国内站已接受实际签名请求，但不能推广到其他账号或通道。
2. 国内独立客户端发布物及国际站真实账号闭环；国内站目前完成已有 OAuth 的基础文本、最小测试工具及上述 Axiom 首轮文本／thinking，完整同会话验收仍受阻。
3. 真实设备登录、到期刷新、长期运行；本轮真实 Axiom 的推导／上下文续轮、实际工具执行及结果续轮、用户图片和工具图片。
4. 企业组织、私有/VPC 端点、security/fast 推理通道、服务账号、独立图片上传、新版 model-server HTTP/gRPC 传输。已支持的 base64 图片不等于实现官方全部附件前处理链。
5. 真实价格、计费和上下文档位；本实现不主动提高收费上下文档位。

不能仅因为 mock 测试或一次真实短请求通过而宣称全面稳定可用。继续扩大联调范围需有相应授权，使用合法账号和无敏感内容的测试会话；不应从本机其他客户端配置中自动提取凭据。

## 静态核验依据

- 9Router `v0.5.104`，commit `87a74e1bda3677193c6f71a7e2100c90311f0689`。参考 `open-sse/executors/qoder.js`、`shared/qoder/{cosy,encoding,sse}.js`、`services/qoderModels.js` 和 OAuth 服务。六个关键文件与公开 tag 字节一致。
- 官方 npm `@qoder-ai/qodercli@1.1.78`，下载产物通过 registry SHA-512 integrity 检查。对发布物做静态分析，并在隔离配置、禁网和禁子进程环境运行 help/version/list-models 探针；未执行签名 WASM、未登录真实账户。
- 官方 WASM 中完整 RSA PEM、自定义 Base64 字母表与参考实现相同；请求编码和响应解码有静态调用链支持。这不等于完整签名、所有头字段及账号策略逐字节一致。
- 官方 PAT `expires_in` 使用兼容启发式：大于 86400 当毫秒，否则当秒。设备授权相对期限按秒；绝对期限优先。无有效期限拒绝缓存。
- 最新官方客户端的国际 `api1/api2/api3` 是区域候选，并非 PAT/device 固定划分；登录后会进行端点选举。
- 官方仍默认 legacy 传输，body 的主要结构与参考相容；新版 `/model/v1/chat/completions` 不是可以自动切换的通用 OpenAI 端点。

参考实现使用 MIT 许可证。版权与完整许可声明保留在 [qoder-protocol.ts](../app/src/server/providers/qoder-protocol.ts)，适用于本目录中的 `qoder*.ts` 适配代码。公开发布物分析只用于协议核验，没有将官方 bundle/WASM 复制到产品。

## REA 官方 CLI 逻辑对照

进一步用内置 REA 6.8.0 静态核验，并独立复核官方完整函数切片。主 Agent 将 `10605` 交给专用队列状态机：首次立即查询状态，就绪后保持请求集 ID、更新请求/记录 ID 再恢复；同时还有取消、等待预算、工具/部分输出防重放与 `ask/finish` 生命周期。**不是简单等待 30 秒就重发，也不是所有 403 都需重新登录。** Axiom 暂保留不自动重放的安全默认。

还确认请求 ID 等式、system 投影以及 reasoning 签名/加密字段存在兼容性差异，但未证明这些差异是历史 403 根因；`content:null` 已有真实成功证据，UUIDv7 也符合官方 CLI 的格式正则。完整 bundle 的 REA 图分析曾遇内存/超时限制，不能宣称全程序核验完成。方法、限制与具体结论见 [Qoder CLI 静态逻辑对照](qoder-cli-analysis.md)。该次排队静态对照本身未新增自动恢复；后续图像接入修复与真实验收分开记录，不以切片或 mock 成功替代真实完整会话。

## 离线验证

在 `app/` 下执行（使用隔离临时目录）：

```sh
TMPDIR=/private/tmp ./node_modules/.bin/tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1 \
  tests/qoder-auth.test.ts tests/qoder-stream.test.ts tests/qoder-runtime.test.ts tests/qoder-parity.test.ts \
  tests/codebuddy-auth.test.ts tests/codebuddy-stream.test.ts \
  tests/codebuddy-runtime.test.ts tests/model-runtime.test.ts
./node_modules/.bin/tsc --noEmit --pretty false
```

前轮协议接入验证：上述七文件 **39/39 通过，退出码 0**；TypeScript 检查 **退出码 0**。回归包含已有 CodeBuddy 链路、冷启动不创建缓存及快照恢复不重写缓存/认证。默认展示改版将原禁用回归替换为无开关的登录／目录／推理、旧值 `0` 下的正常注册与模型可用性，并新增双地区名称和默认下拉断言。本轮十文件（上述七文件加 `kiro-runtime`、`model-oauth-config`、`models`）48/48通过，生产构建退出0；Chrome九视口及触控回归通过，两个Qoder名称及默认可见断言通过。首轮浏览器在初始按钮禁用处超时，原检查重跑及两份只读诊断均通过，未复现且根因未确定，未以固定延时绕过。最终注释同步后重跑构建、Qoder／通用runtime检查和浏览器检查均退出0。日志在 `/tmp/axiom-qoder-normal.UTOtoy/`，截图在其 `app/test-results/model-polish/`；未部署或重启正式服务。

本轮客户端行为对齐的最终结果：Qoder 四文件 27/27 通过；加 CodeBuddy 三文件和通用 model-runtime 后 **51/51 通过、退出 0**。TypeScript 检查与生产构建均退出 0。细节、扩展参数和剩余差异见[客户端行为对齐](qoder-client-parity.md)；以上历史浏览器检查不是本轮新增检查，本轮没有启动应用或重新手测浏览器。

403 错误分类修复后，上述七文件 **42/42 通过，退出码 0**；TypeScript 检查退出码 0，独立定点审查无阻断。新增回归覆盖真实嵌套 `403 → 10605` 错误体、上游错误脱敏、失败不自动重试、HTTP/SSE 阶段区分及嵌套解析深度/长度限制。日志在 `/private/tmp/axiom-qoder-403-tests.UK4EWU/` 和 `/private/tmp/axiom-qoder-403-types.T4cPvO/`。检查期间相关源码未修改；未重新部署或重启后台。

2026-10-26 图像及资源安全初版，上述七文件 **57/57 通过、无跳过、退出码 0**，受检源码及测试首尾 SHA-256 一致；根目录完整 `npm run build`（bootstrap/native、TypeScript、Vite、server）退出 **0**。新增覆盖双地区多轮图像、Pi 工具图片投影及相邻结果、严格目录能力和撤回、规范 MIME 文件头、原始历史图片累计／并发预算、UTF-8/转义/重复字段开销、编码字节兼容、受控诊断与取消。日志：`/private/tmp/axiom-qoder-budget-regression.88w2P8/`，构建：`/private/tmp/axiom-qoder-e2e.NEKIrV/build-3.log`。这些仍是离线验证及构建，不表示真实图片服务或完整会话已通过。

随后补齐非阻塞 body 取消，以及对象／函数访问器和 `toJSON` 序列化旁路防护。**最终冻结版本**上述七文件 **62/62 通过，fail/skip/cancel 均为 0，退出码 0**；3153 个受检文件首尾 SHA 一致。独立复审另有 30 项测试和 4 个独立 probe 全过，包括 18 个函数 hook 变体拒绝且 hook 执行次数 0、5 个 SDK 变体网络调用 0、12 个精确预算及 1000 个 JSON fuzz。最终关联回归见 [oro5l54z](/private/tmp/axiom-qoder-final-regression.oro5l54z/)，独立审查见 [ENuUin](/private/tmp/axiom-qoder-final-review.ENuUin/)。根目录完整构建第 5 次 **退出码 0**，包含 TypeScript、Vite 与 server 构建，见 [build-5.log](/private/tmp/axiom-qoder-e2e.NEKIrV/build-5.log)；不是以旧的 57 项或 build-3 冒充最终版本。该版本已由上文唯一一次 verified 重启加载。

独立 2 MiB 图像编码探针曾发现初版峰值 RSS 约 427 MiB；修复后同类探针约 144.5 MiB，并在解码／推理前拒绝过预算请求。这是特定离线探针，不是整个应用的峰值承诺，也不证明真实服务端图像理解。纯文档和私有验收脚本变动不要求再次构建或重启未变的产品代码。

Qoder runtime 测试对子进程预载 mock fetch 并禁用真实 socket；测试用认证值均为 fixture。测试覆盖的是本地适配器和 Axiom 运行时契约，不是供应商在线可用性。不要用仅替换父进程 fetch 的测试代替子进程网络隔离。
