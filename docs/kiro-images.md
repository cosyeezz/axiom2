# Kiro 原生图片请求

## 目标和实现

目标是**保留模型能力，并按官方 client 的原生协议发送**，不是以文本可用为由关闭图片。Axiom 仍使用自有原生适配器，不启动官方 CLI、不改走 OpenAI、不伪装官方客户端身份。

[请求转换器](../app/src/server/providers/kiro-chat-protocol.ts) 已接入：

- 用户当前消息及历史中的 PNG/JPEG/GIF/WebP；`image/jpg` 归一为 wire `jpeg`。
- `userInputMessage.images = [{ format, source: { bytes: base64 } }]`。不把 MIME/data URL/路径当 wire 数据，也不下载外部 URL。
- 工具结果图片提升至同一条 `userInputMessage.images`，工具结果保留原 `toolUseId`、`status` 和各个文本块；纯图片结果使用有历史 caller 来源的 `See images data supplied` 文本。图片数组本身没有逐张工具 ID 字段，**不虚构一一绑定**。
- 合并相邻用户/工具消息时同步保留全部图片及其顺序；下一轮历史回放保留原图，不在 provider 中缩放、重压缩或重写已存历史。
- canonical base64、已知格式与原有全请求 10 MiB 本地预算校验；不静默丢图、换模型、把图片替换成成功文本。全请求预算包括 base64、文本与历史，并不是上游服务宣称的最大值。

Pi `read` 返回的图片也经过这条工具结果路径；不能只支持直接用户附件，而忽略 Axiom 路径附件的按需读取。宿主原有图片预处理及用户 `blockImages` 设置不变，provider 不绕过用户主动禁图设置。

## 模型目录与保存恢复

[目录适配器](../app/src/server/providers/kiro-catalog.ts) 解析上游 `supportedInputTypes`：

- 含 `IMAGE`：运行模型声明 `input: ["text", "image"]`，目录展示并传递图片能力。
- 明确 `TEXT`：展示文本输入；不按模型名称推测图片/思考能力。
- 缺失、null、空数组或仅未知枚举：运行时以合法文本数组作为基线，**目录展示“输入能力待确认”**，不是宣称模型不支持图片；未知枚举不抹掉同时出现的 `IMAGE`。旧模型/未知声明不会自动开启附件，可重新拉取获得 IMAGE 声明，或由用户确认后手动开启。
- 保存上游声明来源，只缓存白名单元数据，不缓存完整响应或凭据。

[provider 缓存](../app/src/server/providers/kiro.ts) 使用版本 2，重启/离线恢复保留图片与来源。旧版本 1 的 `["text"]` 是此前适配器能力标记，迁移为“上游未知”，不当作上游明确否定图片，不因离线恢复主动联网或重写磁盘。已有账号/profile/generation 隔离机制不变。

[模型目录服务](../app/src/server/model-service.ts) 对未知声明返回可选 `input` 的缺省状态；现有前端已经支持“待确认”显示、复制声明能力及保存/重开，不新增通用协议旁路。用户明确修改的能力覆盖仍按现有配置语义保留。

## 协议证据和边界

固定历史来源：[aws/amazon-q-developer-cli commit 15cc8f3cd18c4272925ce1c7053268eedff1ea0a](https://github.com/aws/amazon-q-developer-cli/tree/15cc8f3cd18c4272925ce1c7053268eedff1ea0a)。下列路径相对此仓库：

- `crates/amzn-codewhisperer-streaming-client/src/protocol_serde/shape_image_block.rs`、`shape_image_source.rs`：format/source/bytes 及 Blob base64 JSON；QDeveloper streaming 同名实现一致。
- `crates/chat-cli/src/api_client/model.rs:796–885`：四种格式、jpg 别名、原始字节转 Blob；`:900–906` 实际设置 images。
- `crates/chat-cli/src/cli/chat/mod.rs:2624–2629、2776–2778`：旧 chat caller 收集工具图片并放入同条用户消息；`message.rs:411–417`：纯图占位、混合文本。
- `message.rs:175–215` 和 `conversation.rs:1064`：历史与当前消息保留图片。

旧 chat UI 的直接用户附件填值路径未证实；另一套 RtsModel 虽有用户图处理，但历史图被显式丢弃，且只找到测试构造，不能称为默认生产 caller。本实现依据原生图片 schema 接通 Axiom 用户图片，并保留其历史，不复制丢图行为。

本机 CLI 2.12.0 的可选用户 images serializer 已有[静态证据](evidence/kiro-cli-parity/README.md)，但当前完整填值 caller、当前服务限额和真实接受性仍未恢复。旧工具路径的 10 张/单张 10 MiB 是历史本地文件处理限制，不能当成当前服务全请求上限。思考原生续接、cache/controls、错误恢复等仍按[等效审计](kiro-cli-parity-audit.md)逐项推进，不能因此宣称全部能力已等效。

## 验证

本轮 Kiro 7 文件 **56/56**（图片专项 **8/8**）、通用兼容 **35/35**；full/server TypeScript 检查及生产 build 全部 exit 0，构建仅有 Vite chunk 大小警告。更新的 8 个离线特征 probe 已重新绑定新源码，原拒图结果留档，原 79 文件静态证据保持冻结。

[图片专项测试](../app/tests/kiro-images.test.ts) 覆盖原生 JSON、当前/历史/相邻合并、四格式与 JPEG 别名、并行工具 ID/status/多文本块、纯图工具、Pi Agent 三次请求的工具及续聊回放、Pi read 工具实现的图片输出转换、非法数据、全请求超限与预取消。read 的文件操作使用注入合成数据，不读取用户文件。

[目录测试](../app/tests/kiro-catalog.test.ts) 覆盖声明/未知/未来枚举/畸形元数据、能力来源、缓存往返和 V1 迁移；[runtime 测试](../app/tests/kiro-runtime.test.ts) 覆盖实时目录到导入、保存、重开、快照及 stream/streamSimple 原生图片请求。

取消验证分清层次：原生适配器预取消返回 `aborted` 且零发送，公共 SDK 请求进行中的取消由既有回归覆盖。Pi 通用 `completeSimple` 在 provider 之前的预取消仍可能映为 `error`，本轮没有修改该 SDK 行为。

实际命令、退出码、原始日志、构建、初次失败及修正过程与冻结证据核查见[本轮验收](evidence/kiro-images/README.md)。本轮只做离线 mock/loopback，不读取真实账号、不运行官方 CLI、不访问受保护服务、不部署/重启/提交；离线成功不代表真实账号已聊通或当前官方 CLI 全等效。
