import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { CallToolResult, ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import type { ZodRawShape } from 'zod';
/** 兼容 zod3/zod4 的 raw shape（zod4 的 shape 无 ZodRawShape 名义类型）。 */
interface ZodRawShapeV4 {
    [k: string]: any;
}
export type AnyZodRawShape = ZodRawShape | ZodRawShapeV4;
/** 从 zod raw shape 推断 handler 入参类型（zod3/4 通吃的结构式推断）。 */
export type InferShape<T extends AnyZodRawShape> = {
    [K in keyof T]: T[K] extends {
        _output: infer O;
    } ? O : never;
} & {};
export type SdkToolHandler<Schema extends AnyZodRawShape> = (args: InferShape<Schema>, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => CallToolResult | Promise<CallToolResult>;
/** 工具定义（含 handler 闭包，不可序列化——只在进程内传递）。 */
export interface SdkMcpToolDefinition<Schema extends AnyZodRawShape = AnyZodRawShape> {
    name: string;
    description: string;
    inputSchema: Schema;
    handler(...args: Parameters<SdkToolHandler<Schema>>): ReturnType<SdkToolHandler<Schema>>;
}
/** 定义一个类型安全的宿主自定义工具（schema 与 handler 入参联动）。 */
export declare function tool<Schema extends AnyZodRawShape>(name: string, description: string, inputSchema: Schema, handler: SdkToolHandler<Schema>): SdkMcpToolDefinition<Schema>;
export {};
