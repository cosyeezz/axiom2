import { Mods } from '../../../vendor/cbc-plugins/node/index.js';
export declare function customModMethods(engine: Mods.EngineInterface | undefined): Array<{
    noun: string;
    method: string;
}>;
export declare function callCustomModMethod(engine: Mods.EngineInterface | undefined, noun: string, method: string, args: unknown[]): Promise<unknown>;
export declare const RESIDENT_HOST_CAPABILITIES: readonly [{
    readonly name: "hooks";
    readonly available: true;
    readonly detail: "Registered middleware, engine.create and existing CLI lifecycle events";
}, {
    readonly name: "commands";
    readonly available: true;
    readonly detail: "Register, discover, invoke and unregister";
}, {
    readonly name: "tools";
    readonly available: true;
    readonly detail: "Schema validation and existing host permission pipeline";
}, {
    readonly name: "fs";
    readonly available: true;
    readonly detail: "Host filesystem API; trusted local code";
}, {
    readonly name: "env";
    readonly available: true;
    readonly detail: "Existing host environment API; not sent to browser";
}, {
    readonly name: "store";
    readonly available: true;
    readonly detail: "Plugin-isolated JSON storage; default/global is durable, {scope:\"session\"} is shared only within the active session runtime";
}, {
    readonly name: "clock";
    readonly available: true;
    readonly detail: "Resident timers cancelled on reload/disable";
}, {
    readonly name: "http";
    readonly available: true;
    readonly requires: "approved-authored-hash";
    readonly detail: "Outbound HTTP plus session-owned authenticated Gateway route registration; routes invoke only this plugin custom nouns and are revoked with the runtime";
}, {
    readonly name: "process";
    readonly available: true;
    readonly requires: "approved-authored-hash";
    readonly detail: "Subprocess execution through host API";
}, {
    readonly name: "model.complete";
    readonly available: true;
    readonly requires: "approved-authored-hash";
    readonly detail: "Tool-free model completion and classifier fallback";
}, {
    readonly name: "prompt";
    readonly available: true;
    readonly detail: "Fill, submit and suggest through the active session input surface; busy submissions use the existing follow-up/steer queue";
}, {
    readonly name: "prompt.read";
    readonly available: true;
    readonly detail: string;
}, {
    readonly name: "ui";
    readonly available: true;
    readonly detail: "Render, ask, interactions and invalidation; global views are user-mounted";
}, {
    readonly name: "custom-nouns";
    readonly available: true;
    readonly detail: "Discover and call plugin engine.create additions with JSON arguments";
}, {
    readonly name: "model.fork";
    readonly available: true;
    readonly requires: "approved-authored-hash";
    readonly detail: string;
}, {
    readonly name: "mcp.call";
    readonly available: true;
    readonly requires: "approved-authored-hash";
    readonly detail: "Existing deferred MCP routing, schema validation and host permission pipeline";
}, {
    readonly name: "audio";
    readonly available: false;
    readonly detail: "Host binding not implemented";
}, {
    readonly name: "session.authorize";
    readonly available: false;
    readonly detail: "Returns null: no scoped credential handle broker or HTTP handle consumer is wired. Raw credentials are not exposed to Mods.";
}];
