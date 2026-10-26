/**
 * ImageGen / VideoGen 等走 RestOperations 直发的多媒体生成工具，与 Chat 模型请求
 * 走的是不同的 HTTP 出口（Chat 在 `model-provider.ts` 的 `axiosToFetchAdapter`
 * 里注入完整会话/身份/IDE 头，多媒体工具则直接调 `RestOperations.request()`），
 * 导致这些工具的请求缺少 `X-Conversation-ID` / `X-Conversation-Request-ID` /
 * `X-Conversation-Message-ID` / `X-Request-ID` / `X-Agent-Intent` /
 * `X-Agent-Purpose` / `X-Agent-Type` / `X-Agent-Runtime` / `X-IDE-*` 等约定头，服务端无法把这些请求
 * 归到对应会话下（affects 计费归户、审计追踪、埋点关联）。
 *
 * 本 helper 抽出与 Chat 请求同源的这批头，供 ImageService / VideoService 等
 * 消费点在自己的请求头里主动注入，让「多媒体工具请求」与「Chat 请求」在会话
 * 归因维度上保持一致。
 *
 * 只处理与 session 强相关的头；`runIdentityHeaders()`（身份归因）在消费点单独
 * 展开，保留其原有的 absent-only 语义（identity.headers 压过字段组合）。
 */
import { type Session } from '../../vendor/cbc-core/node/index.js';
/**
 * 构建一次多媒体工具 HTTP 请求需要的会话/身份/IDE 头。
 *
 * - `X-Conversation-Message-ID` / `X-Request-ID` 每次调用都会重新生成（唯一 per 请求），
 *   与 chat 请求的语义保持一致；同时把新生成的 messageId 回写到 `session.messageId`，
 *   便于错误处理里从 session 上读回本次请求的 messageId 做溯源。
 * - `X-IDE-*` 优先取 `session.telemetryClientInfo`（daemon / IDE 透传），退化到
 *   `PRODUCT_TYPE`；这里不再调 `ClientInfoProvider`，保持 helper 同步、零 IO。
 */
export declare function buildConversationHeaders(session: Session): Record<string, string>;
