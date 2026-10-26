/**
 * One aibot_msg_callback → many stream.id bubbles on the same req_id.
 * Streams assistant text only. Tool and sub-agent activity stay off WeCom.
 */
interface Bindable {
    subscribe: (listener: (event: unknown) => void) => {
        unsubscribe: () => void;
    };
}
export interface WecomStreamTransport {
    open(reqId: string, streamId: string): Promise<void>;
    push(reqId: string, streamId: string, content: string, finish: boolean): Promise<void>;
}
export declare function isRealWecomAssistantText(text: string | undefined | null): boolean;
export declare function wecomCanonicalTextDelta(event: unknown): string;
/**
 * WeCom mobile treats a later frame as "old + suffix" and appends the suffix
 * as a new line. Intermediate frames start with an alternating blank-looking
 * mark so the next full replace is not a prefix of the last displayed snapshot.
 * finish=true must keep that same marked snapshot — a clean body is treated as
 * a shorter replace and the bubble loses the rest of the text.
 */
export declare function wecomStreamWireContent(text: string, finish: boolean, generation?: number): string;
export declare class WecomBotLive {
    readonly reqId: string;
    readonly streamId: string;
    private readonly transport;
    private readonly minIntervalMs;
    private acc;
    private overflow;
    private bound;
    private closed;
    private finished;
    private sealed;
    private needBreak;
    private flip;
    private lastPushAt;
    private lastPushed;
    private lastWire;
    private timer;
    private segmentTimer;
    private sub?;
    private currentStreamId;
    private segmentChain;
    private rotating;
    constructor(reqId: string, streamId: string, transport: WecomStreamTransport, minIntervalMs?: number);
    /** Wait for in-flight bubble commits. Tests use this after a segment break. */
    whenIdle(): Promise<void>;
    get text(): string;
    get hasText(): boolean;
    get isSealed(): boolean;
    /** First frame. Must be invoked before any inbound await, then awaited before bind. */
    open(): Promise<void>;
    bind(subject: Bindable, _input?: Bindable, _phase?: Bindable): void;
    /** Stop receiving tokens. Allows a later bind after a superseded run. */
    detach(): void;
    /** Final unbind. Remaining model frames are dropped so the next live does not see them. */
    close(): void;
    ingest(event: unknown): void;
    /**
     * Close the current stream bubble so a template card can appear below it.
     * Later assistant tokens are buffered and sent as a new message.
     */
    sealForInteraction(placeholder?: string): Promise<void>;
    takeOverflow(): string;
    finish(): Promise<boolean>;
    private schedulePush;
    private flush;
    private emitFrame;
    private runSerial;
    private scheduleSegmentCommit;
    private commitCurrentSegment;
    private clearSegmentTimer;
    private commitArticleIfNeeded;
    private commitBubble;
    private ingestOverflow;
}
export {};
