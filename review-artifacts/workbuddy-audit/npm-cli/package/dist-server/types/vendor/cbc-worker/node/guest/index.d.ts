/**
 * @genie/cbc-worker/guest — what a worker's own TypeScript imports. Node builtins only: the
 * consumer's vite build inlines these modules into its single-file worker, which runs as an
 * inline worker with no node_modules (Bun single-file executable included).
 *
 * `createGuest(parentPort, { protocol })` is the guest end of the connection (the mirror of
 * WorkerHost's peer); `createHardenedContext` is the realm user code runs in.
 */
import { FramePeer, type PeerLogger, type PeerPort } from '../protocol/peer';
import type { AnyProtocol, ProtocolSpec } from '../protocol/spec';
export * from '../protocol/frames';
export * from '../protocol/spec';
export { FramePeer, type PeerPort, type PeerLogger, type RequestContext, type RequestHandler, type NoticeHandler, type RequestOptions } from '../protocol/peer';
export * from './realm';
export * from './stamp';
export interface GuestOptions {
    /** Sent in the `ready` frame; must equal the host's `protocol` option. */
    protocol: number;
    name?: string;
    logger?: PeerLogger;
}
/** The guest end: `request` / `notify` go to the host, `onRequest` / `onNotice` answer it. */
export type GuestPeer<S extends ProtocolSpec = AnyProtocol> = FramePeer<S['guest'], S['host']>;
export declare function createGuest<S extends ProtocolSpec = AnyProtocol>(port: PeerPort, options: GuestOptions): GuestPeer<S>;
//# sourceMappingURL=index.d.ts.map