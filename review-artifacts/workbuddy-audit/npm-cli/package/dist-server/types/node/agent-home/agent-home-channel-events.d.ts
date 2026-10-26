/**
 * 频道 jsonl 落盘后的进程内通知。
 * SSE 不能只靠 macOS fs.watch：append 经常丢，客户端还要等切走才重新 GET。
 */
type ChannelChangedListener = (channelId: string) => void;
export declare function notifyAgentHomeChannelChanged(channelId: string): void;
export declare function onAgentHomeChannelChanged(listener: ChannelChangedListener): () => void;
export {};
