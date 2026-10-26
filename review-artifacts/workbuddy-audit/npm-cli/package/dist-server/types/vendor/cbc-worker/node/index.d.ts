/**
 * @genie/cbc-worker — the worker layer shared by the REPL kernel and the function hooks worker.
 *
 * Main thread (this entry): `WorkerHost` (spawn, handshake, requests, heartbeat, death and
 * restart policy), release-line launch options, `inSession` for guest → host handlers that must
 * run inside a session's `rootScope`, and the protocol layer it is built on.
 *
 * Worker side: `@genie/cbc-worker/guest` (`createGuest`, `createHardenedContext`). Shared frame
 * types and the `FramePeer` alone: `@genie/cbc-worker/protocol`. Audits: `@genie/cbc-worker/testing`.
 */
export * from './host/launch';
export * from './host/session-scope';
export * from './host/worker-host';
export * from './protocol/frames';
export * from './protocol/peer';
export * from './protocol/spec';
//# sourceMappingURL=index.d.ts.map