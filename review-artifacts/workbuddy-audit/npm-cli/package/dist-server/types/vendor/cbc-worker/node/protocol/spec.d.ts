/**
 * The typed shape of a worker protocol: what each side may send. `host` is the main thread's
 * outbound channel, `guest` the worker's. A FramePeer in host role sends `host` and receives
 * `guest`; in guest role the other way round. Payload types are checked at compile time from
 * the spec and at run time by `assertPayload` (plain JSON only).
 *
 * @example
 * type ReplProtocol = {
 *   host: { requests: { exec: { payload: ExecRequest; reply: ExecReply } }; notices: { init: ToolsUpdate } };
 *   guest: { requests: { toolCall: { payload: ToolCallRequest; reply: ToolCallReply } }; notices: { output: OutputEvent } };
 * };
 */
export interface RequestShape {
    payload: object;
    reply: unknown;
}
export interface ChannelSpec {
    requests: Record<string, RequestShape>;
    notices: Record<string, object>;
}
export interface ProtocolSpec {
    host: ChannelSpec;
    guest: ChannelSpec;
}
/** The untyped protocol: any frame name, any plain-object payload, unknown replies. */
export interface AnyChannel {
    requests: Record<string, {
        payload: Record<string, unknown>;
        reply: unknown;
    }>;
    notices: Record<string, Record<string, unknown>>;
}
export interface AnyProtocol {
    host: AnyChannel;
    guest: AnyChannel;
}
export type RequestName<C extends ChannelSpec> = keyof C['requests'] & string;
export type NoticeName<C extends ChannelSpec> = keyof C['notices'] & string;
export type RequestPayload<C extends ChannelSpec, K extends RequestName<C>> = C['requests'][K]['payload'];
export type RequestReply<C extends ChannelSpec, K extends RequestName<C>> = C['requests'][K]['reply'];
export type NoticePayload<C extends ChannelSpec, K extends NoticeName<C>> = C['notices'][K];
/**
 * Argument tuple for `request` / `notify`: the payload may be omitted only when an empty object
 * satisfies its type (the untyped protocol, or a payload declared as `Record<string, never>`).
 */
export type PayloadArgs<P, O = never> = Record<string, never> extends P ? ([O] extends [never] ? [payload?: P] : [payload?: P, options?: O]) : ([O] extends [never] ? [payload: P] : [payload: P, options?: O]);
//# sourceMappingURL=spec.d.ts.map