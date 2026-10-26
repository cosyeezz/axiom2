/** Generated CBC Web Mod author contract. Type-only; no host code is loaded. */
import type { ReactNode } from 'react';

declare type ActionsOf<H> = ResolvedStore<H> extends ModStore<unknown, infer A> ? A : never;

declare const AGENT_BROWSER_EVENTS: readonly ["agentBrowser.views", "agentBrowser.reveal", "agentBrowser.open", "agentBrowser.frame", "agentBrowser.released"];

/** Methods available through `lease.call` (page) and the endpoint (agent processes). */
declare const AGENT_BROWSER_METHODS: readonly ["lease.info", "views.create", "views.list", "views.info", "views.navigate", "views.history", "views.close", "views.wait", "views.cdp", "views.capture", "views.reveal", "views.resize", "views.attach", "views.detach", "views.screencast", "views.devtools", "webview.reserve", "cookies.set", "cookies.get", "storage.clear", "logins.replace", "logins.list", "logins.clear", "logins.fill", "dialog.confirm", "tokens.issue"];

/** Delivered only to pages holding the plugin's lease (and to that plugin's Mod scope). */
declare type AgentBrowserEvent = {
    type: 'agentBrowser.views';
    plugin: string;
    owner: string;
}
/** An agent asked to show this view; the plugin decides whether and how. */
| {
    type: 'agentBrowser.reveal';
    plugin: string;
    owner: string;
    viewId: string;
}
/** A page asked for a new window; background views already opened it as `created`, webviews leave it to the plugin. */
| {
    type: 'agentBrowser.open';
    plugin: string;
    owner: string;
    viewId: string;
    url: string;
    created?: string;
} | {
    type: 'agentBrowser.frame';
    plugin: string;
    viewId: string;
    data: string;
    mimeType: 'image/jpeg' | 'image/png';
    width: number;
    height: number;
    timestamp: number;
} | {
    type: 'agentBrowser.released';
    plugin: string;
    lease: string;
};

declare type AgentBrowserEventName = typeof AGENT_BROWSER_EVENTS[number];

declare interface AgentBrowserLeaseInfo {
    protocol: 1;
    lease: string;
    plugin: string;
    platform: string;
    /** Methods this shell implements for the lease on this platform. */
    methods: AgentBrowserMethod[];
    /** The plugin's own persistent partition (also the `partition` attribute of reserved webviews). */
    partition: string;
    /** Agent processes call `POST /v1/call {method, params}` with `Authorization: Bearer <token>` on this socket/pipe. */
    endpoint: {
        socketPath: string;
        token: string;
    };
    /** Runs Node scripts: the shell's own executable in Node mode, so agent code needs no Node installation. */
    node: {
        command: string;
        env: Record<string, string>;
    };
    natives: AgentBrowserNative[];
}

declare type AgentBrowserMethod = typeof AGENT_BROWSER_METHODS[number];

declare interface AgentBrowserNative {
    /** Bundled native component shipped with the shell for this platform, e.g. `cua-driver`. */
    name: string;
    version: string;
    /** Absolute install directory and its entry (executable or app bundle) inside it. */
    root: string;
    entry: string;
}

/** Object types that should never be mapped */
declare type AtomicObject = Function | Promise<any> | Date | RegExp;

declare type BaseRegistration<K extends ModSlotName, C extends ModChildren, H> = {
    name: K;
    order?: number;
    priority?: number;
    children?: C;
    store?: H;
} & SlotIdentity<K>;

declare type ChildKeys<C> = keyof C & ModSlotName;

declare type ChildKind<C, Kind> = {
    [K in ChildKeys<C>]: ModSlotMap[K]['kind'] extends Kind ? K : never;
}[ChildKeys<C>];

/** Convert a readonly type into a mutable type, if possible */
declare type Draft<T> = T extends PrimitiveType ? T : T extends AtomicObject ? T : T extends ReadonlyMap<infer K, infer V> ? Map<Draft<K>, Draft<V>> : T extends ReadonlySet<infer V> ? Set<Draft<V>> : T extends WeakReferences ? T : T extends object ? WritableDraft<T> : T;

/**
 * If the lib "ES2015.Collection" is not included in tsconfig.json,
 * types like ReadonlyArray, WeakMap etc. fall back to `any` (specified nowhere)
 * or `{}` (from the node types), in both cases entering an infinite recursion in
 * pattern matching type mappings
 * This type can be used to cast these types to `void` in these cases.
 */
declare type IfAvailable<T, Fallback = void> = true | false extends (T extends never ? true : false) ? Fallback : keyof T extends never ? Fallback : T;

declare type InjectArgs<K extends ModSlotName, H> = ModSlotMap[K]['scope'] extends 'session' ? (H extends undefined ? [
sessionId: string
] : [
sessionId: string,
actions: ActionsOf<H>
]) : ModSlotMap[K]['scope'] extends 'session-maybe' ? (H extends undefined ? [
sessionId: string | undefined
] : [
sessionId: string | undefined,
actions: ActionsOf<H>
]) : H extends undefined ? [
] : [
actions: ActionsOf<H>
];

declare type InjectHooksShape<H> = {
    [N in keyof H]: string extends N ? H[N] : N extends 'chat' | 'input' | 'store' | 'runtime' ? never : N extends Uncapitalize<N & string> ? H[N] : never;
};

declare const MOD_CLIENT_DESKTOP_CAPABILITIES: readonly ["shell.openExternal", "shell.openPath", "shell.revealPath", "clipboard.writeText", "notifications.show", "terminal.open", "device.info", "window.open", "window.close", "floating.show", "floating.hide", "floating.toggle", "shortcuts.register", "shortcuts.unregister", "webview.attach", "webview.update", "webview.navigate", "webview.find", "webview.detach", "agentBrowser.acquire", "agentBrowser.release", "agentBrowser.call"];

/** Structural error codes (DSH RemoteError style `<namespace>/<kind>`); identify failures with `error.isCbcDesktopError`. */
declare const MOD_CLIENT_DESKTOP_ERROR_CODES: readonly ["desktop/unavailable", "desktop/unsupported", "desktop/bad-request", "desktop/denied", "desktop/cancelled", "desktop/internal"];

declare const MOD_CLIENT_SLOTS: {
    readonly 'app.dock.tabs.item': {
        readonly kind: "list";
        readonly scope: "global";
        readonly ownerProps: readonly ["open", "mobile", "subagentOnly", "activeKind", "tabCount", "availableTools", "tab:{kind,active}", "activate()", "close()"];
        readonly description: "Contribute a native dock tab with {id,label,order?,priority?}; Component is its content. Id is namespaced by the owning Mod. Native activation, close, keyboard and drag remain. Tabs are transient and withdrawn on stop; closing does not unregister the contribution. dock.open(id) reopens it.";
    };
    readonly 'app.dock.content': {
        readonly kind: "chain";
        readonly scope: "global";
        readonly ownerProps: readonly ["open", "mobile", "subagentOnly", "activeKind", "tabCount", "availableTools", "openTool?(kind)", "collapse?()"];
        readonly description: "Select or wrap the active native dock content by activeKind. Pure select returns a match or null; unmatched/broken selectors preserve native content. The native subtree stays mounted while covered.";
    };
    readonly 'app.dock.viewer': {
        readonly kind: "chain";
        readonly scope: "global";
        readonly ownerProps: readonly ["file:{name,ext,surface,read(as,{signal?})}", "viewMode"];
        readonly description: "Select a file preview by name/ext/viewMode. file.read(text|base64) reads only this open file, bounded to 8 MiB and revoked on close. No absolute path, download URL or credentials. Unmatched/broken viewers fall back to native preview.";
    };
    readonly 'app.dock.viewer.actions': {
        readonly kind: "list";
        readonly scope: "global";
        readonly ownerProps: readonly ["file:{name,ext,surface,read(as,{signal?})}", "viewMode"];
        readonly description: "Add compact actions above the current file preview. Uses the same revocable file handle as app.dock.viewer; native source/download controls remain.";
    };
    readonly 'app.sidebar.agents.toolbar.before': {
        readonly kind: "list";
        readonly scope: "global";
        readonly parent: "app.sidebar.agents";
        readonly ownerProps: readonly ["searching", "loading", "homeEnabled", "mobile", "focusSearch()", "clearSearch()", "refresh()", "newAgent?()"];
        readonly description: "Add content at the native agent directory toolbar.before. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.";
    };
    readonly 'app.sidebar.agents.toolbar.actions': {
        readonly kind: "list";
        readonly scope: "global";
        readonly parent: "app.sidebar.agents";
        readonly ownerProps: readonly ["searching", "loading", "homeEnabled", "mobile", "focusSearch()", "clearSearch()", "refresh()", "newAgent?()"];
        readonly description: "Add content at the native agent directory toolbar.actions. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.";
    };
    readonly 'app.sidebar.agents.search.before': {
        readonly kind: "list";
        readonly scope: "global";
        readonly parent: "app.sidebar.agents";
        readonly ownerProps: readonly ["searching", "loading", "homeEnabled", "mobile", "focusSearch()", "clearSearch()", "refresh()", "newAgent?()"];
        readonly description: "Add content at the native agent directory search.before. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.";
    };
    readonly 'app.sidebar.agents.search.after': {
        readonly kind: "list";
        readonly scope: "global";
        readonly parent: "app.sidebar.agents";
        readonly ownerProps: readonly ["searching", "loading", "homeEnabled", "mobile", "focusSearch()", "clearSearch()", "refresh()", "newAgent?()"];
        readonly description: "Add content at the native agent directory search.after. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.";
    };
    readonly 'app.sidebar.agents.list.before': {
        readonly kind: "list";
        readonly scope: "global";
        readonly parent: "app.sidebar.agents";
        readonly ownerProps: readonly ["searching", "loading", "homeEnabled", "mobile", "focusSearch()", "clearSearch()", "refresh()", "newAgent?()"];
        readonly description: "Add content at the native agent directory list.before. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.";
    };
    readonly 'app.sidebar.agents.list.after': {
        readonly kind: "list";
        readonly scope: "global";
        readonly parent: "app.sidebar.agents";
        readonly ownerProps: readonly ["searching", "loading", "homeEnabled", "mobile", "focusSearch()", "clearSearch()", "refresh()", "newAgent?()"];
        readonly description: "Add content at the native agent directory list.after. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.";
    };
    readonly 'app.sidebar.agents.group.label': {
        readonly kind: "keyed";
        readonly scope: "global";
        readonly parent: "app.sidebar.agents";
        readonly ownerProps: readonly ["group:{id,label}", "rename?()"];
        readonly description: "Replace a directory section label by section id; fallback keeps the native label and rename/delete controls.";
    };
    readonly 'app.sidebar.agents.group.actions': {
        readonly kind: "list";
        readonly scope: "global";
        readonly parent: "app.sidebar.agents";
        readonly ownerProps: readonly ["group:{id,label}", "rename?()"];
        readonly description: "Add actions beside a native directory section heading.";
    };
    readonly 'app.sidebar.agents.item.badges': {
        readonly kind: "keyed";
        readonly scope: "global";
        readonly parent: "app.sidebar.agents";
        readonly ownerProps: readonly ["item:{id,active,state}", "activate()"];
        readonly description: "Add compact directory agent badges by opaque agent id; native selection, status, drag and hidden-row recovery remain. No title, preview or path is supplied.";
    };
    readonly 'app.sidebar.agents.footer': {
        readonly kind: "list";
        readonly scope: "global";
        readonly parent: "app.sidebar.agents";
        readonly ownerProps: readonly ["searching", "loading", "homeEnabled", "mobile", "focusSearch()", "clearSearch()", "refresh()", "newAgent?()"];
        readonly description: "Add content at the native agent directory footer. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.";
    };
    readonly 'app.dock.toolbar.before': {
        readonly kind: "list";
        readonly scope: "global";
        readonly ownerProps: readonly ["open", "mobile", "subagentOnly", "activeKind", "tabCount", "availableTools", "openTool?(kind)", "collapse?()"];
        readonly description: "Add content at the native workspace dock toolbar.before. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.";
    };
    readonly 'app.dock.toolbar.actions': {
        readonly kind: "list";
        readonly scope: "global";
        readonly ownerProps: readonly ["open", "mobile", "subagentOnly", "activeKind", "tabCount", "availableTools", "openTool?(kind)", "collapse?()"];
        readonly description: "Add content at the native workspace dock toolbar.actions. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.";
    };
    readonly 'app.dock.tabs.before': {
        readonly kind: "list";
        readonly scope: "global";
        readonly ownerProps: readonly ["open", "mobile", "subagentOnly", "activeKind", "tabCount", "availableTools", "openTool?(kind)", "collapse?()"];
        readonly description: "Add content at the native workspace dock tabs.before. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.";
    };
    readonly 'app.dock.tabs.after': {
        readonly kind: "list";
        readonly scope: "global";
        readonly ownerProps: readonly ["open", "mobile", "subagentOnly", "activeKind", "tabCount", "availableTools", "openTool?(kind)", "collapse?()"];
        readonly description: "Add content at the native workspace dock tabs.after. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.";
    };
    readonly 'app.dock.tab.icon': {
        readonly kind: "keyed";
        readonly scope: "global";
        readonly ownerProps: readonly ["open", "mobile", "subagentOnly", "activeKind", "tabCount", "availableTools", "openTool?(kind)", "collapse?()", "tab:{kind,active}", "activate()", "close()"];
        readonly description: "Replace a dock tab icon by kind. Render noninteractive decoration inside the native tab button; fallback is its native icon.";
    };
    readonly 'app.dock.tab.badges': {
        readonly kind: "keyed";
        readonly scope: "global";
        readonly ownerProps: readonly ["open", "mobile", "subagentOnly", "activeKind", "tabCount", "availableTools", "openTool?(kind)", "collapse?()", "tab:{kind,active}", "activate()", "close()"];
        readonly description: "Add noninteractive dock tab decoration by kind inside the native tab button. Native close, keyboard and drag controls remain.";
    };
    readonly 'app.dock.content.before': {
        readonly kind: "list";
        readonly scope: "global";
        readonly ownerProps: readonly ["open", "mobile", "subagentOnly", "activeKind", "tabCount", "availableTools", "openTool?(kind)", "collapse?()"];
        readonly description: "Add content at the native workspace dock content.before. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.";
    };
    readonly 'app.dock.content.after': {
        readonly kind: "list";
        readonly scope: "global";
        readonly ownerProps: readonly ["open", "mobile", "subagentOnly", "activeKind", "tabCount", "availableTools", "openTool?(kind)", "collapse?()"];
        readonly description: "Add content at the native workspace dock content.after. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.";
    };
    readonly 'app.dock.empty': {
        readonly kind: "single";
        readonly scope: "global";
        readonly ownerProps: readonly ["open", "mobile", "subagentOnly", "activeKind", "tabCount", "availableTools", "openTool?(kind)", "collapse?()"];
        readonly description: "Replace only dock empty-state explanatory text; native launch and recovery controls remain.";
    };
    readonly 'app.dock.footer': {
        readonly kind: "list";
        readonly scope: "global";
        readonly ownerProps: readonly ["open", "mobile", "subagentOnly", "activeKind", "tabCount", "availableTools", "openTool?(kind)", "collapse?()"];
        readonly description: "Add content at the native workspace dock footer. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.";
    };
    readonly 'app.sidebar.agents.section.before': {
        readonly kind: "list";
        readonly scope: "global";
        readonly parent: "app.sidebar.agents";
        readonly ownerProps: readonly ["group:{id,label}", "rename?()"];
        readonly description: "Add content before each native agent directory section while preserving its header and rows.";
    };
    readonly 'app.sidebar.agents.section.after': {
        readonly kind: "list";
        readonly scope: "global";
        readonly parent: "app.sidebar.agents";
        readonly ownerProps: readonly ["group:{id,label}", "rename?()"];
        readonly description: "Add content after each native agent directory section while preserving its header and rows.";
    };
    readonly 'app.sidebar.agents.item.before': {
        readonly kind: "keyed";
        readonly scope: "global";
        readonly parent: "app.sidebar.agents";
        readonly ownerProps: readonly ["item:{id,active,state}", "activate()"];
        readonly description: "Add content before a native agent directory row by opaque agent id; native selection, status, drag and hidden-row recovery remain.";
    };
    readonly 'app.sidebar.agents.item.actions': {
        readonly kind: "keyed";
        readonly scope: "global";
        readonly parent: "app.sidebar.agents";
        readonly ownerProps: readonly ["item:{id,active,state}", "activate()"];
        readonly description: "Add actions beside a native agent directory row by opaque agent id; native selection and recovery remain.";
    };
    readonly 'app.sidebar.agents.item.after': {
        readonly kind: "keyed";
        readonly scope: "global";
        readonly parent: "app.sidebar.agents";
        readonly ownerProps: readonly ["item:{id,active,state}", "activate()"];
        readonly description: "Add content after a native agent directory row by opaque agent id; native selection, status, drag and hidden-row recovery remain.";
    };
    readonly 'app.sidebar.agents.empty': {
        readonly kind: "single";
        readonly scope: "global";
        readonly parent: "app.sidebar.agents";
        readonly ownerProps: readonly ["searching", "loading", "homeEnabled", "mobile", "focusSearch()", "clearSearch()", "refresh()", "newAgent?()"];
        readonly description: "Replace only the empty agent directory message; native refresh and create controls remain.";
    };
    readonly 'app.sidebar.agents.hidden.before': {
        readonly kind: "list";
        readonly scope: "global";
        readonly parent: "app.sidebar.agents";
        readonly ownerProps: readonly ["searching", "loading", "homeEnabled", "mobile", "focusSearch()", "clearSearch()", "refresh()", "newAgent?()"];
        readonly description: "Add content before the native hidden or filtered agent recovery area.";
    };
    readonly 'app.sidebar.agents.hidden.after': {
        readonly kind: "list";
        readonly scope: "global";
        readonly parent: "app.sidebar.agents";
        readonly ownerProps: readonly ["searching", "loading", "homeEnabled", "mobile", "focusSearch()", "clearSearch()", "refresh()", "newAgent?()"];
        readonly description: "Add content after the native hidden or filtered agent recovery area.";
    };
    readonly 'app.dock.before': {
        readonly kind: "list";
        readonly scope: "global";
        readonly ownerProps: readonly ["open", "mobile", "subagentOnly", "activeKind", "tabCount", "availableTools", "openTool?(kind)", "collapse?()"];
        readonly description: "Add content immediately before the native workspace dock while preserving its layout and handlers.";
    };
    readonly 'app.dock.after': {
        readonly kind: "list";
        readonly scope: "global";
        readonly ownerProps: readonly ["open", "mobile", "subagentOnly", "activeKind", "tabCount", "availableTools", "openTool?(kind)", "collapse?()"];
        readonly description: "Add content immediately after the native workspace dock while preserving its layout and handlers.";
    };
    readonly 'app.dock.resize': {
        readonly kind: "list";
        readonly scope: "global";
        readonly ownerProps: readonly ["open", "mobile", "subagentOnly", "activeKind", "tabCount", "availableTools", "openTool?(kind)", "collapse?()"];
        readonly description: "Add content beside the native workspace dock resize handle; native pointer and keyboard resizing remain.";
    };
    readonly 'app.dock.title': {
        readonly kind: "single";
        readonly scope: "global";
        readonly ownerProps: readonly ["open", "mobile", "subagentOnly", "activeKind", "tabCount", "availableTools", "openTool?(kind)", "collapse?()"];
        readonly description: "Replace only the workspace dock title treatment; native tabs and controls remain.";
    };
    readonly 'app.dock.tab.actions': {
        readonly kind: "keyed";
        readonly scope: "global";
        readonly ownerProps: readonly ["open", "mobile", "subagentOnly", "activeKind", "tabCount", "availableTools", "openTool?(kind)", "collapse?()", "tab:{kind,active}", "activate()", "close()"];
        readonly description: "Add actions beside a native workspace dock tab by tab kind; native activation, close, keyboard and drag controls remain.";
    };
    readonly 'app.dock.plus.before': {
        readonly kind: "list";
        readonly scope: "global";
        readonly ownerProps: readonly ["open", "mobile", "subagentOnly", "activeKind", "tabCount", "availableTools", "openTool?(kind)", "collapse?()"];
        readonly description: "Add content immediately before the native workspace dock plus or launcher control.";
    };
    readonly 'app.dock.plus.after': {
        readonly kind: "list";
        readonly scope: "global";
        readonly ownerProps: readonly ["open", "mobile", "subagentOnly", "activeKind", "tabCount", "availableTools", "openTool?(kind)", "collapse?()"];
        readonly description: "Add content immediately after the native workspace dock plus or launcher control.";
    };
    readonly 'app.dock.launcher.before': {
        readonly kind: "list";
        readonly scope: "global";
        readonly ownerProps: readonly ["open", "mobile", "subagentOnly", "activeKind", "tabCount", "availableTools", "openTool?(kind)", "collapse?()"];
        readonly description: "Add content before the native workspace dock launcher menu while preserving its trigger and focus behavior.";
    };
    readonly 'app.dock.launcher.after': {
        readonly kind: "list";
        readonly scope: "global";
        readonly ownerProps: readonly ["open", "mobile", "subagentOnly", "activeKind", "tabCount", "availableTools", "openTool?(kind)", "collapse?()"];
        readonly description: "Add content after the native workspace dock launcher menu while preserving its trigger and focus behavior.";
    };
    readonly 'app.dock.launcher.item': {
        readonly kind: "keyed";
        readonly scope: "global";
        readonly ownerProps: readonly ["open", "mobile", "subagentOnly", "activeKind", "tabCount", "availableTools", "openTool?(kind)", "collapse?()", "tool:{kind}", "open()"];
        readonly description: "Add content beside a native workspace dock launcher item by stable tool kind; native availability, focus and open behavior remain.";
    };
    readonly 'app.dock.context.before': {
        readonly kind: "list";
        readonly scope: "global";
        readonly ownerProps: readonly ["open", "mobile", "subagentOnly", "activeKind", "tabCount", "availableTools", "openTool?(kind)", "collapse?()"];
        readonly description: "Add content before the native workspace dock context menu while preserving native close actions.";
    };
    readonly 'app.dock.context.after': {
        readonly kind: "list";
        readonly scope: "global";
        readonly ownerProps: readonly ["open", "mobile", "subagentOnly", "activeKind", "tabCount", "availableTools", "openTool?(kind)", "collapse?()"];
        readonly description: "Add content after the native workspace dock context menu while preserving native close actions.";
    };
    readonly 'app.content': {
        readonly kind: "single";
        readonly scope: "global";
        readonly description: "Replace the main workspace layout. fallback is the original workspace, including Chat and its dock.";
    };
    readonly 'app.navigation': {
        readonly kind: "single";
        readonly scope: "global";
        readonly description: "Replace the navigation and agent directory. fallback preserves the native navigation.";
    };
    readonly 'app.toolbar': {
        readonly kind: "list";
        readonly scope: "session";
        readonly description: "Add controls to the existing status toolbar; do not cover native controls.";
    };
    readonly 'session.header.actions': {
        readonly kind: "list";
        readonly scope: "session";
        readonly ownerProps: readonly ["mainChatActive", "jobId", "switching", "openHistory?()"];
        readonly description: "Add compact actions beside native conversation header controls. sessionId is the selected main or embedded conversation, not necessarily the page connection. openHistory uses the existing owner handler; it is unavailable while switching. Native new-chat, history, export and dock controls stay reachable.";
    };
    readonly 'session.header.utilities': {
        readonly kind: "list";
        readonly scope: "session";
        readonly ownerProps: readonly ["mainChatActive", "jobId", "switching", "openHistory?()"];
        readonly description: "Add compact indicators beside native conversation header actions, scoped to the selected conversation. Absent in non-conversation views or before a session exists.";
    };
    readonly 'app.overlay': {
        readonly kind: "list";
        readonly scope: "global";
        readonly description: "Add an unframed browser overlay. Own its placement; no OS desktop window.";
    };
    readonly 'app.sidebar.rail': {
        readonly kind: "single";
        readonly scope: "global";
        readonly description: "Replace only the dashboard navigation rail, preserving the agent directory.";
    };
    readonly 'app.sidebar.agents': {
        readonly kind: "single";
        readonly scope: "global";
        readonly description: "Replace only the agent directory, preserving the navigation rail.";
    };
    readonly 'app.sidebar.header': {
        readonly kind: "single";
        readonly scope: "global";
        readonly parent: "app.sidebar.rail";
        readonly ownerProps: readonly ["mainView", "expanded", "mobile", "navigate(view)", "openAgents()"];
        readonly description: "Replace the rail header band. Native brand mark/name/actions outlets remain only if fallback is preserved.";
    };
    readonly 'app.sidebar.header.actions': {
        readonly kind: "list";
        readonly scope: "global";
        readonly parent: "app.sidebar.header";
        readonly ownerProps: readonly ["mainView", "expanded", "mobile", "navigate(view)", "openAgents()"];
        readonly description: "Add compact controls beside the native brand button. Render an accessible icon at compact rail width.";
    };
    readonly 'app.sidebar.before': {
        readonly kind: "list";
        readonly scope: "global";
        readonly parent: "app.sidebar.rail";
        readonly ownerProps: readonly ["mainView", "expanded", "mobile", "navigate(view)", "openAgents()"];
        readonly description: "Add rail content before native navigation entries; keep compact/expanded presentation responsive.";
    };
    readonly 'app.sidebar.item': {
        readonly kind: "keyed";
        readonly scope: "global";
        readonly parent: "app.sidebar.rail";
        readonly ownerProps: readonly ["mainView", "expanded", "mobile", "navigate(view)", "openAgents()", "item:{id,label,active}", "activate()"];
        readonly description: "Replace one native navigation entry by exact key: agents/editor/tasks/canvas/plugins/mods/remote-control. Use activate() for its native action, fallback to preserve its button. Conditional entries only mount when available.";
    };
    readonly 'app.sidebar.after': {
        readonly kind: "list";
        readonly scope: "global";
        readonly parent: "app.sidebar.rail";
        readonly ownerProps: readonly ["mainView", "expanded", "mobile", "navigate(view)", "openAgents()"];
        readonly description: "Add native-owner navigation controls after the existing entries; each contribution is placed in a host row, so keep the returned element interactive content rather than another sized layout shell. navigate() uses App routing and closes the mobile drawer.";
    };
    readonly 'app.sidebar.footer': {
        readonly kind: "list";
        readonly scope: "global";
        readonly parent: "app.sidebar.rail";
        readonly ownerProps: readonly ["mainView", "expanded", "mobile", "navigate(view)", "openAgents()"];
        readonly description: "Add compact controls to one footer band above the account/settings trigger; the host wraps each contribution in a stable row and constrains rail width, so return the control itself and keep native account and recovery controls reachable.";
    };
    readonly 'app.sidebar.account': {
        readonly kind: "single";
        readonly scope: "global";
        readonly parent: "app.sidebar.rail";
        readonly ownerProps: readonly ["mainView", "expanded", "mobile", "navigate(view)", "openAgents()"];
        readonly description: "Replace the account/settings presentation; fallback contains the native account menu, not credentials. Preserve a route to settings and recovery.";
    };
    readonly 'app.brand.mark': {
        readonly kind: "single";
        readonly scope: "global";
        readonly ownerProps: readonly ["surface:sidebar", "size", "expanded", "defaultSource"];
        readonly description: "Replace the brand image inside native sidebar buttons. Return image/icon content only, not another button; native click and accessible label remain. Multiple occurrences receive their own size/surface.";
    };
    readonly 'app.brand.name': {
        readonly kind: "single";
        readonly scope: "global";
        readonly parent: "app.sidebar.header";
        readonly ownerProps: readonly ["surface:sidebar", "expanded", "defaultName"];
        readonly description: "Replace visible sidebar wordmark content. Native header retains its button and compact mode hides the name.";
    };
    readonly 'app.brand.artwork': {
        readonly kind: "single";
        readonly scope: "global";
        readonly ownerProps: readonly ["surface:welcome", "compact", "defaultSource", "defaultName"];
        readonly description: "Replace only welcome artwork, keeping the native caption, path and composer. Current skin welcome:hidden still controls visibility.";
    };
    readonly 'app.page': {
        readonly kind: "list";
        readonly scope: "global";
        readonly ownerProps: readonly ["page:{id,label,standalone}", "openPage(id)", "navigate(view)"];
        readonly description: "Add a whole Mod-owned page with a stable id, label, optional icon (short glyph or data:image URL) and order. Each page gets a native entry at the very top of the sidebar rail and the route #/app/<id>; #/app/<id>?standalone renders it without the shell (desktop windows and floating panels). Chat stays resident.";
    };
    readonly 'app.view': {
        readonly kind: "keyed";
        readonly scope: "global";
        readonly description: "Replace a selected auxiliary page by entryKey equal to its mainView (settings, mods, tasks, etc). Chat stays resident.";
    };
    readonly 'chat.workspace': {
        readonly kind: "chain";
        readonly scope: "session";
        readonly description: "Select a presentation of the real Chat workspace using register({select}); use slots.wrap and next() for explicit wrapping that preserves native Chat, approval and composer behavior.";
    };
    readonly 'chat.before': {
        readonly kind: "list";
        readonly scope: "session";
        readonly description: "Add content before the chat workspace.";
    };
    readonly 'chat.after': {
        readonly kind: "list";
        readonly scope: "session";
        readonly description: "Add content after the chat workspace.";
    };
    readonly 'chat.view': {
        readonly kind: "list";
        readonly scope: "session";
        readonly description: "Add a selectable conversation tab with stable id (not chat), optional dynamic label and order. The selected view renders with native Chat retained and the native composer, queue and approvals unchanged.";
    };
    readonly 'chat.welcome': {
        readonly kind: "single";
        readonly scope: "session";
        readonly description: "Replace the welcome content; fallback is the native welcome.";
    };
    readonly 'chat.composer.before': {
        readonly kind: "list";
        readonly scope: "session";
        readonly description: "Add controls above the existing input. Native approvals and sending stay intact.";
    };
    readonly 'chat.composer.after': {
        readonly kind: "list";
        readonly scope: "session";
        readonly description: "Add controls below the existing input.";
    };
    readonly 'chat.composer': {
        readonly kind: "chain";
        readonly scope: "session";
        readonly description: "Take over composer presentation with a pure select(owner) returning a match or null. The native textarea stays mounted but hidden; use standard useInput and inputActions, not next() or a duplicated send loop.";
    };
    readonly 'chat.input.dock': {
        readonly kind: "list";
        readonly scope: "session";
        readonly description: "A full-width band above the native input card. Receives input snapshot and controlled inputActions.";
    };
    readonly 'chat.input.overlay': {
        readonly kind: "list";
        readonly scope: "session";
        readonly description: "Native input-card overlay anchor; own positioning and do not obscure approvals.";
    };
    readonly 'chat.input.left': {
        readonly kind: "list";
        readonly scope: "session";
        readonly description: "Left side of the native composer tools row. Receives input and inputActions.";
    };
    readonly 'chat.input.right': {
        readonly kind: "list";
        readonly scope: "session";
        readonly description: "Right side of the native composer tools row, before send. Receives input and inputActions.";
    };
    readonly 'chat.input.after': {
        readonly kind: "list";
        readonly scope: "session";
        readonly description: "Band below the native input card.";
    };
    readonly 'command.item': {
        readonly kind: "keyed";
        readonly scope: "session";
        readonly ownerProps: readonly ["command:{name,type,description}", "key"];
        readonly description: "Add an annotation or action inside one native slash-command menu item, keyed by the exact command name. It cannot replace the native command button or its execution.";
    };
    readonly 'model.item': {
        readonly kind: "keyed";
        readonly scope: "session";
        readonly ownerProps: readonly ["model:{id,name,meta,current}", "key"];
        readonly description: "Add an annotation or action inside one native model selector item, keyed by the exact model id. It cannot replace native model selection or thinking-level controls.";
    };
    readonly 'mode.item': {
        readonly kind: "keyed";
        readonly scope: "session";
        readonly ownerProps: readonly ["mode:{id,name,description,current}", "key"];
        readonly description: "Add an annotation or action inside one native mode/permission-selector item, keyed by the exact mode id. It cannot replace native mode selection.";
    };
    readonly 'preset.item': {
        readonly kind: "keyed";
        readonly scope: "global";
        readonly ownerProps: readonly ["preset:{id,name,description,default,custom,scope}", "key"];
        readonly description: "Add an annotation or action inside one native main-agent preset row, keyed by the exact preset id. It cannot replace default selection, file management, deletion or Create-mode actions.";
    };
    readonly 'chat.message': {
        readonly kind: "single";
        readonly scope: "session";
        readonly description: "Replace assistant message body presentation. Receives message:{id,content,streaming}; fallback is the original body.";
    };
    readonly 'chat.message.actions': {
        readonly kind: "list";
        readonly scope: "session";
        readonly description: "Actions on a finalized assistant message; message id/content are provided. No actions while streaming.";
    };
    readonly 'chat.turn.tail': {
        readonly kind: "chain";
        readonly scope: "session";
        readonly description: "Route supplemental finalized assistant group content before the native footer.";
    };
    readonly 'chat.tool': {
        readonly kind: "keyed";
        readonly scope: "session";
        readonly description: "Tool-call presentation keyed by the exact tool name. Receives toolCall data; fallback preserves native call and existing Mods render folds.";
    };
    readonly 'chat.tool.result': {
        readonly kind: "keyed";
        readonly scope: "session";
        readonly description: "Expanded tool result keyed by exact tool name. Receives toolCall; fallback preserves native output and render folds.";
    };
    readonly 'tool.detail': {
        readonly kind: "keyed";
        readonly scope: "session";
        readonly ownerProps: readonly ["toolCall:{id,name,kind,status}", "key"];
        readonly description: "Append an annotation or action to the expanded native tool-call detail, keyed by the exact tool-call id. It cannot replace the native result, copy actions or tool approval state.";
    };
    readonly 'task.detail': {
        readonly kind: "keyed";
        readonly scope: "session";
        readonly ownerProps: readonly ["task:{id,toolCallId?,running?,seen?,exitStatus?,endReason?,kind?:scheduled,cron?,humanSchedule?,enabled?,recurring?,durable?,createdAt?,lastFiredAt?}", "execution?:{id,taskId,status,sessionId?,runId?,startedAt?,completedAt?,durationMs?,inputTokens?,outputTokens?,totalTokens?}", "surface:dock|inline", "key"];
        readonly description: "Append an annotation or action to native background-terminal or scheduled-task details, keyed by native task id. Scheduled cards and execution details project current task/execution metadata; dock and expanded mobile occurrences retain native controls. No output, command, cwd, prompt or error body is projected, and no second task store is created.";
    };
    readonly 'subagent.detail': {
        readonly kind: "keyed";
        readonly scope: "session";
        readonly ownerProps: readonly ["subagent:{toolCallId,name,type?,status,background}", "surface:dock|inline", "key"];
        readonly description: "Append an annotation or action to native subagent dock or expanded inline details, keyed by the parent tool-call id. It receives native identity/status, without prompts, results or transcripts. Native history, copy actions and navigation remain reachable.";
    };
    readonly 'settings.before': {
        readonly kind: "list";
        readonly scope: "global";
        readonly description: "Add settings content before the native header.";
    };
    readonly 'settings.row': {
        readonly kind: "list";
        readonly scope: "global";
        readonly ownerProps: readonly ["settingKey", "type", "scope", "value", "inherited"];
        readonly description: "Add an action or annotation inside each native settings row. It receives the exact setting key/type/current effective value and cannot replace the native control.";
    };
    readonly 'settings.action': {
        readonly kind: "keyed";
        readonly scope: "global";
        readonly ownerProps: readonly ["settingKey", "type", "scope", "value", "inherited", "key"];
        readonly description: "Add a compact annotation or action in the native settings control band, keyed by the exact setting key. Projects the current effective value and user/project scope; native reset and editor controls remain. Does not expose a second settings writer.";
    };
    readonly 'settings.after': {
        readonly kind: "list";
        readonly scope: "global";
        readonly description: "Add settings content after native sections.";
    };
    readonly 'plugins.page': {
        readonly kind: "list";
        readonly scope: "global";
        readonly ownerProps: readonly ["activeTab", "loading", "installedCount", "enabledCount", "marketplaceCount"];
        readonly description: "Add content above native plugin management results. Receives native tab/loading/count metadata, without plugin paths, configuration or credentials. Native install, approval, enable, disable and recovery controls remain.";
    };
};

declare const MOD_NAVIGATION_VIEWS: readonly ["chat", "tasks", "plugins", "mods", "terminal", "canvas", "canvas-pane", "remote-control", "hosts", "settings", "docs", "editor", "editor-page", "changes", "metrics", "workers", "logs", "keybindings", "stats", "traces", "app"];

export declare type ModAgents = ModObservable<ModAgentsSnapshot>;

export declare interface ModAgentScope extends ModObservable<ModAgentSnapshot> {
    readonly sessionId: string;
    readonly signal?: AbortSignal;
    check(): void;
    effect(setup: () => ModDisposer): ModDisposer;
}

export declare interface ModAgentSnapshot {
    sessionId: string | null;
    agentId: string | null;
    jobId: string | null;
    attached: boolean;
    readOnly: boolean;
    connection: string;
    binding: string;
    running: boolean;
    pendingApproval: boolean;
    phase: string | null;
    progress: string | null;
    stopReason: string | null;
    job: null | {
        id: string;
        state: string;
        status?: string;
        alive?: boolean;
        settled?: boolean;
        detail?: string;
        cwd: string;
    };
}

export declare interface ModAgentsSnapshot {
    enabled: boolean | null;
    loading: boolean;
    defaultAgentId: string | null;
    agents: Array<{
        id: string;
        name: string;
        description?: string;
        homeCwd?: string | null;
        primaryJobId?: string | null;
    }>;
    groups: Array<{
        id: string;
        name: string;
        memberAgentIds: string[];
    }>;
    channels: Array<{
        id: string;
        name: string;
        memberAgentIds: string[];
        transcriptId?: string;
    }>;
    sections: Array<{
        id: string;
        name: string;
        sortIndex?: number;
    }>;
    jobAssignments: Record<string, string>;
}

export declare interface ModApprovalEvent {
    pending: boolean;
    count: number;
    sessionId: string | null;
}

export declare interface ModAssets {
    read(path: string, options?: {
        signal?: AbortSignal;
    }): Promise<Blob>;
    url(path: string, options?: {
        signal?: AbortSignal;
    }): Promise<string>;
    release(url: string): void;
}

export declare type ModBoundActions<A> = {
    [K in keyof A]: A[K] extends (draft: never, ...args: infer Args) => unknown ? (...args: Args) => void : never;
};

export declare interface ModBrandArtworkOwner {
    surface: 'welcome';
    compact: boolean;
    defaultSource: string;
    defaultName: string;
}

export declare interface ModBrandMarkOwner {
    surface: 'sidebar';
    size: number;
    expanded: boolean;
    defaultSource: string;
}

export declare interface ModBrandNameOwner {
    surface: 'sidebar';
    expanded: boolean;
    defaultName: string;
}

export declare interface ModChat extends ModObservable<ModChatSnapshot> {
    useChat: ModSelector<ModChatSnapshot>;
    fill(text: string): void;
    submit(text: string): Promise<unknown>;
}

export declare interface ModChatSnapshot {
    sessionId: string | null;
    running: boolean;
    messages: Array<{
        id: string;
        role: string;
        content: string;
        streaming: boolean;
    }>;
}

/** Native slots already exist, so only author-declared names can be children (runtime rejects duplicates). */
export declare type ModChildren = {
    [K in Exclude<ModSlotName, keyof NativeSlots>]?: Pick<ModSlotMap[K], 'kind'> & {
        scope?: ModSlotMap[K]['scope'];
        description?: string;
    };
};

export declare interface ModClientDefinition<Inject extends readonly (keyof ModServiceMap & string)[]> {
    slotContract?: 'strict' | 'legacy';
    inject: Inject;
    provides?: readonly (keyof ModServiceMap & string)[];
    /** Exact service interface revisions. Only injected names may be constrained; omit to retain legacy name-only matching. */
    serviceVersions?: Partial<Record<Inject[number], number>>;
    apply(ctx: ModContext<Inject>): void | ModDisposer;
}

declare type ModClientDesktopCapability = typeof MOD_CLIENT_DESKTOP_CAPABILITIES[number];

declare type ModClientDesktopErrorCode = typeof MOD_CLIENT_DESKTOP_ERROR_CODES[number];

/** Pushed by the native shell to the page that owns the resource (`carrier.subscribe`); agent browser events reach lease holders only. */
declare type ModClientDesktopEvent = {
    type: 'shortcut';
    id: string;
} | {
    type: 'window.closed';
    page: string;
    view?: string;
} | {
    type: 'floating.visibility';
    page: string;
    view?: string;
    visible: boolean;
} | ({
    type: 'webview';
    id: string;
} & ModClientDesktopWebviewEvent) | AgentBrowserEvent;

/** Native web view lifecycle, delivered to the view's handle (`desktop.webviews.attach`). */
declare type ModClientDesktopWebviewEvent = {
    kind: 'state';
    url: string;
    title: string;
    loading: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
} | {
    kind: 'failed';
    code: number;
    description: string;
    url: string;
} | {
    kind: 'open';
    url: string;
    disposition?: string;
} | {
    kind: 'key';
    key: string;
} | {
    kind: 'found';
    active: number;
    total: number;
};

declare interface ModClientInspectMethod {
    name: string;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
}

declare interface ModClientInspectProvider {
    id: string;
    description: string;
    methods: ModClientInspectMethod[];
    owner?: string;
}

export declare type ModContext<Inject extends readonly (keyof ModServiceMap & string)[]> = ModContextBase & Pick<ModServiceMap, Inject[number]>;

export declare interface ModContextBase {
    get<K extends keyof ModServiceMap & string>(name: K): ModServiceMap[K] | undefined;
    provide<K extends keyof ModServiceMap & string>(name: K, value: ModServiceMap[K], contract?: {
        description?: string;
        signatures?: readonly string[];
        apiVersion?: number;
    }): ModDisposer;
    registerEvent(name: keyof ModEventMap & string, contract: {
        description: string;
        signature: string;
    }): ModDisposer;
    registerInspect(provider: ModInspectDefinition): ModDisposer;
    on<K extends keyof ModEventMap & string>(name: K, listener: (...args: ModEventMap[K] extends unknown[] ? ModEventMap[K] : never) => unknown): ModDisposer;
    emit<K extends keyof ModEventMap & string>(name: K, ...args: ModEventMap[K] extends unknown[] ? ModEventMap[K] : never): void;
    effect: ModEffect;
}

export declare interface ModDesktop {
    readonly protocolVersion: 1;
    readonly platform: string;
    readonly capabilities: readonly ModClientDesktopCapability[];
    has(capability: string): boolean;
    readonly shell: {
        openExternal(url: string): Promise<void>;
        openPath(path: string): Promise<void>;
        revealPath(path: string): Promise<void>;
    };
    readonly clipboard: {
        writeText(text: string): Promise<void>;
    };
    readonly notifications: {
        show(notification: {
            title: string;
            body?: string;
            tag?: string;
        }): Promise<void>;
    };
    readonly terminal: {
        open(request: {
            cwd: string;
            title?: string;
            command?: readonly string[];
        }): Promise<void>;
    };
    deviceInfo(): Promise<string>;
    /** Native window showing this origin's `#/app/<page>?standalone`; reopening focuses it. */
    readonly windows: {
        open(page: string, options?: {
            title?: string;
            width?: number;
            height?: number;
            view?: string;
        }): Promise<void>;
        close(page: string, view?: string): Promise<void>;
    };
    /** One frameless, always-on-top panel per `app.page`, visible on every workspace; `placement:'center'` centers it on the cursor's display (re-centered on every show). */
    readonly floating: {
        show(page: string, options?: {
            width?: number;
            height?: number;
            hideOnBlur?: boolean;
            view?: string;
            placement?: 'top-right' | 'center';
        }): Promise<{
            visible: boolean;
        }>;
        hide(page: string, view?: string): Promise<{
            visible: boolean;
        }>;
        toggle(page: string, options?: {
            width?: number;
            height?: number;
            hideOnBlur?: boolean;
            view?: string;
            placement?: 'top-right' | 'center';
        }): Promise<{
            visible: boolean;
        }>;
    };
    /**
     * Native http(s) web views docked over a slot element of this page and following its position (at most 8 per Mod).
     * The shell only places the view and reports its state; render the toolbar, loading and error states yourself.
     * The view stays hidden until its document is ready, so the slot's own placeholder shows meanwhile.
     */
    readonly webviews: {
        attach(slot: ModDesktopWebviewSlot, options: ModDesktopWebviewOptions): Promise<ModDesktopWebview>;
    };
    /** Global OS shortcut (modifier or F-key required); dispose, Mod stop or page reload unregisters it. */
    readonly shortcuts: {
        register(accelerator: string, callback: () => unknown): Promise<() => Promise<void>>;
    };
    /** Agent browser primitives of the desktop shell (`has('agentBrowser.acquire')`); the Mod builds its own browser on them. */
    readonly agentBrowser: ModDesktopAgentBrowser;
    on(event: 'window.closed' | 'floating.visibility', callback: (event: ModClientDesktopEvent) => unknown): () => void;
}

export declare interface ModDesktopAgentBrowser {
    readonly available: boolean;
    /** This plugin's lease for the Mod scope (shared by repeated calls); released when the scope stops. Nothing exists before it. `label` names the plugin in shell prompts. */
    acquire(options?: {
        label?: string;
    }): Promise<ModDesktopAgentBrowserLease>;
}

export declare interface ModDesktopAgentBrowserLease extends AgentBrowserLeaseInfo {
    /** One primitive (see AGENT_BROWSER_METHODS); page-only methods (attach/detach/screencast/webview.reserve) act for this page. */
    call<T = unknown>(method: AgentBrowserMethod, params?: Record<string, unknown>): Promise<T>;
    /** Events of this plugin's lease only. */
    on(event: AgentBrowserEventName, callback: (event: AgentBrowserEvent) => unknown): () => void;
    release(): Promise<void>;
}

/** Optional desktop shell bridge; absent in plain Web UI. Read it with ctx.get('desktop') and branch on has(capability). */
export declare interface ModDesktopError extends Error {
    readonly isCbcDesktopError: true;
    readonly code: ModClientDesktopErrorCode;
}

export declare interface ModDesktopWebview {
    readonly id: string;
    navigate(url: string, options?: {
        cookies?: readonly ModDesktopWebviewCookie[];
    }): Promise<void>;
    back(): Promise<void>;
    forward(): Promise<void>;
    reload(): Promise<void>;
    stop(): Promise<void>;
    /** Empty text clears the highlight; results arrive as `found`. */
    find(text: string, options?: {
        forward?: boolean;
        findNext?: boolean;
    }): Promise<void>;
    /** Hide without detaching, e.g. while your own overlay covers the slot (native views always paint above the page). */
    setVisible(visible: boolean): Promise<void>;
    /** Re-measure the slot now; resize, scroll and layout changes are also followed automatically. */
    sync(): void;
    /** Without an `open` listener, a page opening a new window navigates this view instead. */
    on<K extends ModClientDesktopWebviewEvent['kind']>(kind: K, callback: (event: Extract<ModClientDesktopWebviewEvent, {
        kind: K;
    }>) => unknown): () => void;
    dispose(): Promise<void>;
}

/** Electron cookie fields; `domain` defaults to the loaded host, `expirationDate` is seconds since the epoch. */
export declare interface ModDesktopWebviewCookie {
    name: string;
    value: string;
    domain?: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
    expirationDate?: number;
    sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
}

export declare interface ModDesktopWebviewOptions {
    url: string;
    /** Seeded into the shared persistent web view session before loading; only the loaded site or its parent domains. */
    cookies?: readonly ModDesktopWebviewCookie[];
    /** Keys claimed from the web page (Escape, function keys, modified accelerators such as CommandOrControl+F); delivered as `key`. */
    keys?: readonly string[];
    visible?: boolean;
}

/** The DOM element the view covers. */
export declare interface ModDesktopWebviewSlot {
    getBoundingClientRect(): {
        left: number;
        top: number;
        width: number;
        height: number;
    };
    readonly isConnected?: boolean;
}

export declare type ModDisposer = () => void;

export declare type ModEffect = (setup: () => void | ModDisposer) => ModDisposer;

export declare interface ModEventMap {
    'file.open': [
    file: ModFileHandle
    ];
    'chat.change': [
    snapshot: ModChatSnapshot
    ];
    'agent.change': [
    snapshot: ModAgentSnapshot
    ];
    'theme.change': [
    theme: 'light' | 'dark'
    ];
    'slots.change': [
    ];
    'goal.change': [
    snapshot: ModGoalSnapshot
    ];
    'usage.change': [
    usage: ModUsageSnapshot | null
    ];
    'workspace.change': [
    snapshot: ModWorkspaceSnapshot
    ];
    'agents.change': [
    snapshot: ModAgentsSnapshot
    ];
    'connection.change': [
    connection: {
        status: string;
        sessionId: string | null;
        switching: boolean;
    }
    ];
    'jobs.change': [
    change: {
        type: string;
        jobId?: string;
        sessionId?: string;
    }
    ];
    'skills.change': [
    snapshot: ModSkillsSnapshot
    ];
    'session.change': [
    change: ModSessionEvent
    ];
    'model.change': [
    change: ModModelEvent
    ];
    'tool.change': [
    change: ModToolEvent
    ];
    'approval.change': [
    change: ModApprovalEvent
    ];
}

declare interface ModFileHandle {
    readonly name: string;
    readonly ext: string;
    readonly surface: 'dock' | 'editor';
    /** Read only this open file, up to 8 MiB. Closing the preview aborts pending reads. */
    read(as: 'text' | 'base64', options?: {
        signal?: AbortSignal;
    }): Promise<string>;
}

declare interface ModFileViewerOwner {
    file: ModFileHandle;
    viewMode: string;
}

export declare interface ModForkResult {
    sessionId: string;
    sourceSessionId: string;
    cwd: string;
    atMessageId: string | null;
    opened: boolean;
}

export declare interface ModGlobalProps {
    runtime: ModRuntime;
    useRuntime: ModSelector<ModAgentSnapshot>;
    chat: ModChat;
    useChat: ModSelector<ModChatSnapshot>;
    host: ModHost;
}

export declare interface ModGoal extends ModObservable<ModGoalSnapshot> {
    get(): Promise<ModGoalSnapshot>;
    set(condition: string): Promise<ModGoalSnapshot>;
    clear(): Promise<ModGoalSnapshot>;
    pause(): Promise<ModGoalSnapshot>;
    resume(): Promise<ModGoalSnapshot>;
}

export declare interface ModGoalSnapshot {
    sessionId: string | null;
    active: {
        condition: string;
        createdAt: number;
        turnCount?: number;
        paused?: boolean;
        pausedAt?: number;
    } | null;
    latest: {
        ok: boolean;
        reason?: string;
        condition: string;
        durationMs: number;
        turnCount: number;
        tokenDelta: number;
    } | null;
}

export declare interface ModHost {
    /**
     * Calls this Mod's own host noun. By default it runs on the selected Chat's agent (keeping its permission/input
     * context). `{ scope: 'page' }` runs on this Web UI page's host instead, for page-owned work that needs no Chat.
     */
    call(noun: string, method: string, args?: ModJson[], options?: {
        scope?: 'chat' | 'page';
    }): Promise<unknown>;
}

export declare type ModInjected<I> = Omit<I, 'hooks'> & (I extends {
    hooks: infer Hooks extends Record<string, ModObservable<unknown>>;
} ? {
    [K in keyof Hooks & string as `use${Capitalize<K>}`]: Hooks[K] extends ModObservable<infer S> ? ModSelector<S> : never;
} : object);

/** Valid inject results: no reserved names, no use* functions (declare hooks instead), hook names start lowercase and avoid reserved hooks. */
export declare type ModInjectShape<I> = {
    [K in keyof I]: K extends ModReservedProp ? never : K extends 'hooks' ? InjectHooksShape<I[K]> : K extends `use${Capitalize<string>}` ? (I[K] extends (...args: never[]) => unknown ? never : I[K]) : I[K];
};

export declare interface ModInput extends ModObservable<ModInputSnapshot | undefined> {
    useInput<T>(selector: (snapshot: ModInputSnapshot) => T): T | undefined;
    readonly actions: ModInputActions;
}

export declare interface ModInputActions {
    setText(text: string): void;
    insertText(text: string): void;
    setSelection(start: number, end?: number): void;
    addFiles(files: File[]): Promise<void>;
    removeAttachment(id: string): void;
    clear(): void;
    focus(): void;
    blur(): void;
    submit(): Promise<void>;
    cancel(): Promise<void>;
}

export declare interface ModInputSnapshot {
    readonly sessionId: string;
    readonly text: string;
    readonly selection: Readonly<{
        start: number;
        end: number;
    }>;
    readonly attachments: ReadonlyArray<Readonly<{
        id: string;
        kind: 'image' | 'file';
        name: string;
        mimeType: string;
        size?: number;
    }>>;
    readonly running: boolean;
    readonly canSend: boolean;
    readonly preparing: boolean;
    readonly readOnly: boolean;
}

export declare interface ModInspect {
    register(provider: ModInspectDefinition): ModDisposer;
    list(): ModClientInspectProvider[];
}

export declare interface ModInspectDefinition {
    manifest: {
        id: string;
        description: string;
        methods: readonly {
            name: string;
            inputSchema: ModJson;
            outputSchema: ModJson;
        }[];
    };
    query(method: string, input: ModJson | undefined, context: {
        signal: AbortSignal;
    }): unknown | Promise<unknown>;
}

export declare interface ModJob extends ModJobSummary {
    shortId?: string;
    needs?: string;
    suggestedReply?: string;
    output?: Record<string, string>;
    worktreePath?: string;
    worktreeBranch?: string;
    exec?: string;
    pinned?: boolean;
    group?: string;
}

export declare interface ModJobCreate {
    prompt: string;
    cwd?: string;
    agent?: string;
    model?: string;
    bgIsolation?: 'none' | 'worktree';
    effort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'auto' | 'dontAsk' | 'bypassPermissions';
}

export declare type ModJobState = 'working' | 'blocked' | 'done' | 'failed' | 'stopped';

export declare interface ModJobSummary {
    id: string;
    sessionId?: string;
    cwd: string;
    state: ModJobState;
    status?: 'busy' | 'idle' | 'waiting' | 'stopped';
    startedAt: number;
    updatedAt?: number;
    name?: string;
    intent?: string;
    detail?: string;
    tempo?: string;
    alive?: boolean;
    settled?: boolean;
    foregroundHeld?: boolean;
}

export declare type ModJson = null | boolean | number | string | ModJson[] | {
    [key: string]: ModJson;
};

export declare interface ModLayout extends ModObservable<{
    sidebarOpen: boolean;
    agentsOpen: boolean;
    workspaceOpen: boolean;
    workspaceWidth: number;
}> {
    setSidebarOpen(open: boolean): void;
    setAgentsOpen(open: boolean): void;
    setWorkspaceOpen(open: boolean): void;
    setWorkspaceWidth(width: number): void;
}

export declare interface ModLocale extends ModObservable<{
    mode: 'zh' | 'en' | 'system';
    resolved: 'zh' | 'en';
}> {
    setLocale(mode: 'zh' | 'en' | 'system'): void;
    /** Namespaces are local to this Mod identity; candidate versions shadow and roll back together. */
    register(namespace: string, dictionary: {
        zh: Record<string, string>;
        en: Record<string, string>;
    }): ModDisposer;
    t(namespace: string, key: string, params?: Record<string, string | number>): string;
    useT(namespace: string): (key: string, params?: Record<string, string | number>) => string;
}

export declare type ModMatch = string | number | boolean | symbol | bigint | (object & {
    then?: never;
});

export declare interface ModMessage {
    id: string;
    content: string;
    streaming: boolean;
}

export declare interface ModModelEvent {
    type: 'start' | 'delta' | 'complete' | 'error';
    sessionId: string | null;
    phase: string | null;
    outputChars: number;
    stopReason: string | null;
    errorCategory: string | null;
    modelId: string | null;
    modelName: string | null;
    effort: string | null;
}

export declare type ModMutators<S> = Record<string, (draft: Draft<S>, ...args: never[]) => unknown>;

export declare type ModNativeOwner<K> = K extends 'chat.message' | 'chat.message.actions' | 'chat.turn.tail' ? {
    message: ModMessage;
} : K extends 'app.dock.viewer' | 'app.dock.viewer.actions' ? ModFileViewerOwner : K extends 'app.dock.tabs.item' ? ModWorkspaceDockTabOwner : K extends `app.dock.tab.${string}` ? ModWorkspaceDockTabOwner : K extends `app.dock.${string}` ? ModWorkspaceDockOwner : K extends 'chat.tool' | 'chat.tool.result' ? {
    toolCall: ModToolCall;
} : K extends 'chat.composer' | `chat.input.${string}` ? {
    input: ModInputSnapshot | null;
} : K extends 'chat.view' ? {
    selectedView: string;
} : K extends 'session.header.actions' | 'session.header.utilities' ? ModSessionHeaderOwner : K extends 'settings.row' | 'settings.action' ? ModSettingOwner : K extends 'plugins.page' ? ModPluginsPageOwner : K extends 'app.sidebar.item' ? ModSidebarItemOwner : K extends 'app.page' ? ModPageOwner : K extends 'app.sidebar.header' | 'app.sidebar.header.actions' | 'app.sidebar.before' | 'app.sidebar.after' | 'app.sidebar.footer' | 'app.sidebar.account' ? ModSidebarOwner : K extends 'app.brand.mark' ? ModBrandMarkOwner : K extends 'app.brand.name' ? ModBrandNameOwner : K extends 'app.brand.artwork' ? ModBrandArtworkOwner : object;

export declare type ModNavigationView = typeof MOD_NAVIGATION_VIEWS[number];

export declare interface ModObservable<S> {
    getSnapshot(): S;
    subscribe(listener: () => void): ModDisposer;
}

export declare type ModOwner<K extends ModSlotName> = ModSlotMap[K] extends {
    owner: infer O extends object;
} ? O : object;

export declare interface ModPage<T> {
    items: T[];
    offset: number;
    limit: number;
    hasMore: boolean;
    nextOffset: number | null;
}

/** Owner props of an `app.page` occurrence. `standalone` is true inside a desktop window or floating panel (no shell). */
export declare interface ModPageOwner {
    /** `view` is the optional sub-view a desktop window / floating panel was opened with (`#/app/<id>?standalone=1&view=<view>`). */
    page: {
        id: string;
        label: string;
        standalone: boolean;
        view?: string;
    };
    /** Opens another registered `app.page` (or this one) through native App routing. */
    openPage(id: string): void;
    navigate(view: ModNavigationView): void;
}

export declare interface ModPageQuery {
    offset?: number;
    limit?: number;
}

export declare interface ModPluginsPageOwner {
    activeTab: 'installed' | 'browse' | 'marketplaces';
    loading: boolean;
    installedCount: number;
    enabledCount: number;
    marketplaceCount: number;
}

export declare interface ModRateLimited<A extends unknown[]> {
    (...args: A): void;
    cancel(): void;
    flush(): void;
    pending(): boolean;
    dispose(): void;
}

export declare interface ModRateOptions extends ModTimerOptions {
    leading?: boolean;
    trailing?: boolean;
}

export declare interface ModRenderOptions {
    entryKey?: string;
    only?: string;
    fallback?: ReactNode;
    overlay?: boolean;
}

/** Props the framework owns; inject returning one throws at runtime. */
export declare type ModReservedProp = 'sessionId' | 'fallback' | 'next' | 'matched' | 'useChat' | 'chat' | 'useInput' | 'inputActions' | 'useStore' | 'actions' | 'renderSlot' | 'renderSlotChain' | 'runtime' | 'useRuntime' | 'agentScope' | 'host';

export declare interface ModRuntime extends ModObservable<ModAgentSnapshot> {
    useRuntime: ModSelector<ModAgentSnapshot>;
    forSession(sessionId: string): ModAgentScope;
    onSession(setup: (scope: ModAgentScope) => void | ModDisposer): ModDisposer;
}

export declare type ModSelector<S> = <T>(selector: (snapshot: S) => T) => T;

/** Augment for typed cross-Mod services; ctx.get remains optional even for known providers. */
export declare interface ModServiceMap {
    commands: {
        register(definition: {
            id: string;
            label: {
                zh: string;
                en: string;
            };
        }, run: (context: {
            signal: AbortSignal;
        }) => void | Promise<void>): ModDisposer;
        list(): Array<{
            id: string;
            label: {
                zh: string;
                en: string;
            };
        }>;
        execute(id: string, options?: {
            signal?: AbortSignal;
        }): Promise<void>;
    };
    assets: ModAssets;
    /** `handleLinks(id, open)`: plain clicks on http(s) chat links open this Mod's dock tab `id` and call `open(url)` (newest claim wins; disposed with the scope). */
    dock: {
        open(id: string): string;
        close(id: string): void;
        handleLinks(id: string, open: (url: string) => unknown): () => void;
    };
    runtime: ModRuntime;
    slots: ModSlots;
    chat: ModChat;
    input: ModInput;
    layout: ModLayout;
    locale: ModLocale;
    sessions: ModSessions;
    goal: ModGoal;
    usage: ModObservable<ModUsageSnapshot | null>;
    workspace: ModWorkspace;
    agents: ModAgents;
    settings: ModSettings;
    skills: ModSkills;
    subagents: ModSubagents;
    inspect: ModInspect;
    theme: ModTheme;
    timer: ModTimer;
    /** Optional: present only inside a desktop shell. */
    desktop: ModDesktop;
}

export declare interface ModSessionEvent {
    type: 'bound' | 'unbound' | 'switch';
    sessionId: string | null;
    previousSessionId: string | null;
    status: string;
}

export declare interface ModSessionHeaderOwner {
    mainChatActive: boolean;
    jobId: string | null;
    switching: boolean;
    /** Opens the native history for the selected conversation. */
    openHistory?: () => void;
}

export declare interface ModSessionProps {
    sessionId: string;
    agentScope: ModAgentScope;
    useInput: ModInput['useInput'];
    inputActions: ModInputActions;
}

export declare interface ModSessions {
    create(input: ModJobCreate): Promise<Partial<ModJob> & Pick<ModJob, 'id'>>;
    list(query?: ModPageQuery & {
        cwd?: string;
        all?: boolean;
        states?: ModJobState[];
        search?: string;
    }): Promise<ModPage<ModJobSummary>>;
    history(query?: ModPageQuery & {
        cwd?: string;
        agentId?: string;
        includeAttached?: boolean;
    }): Promise<ModPage<{
        sessionId: string;
        label: string;
        updatedAt: number;
        pinned?: boolean;
        firstUserMessage?: string;
        lastUserMessage?: string;
    }>>;
    detail(jobId: string): Promise<ModJob>;
    reply(jobId: string, text: string): Promise<unknown>;
    stop(jobId: string): Promise<unknown>;
    resume(target: {
        jobId: string;
        sessionId?: never;
        cwd?: never;
    } | {
        sessionId: string;
        cwd?: string;
        jobId?: never;
    }): Promise<Partial<ModJob> & Pick<ModJob, 'id'>>;
    transcript(target: {
        jobId: string;
        sessionId?: string;
    } | {
        sessionId: string;
        jobId?: never;
    }, query?: ModPageQuery): Promise<ModPage<unknown> & {
        kind: 'job' | 'session';
        sessionId?: string;
        cwd?: string;
        snapshot?: unknown;
    }>;
    open(sessionId: string, cwd?: string): Promise<boolean>;
    createForeground(): Promise<string>;
    forkPoints(query: {
        sessionId: string;
        limit?: number;
        beforeMessageId?: string;
    }): Promise<{
        sessionId: string;
        items: Array<{
            id: string;
            role: 'user' | 'assistant';
            preview: string;
            timestamp?: number;
        }>;
        hasMore: boolean;
        nextBeforeMessageId: string | null;
    }>;
    fork(input: {
        sessionId: string;
        atMessageId: string | null;
        open?: boolean;
    }): Promise<ModForkResult>;
    subscribe(callback: (change: {
        type: 'snapshot' | 'added' | 'changed' | 'removed';
        jobId?: string;
        sessionId?: string;
    }) => unknown): ModDisposer;
}

export declare interface ModSettingOwner {
    settingKey: string;
    type: string;
    scope: 'user' | 'project';
    value: unknown;
    inherited: boolean;
}

export declare interface ModSettings {
    getRuntimeDefaults(cwd?: string): Promise<{
        cwd: string;
        model: string | null;
        permissionMode: string | null;
    }>;
    setPermissionMode(mode: 'default' | 'acceptEdits' | 'plan' | 'auto' | 'dontAsk' | 'bypassPermissions' | 'fullAccess'): Promise<void>;
    /** Write one host-allowlisted project setting for the selected workspace. */
    setProject(path: string, value: unknown): Promise<void>;
}

export declare interface ModSidebarItemOwner extends ModSidebarOwner {
    item: {
        id: string;
        label: string;
        active: boolean;
    };
    activate(): void;
}

export declare interface ModSidebarOwner {
    mainView: ModNavigationView;
    expanded: boolean;
    mobile: boolean;
    navigate(view: ModNavigationView): void;
    openAgents(): void;
}

export declare interface ModSkillItem {
    name: string;
    description: string;
    source: string;
}

export declare interface ModSkills extends ModObservable<ModSkillsSnapshot> {
    list(): ModSkillItem[];
    get(name: string): ModSkillItem | null;
}

export declare interface ModSkillsSnapshot {
    sessionId: string | null;
    skills: ModSkillItem[];
}

export declare type ModSlotKind = 'single' | 'list' | 'keyed' | 'chain';

/** Augment this table to type your declared child slots. Declaration alone does not make an outlet exist. */
export declare interface ModSlotMap extends NativeSlots {
    'chat.view': {
        kind: 'list';
        scope: 'session';
        owner: {
            selectedView: string;
        };
    };
}

export declare type ModSlotName = keyof ModSlotMap & string;

export declare type ModSlotProps<K extends ModSlotName, C = object, H = undefined, I extends object = object, M = never> = ModOwner<K> & ModGlobalProps & ScopeProps<K> & StoreProps<H> & ModInjected<I> & {
    fallback: ReactNode;
    renderSlot<N extends ChildKind<C, 'single' | 'list' | 'keyed'>>(name: N, ...args: RenderArgs<N>): ReactNode;
    renderSlotChain<N extends ChildKind<C, 'chain'>>(name: N, ...args: RenderArgs<N>): ReactNode;
} & (ModSlotMap[K]['kind'] extends 'chain' ? {
    matched: M;
} : object);

export declare interface ModSlots {
    register<K extends ModSlotName, C extends ModChildren = object, H extends ModStoreDeclaration | undefined = undefined, I extends ModInjectShape<I> & object = object, M extends ModMatch = ModMatch>(options: BaseRegistration<K, C, H> & SelectorOption<K, M> & {
        inject?: (...args: InjectArgs<K, H>) => I;
    }, component: (props: ModSlotProps<K, NoInfer<C>, NoInfer<H>, NoInfer<I>, NoInfer<M>>) => ReactNode): ModDisposer;
    wrap<K extends Exclude<{
        [N in ModSlotName]: ModSlotMap[N]['kind'] extends 'chain' ? N : never;
    }[ModSlotName], 'chat.composer'>, C extends ModChildren = object, H extends ModStoreDeclaration | undefined = undefined, I extends ModInjectShape<I> & object = object>(options: BaseRegistration<K, C, H> & {
        select?: never;
        inject?: (...args: InjectArgs<K, H>) => I;
    }, component: (props: Omit<ModSlotProps<K, NoInfer<C>, NoInfer<H>, NoInfer<I>>, 'matched'> & {
        next(props?: Partial<ModOwner<K>>): ReactNode;
    }) => ReactNode): ModDisposer;
    defineStore<S, A extends ModMutators<S>>(spec: {
        init(): S;
        actions: A & ModMutators<S>;
        persist?: string;
        persistence?: {
            version: number;
            validate(state: unknown): boolean;
            migrate?(state: unknown, context: {
                fromVersion: number;
                toVersion: number;
            }): S;
        };
    }): ModStoreHandle<S, ModBoundActions<A>>;
    inject(name: ModSlotName, setup: () => void | ModDisposer): ModDisposer;
    list(name: ModSlotName): Array<{
        id: string;
        key?: string;
        owner: string;
        order: number;
        priority: number;
        label?: string;
    }>;
    snapshot(root?: ModSlotName): Array<{
        name: string;
        kind: ModSlotKind;
        scope: string;
        mounted: boolean;
        description: string;
        declaredBy?: string;
        parent?: string;
        occupants: Array<{
            owner: string;
            id: string;
            key?: string;
            order: number;
            priority: number;
            active: boolean;
        }>;
    }>;
    subscribe(listener: () => unknown): ModDisposer;
}

export declare type ModSlotScope = 'global' | 'root' | 'session-maybe' | 'session';

export declare interface ModSlotSpec {
    kind: ModSlotKind;
    scope: ModSlotScope;
    owner?: object;
}

export declare interface ModStore<S = unknown, A = object> extends ModObservable<S> {
    actions: A;
    dispose?(): void;
}

export declare type ModStoreDeclaration = ModStoreHandle | ((sessionId?: string) => ModStore | ModStoreHandle);

export declare interface ModStoreHandle<S = unknown, A = object> {
    create(sessionId?: string): ModStore<S, A>;
}

export declare interface ModStyles {
    insert(css: string): ModDisposer;
}

export declare interface ModSubagent {
    id: string;
    description: string;
    type: string;
    status: 'running' | 'completed' | 'failed' | 'unknown';
    parentToolCallId?: string;
}

export declare interface ModSubagents {
    list(query?: ModPageQuery & {
        parentToolCallId?: string;
    }): Promise<ModPage<ModSubagent>>;
    detail(id: string, query?: ModPageQuery): Promise<ModPage<{
        type: 'message';
        id: string;
        content: string;
        streaming: boolean;
        thinking: boolean;
    } | {
        type: 'user_message';
        id: string;
        content: string;
        imageCount: number;
    } | {
        type: 'tool_call';
        toolCallId: string;
        name: string;
        toolName: string;
        kind: string;
        status: ModSubagent['status'];
        subagent: boolean;
    }> & {
        subagent: ModSubagent;
    }>;
    open(id: string): Promise<boolean>;
    subscribe(callback: (change: {
        type: 'changed' | 'binding';
    }) => unknown): ModDisposer;
}

export declare interface ModTheme extends ModObservable<{
    mode: 'light' | 'dark' | 'system';
    resolved: 'light' | 'dark';
    skinId: string | null;
    skin: UiSkin | null;
}> {
    setMode(mode: 'light' | 'dark' | 'system'): void;
    register(id: string, skin: UiSkin): ModDisposer;
    list(): Array<{
        key: string;
        id: string;
        owner: string;
        name: string;
        description: string;
    }>;
    select(id: string | null): void;
    overrideTokens(layer: Pick<UiSkin, 'light' | 'dark'> & {
        tokens?: SkinTokens;
    }): ModDisposer;
}

export declare interface ModTimer {
    every(ms: number, callback: () => unknown, options?: ModTimerOptions): ModDisposer;
    after(ms: number, callback: () => unknown, options?: ModTimerOptions): ModDisposer;
    delay(ms: number, signal?: AbortSignal): Promise<void>;
    debounce<A extends unknown[]>(ms: number, callback: (...args: A) => unknown, options?: ModRateOptions): ModRateLimited<A>;
    throttle<A extends unknown[]>(ms: number, callback: (...args: A) => unknown, options?: ModRateOptions): ModRateLimited<A>;
}

export declare interface ModTimerOptions {
    signal?: AbortSignal;
}

export declare interface ModToolCall {
    id: string;
    toolName: string;
    name: string;
    kind: string;
    status: string;
    input: unknown;
    result: unknown;
    locations?: readonly {
        path: string;
        line?: number;
    }[];
    parentToolCallId?: string;
}

export declare interface ModToolEvent {
    type: 'start' | 'result';
    sessionId: string | null;
    id: string;
    toolName: string;
    name: string;
    kind: string;
    status: 'running' | 'completed' | 'failed';
}

export declare interface ModUsageSnapshot {
    sessionId?: string;
    used: number;
    size: number;
    cost?: {
        amount: number;
        currency: string;
    };
    usageByCategory?: unknown;
    updatedAt: number;
}

export declare interface ModWorkspace extends ModObservable<ModWorkspaceSnapshot> {
    select(cwd: string): ModWorkspaceSnapshot;
    open(cwd: string): ModWorkspaceSnapshot;
    list(): string[];
    /** Create and select a real directory through the native filesystem service. */
    create(cwd: string): Promise<ModWorkspaceSnapshot>;
    /** Rename a real directory through the native filesystem protocol. */
    rename(source: string, destination: string): Promise<ModWorkspaceSnapshot>;
}

declare interface ModWorkspaceDockOwner {
    open: boolean;
    mobile: boolean;
    subagentOnly: boolean;
    activeKind: string | null;
    tabCount: number;
    availableTools: readonly ModWorkspaceDockTool[];
    openTool?: (kind: ModWorkspaceDockTool) => void;
    collapse?: () => void;
}

declare interface ModWorkspaceDockTabOwner extends ModWorkspaceDockOwner {
    tab: {
        kind: string;
        active: boolean;
    };
    activate(): void;
    close(): void;
}

declare type ModWorkspaceDockTool = 'explorer' | 'editor' | 'search' | 'scm' | 'terminal' | 'changes' | 'apps';

export declare interface ModWorkspaceSnapshot {
    cwd: string | null;
    agentCwd: string | null;
    explicit: boolean;
    initialized: boolean;
    directories: string[];
}

declare type NativeSlots = {
    [K in keyof typeof MOD_CLIENT_SLOTS]: {
        kind: typeof MOD_CLIENT_SLOTS[K]['kind'];
        scope: typeof MOD_CLIENT_SLOTS[K]['scope'];
        owner: ModNativeOwner<K>;
    };
};

declare type PrimitiveType = number | string | boolean;

declare type RenderArgs<N extends ModSlotName> = object extends ModOwner<N> ? [
props?: ModOwner<N>,
options?: RenderOptionsOf<N>
] : [
props: ModOwner<N>,
options?: RenderOptionsOf<N>
];

/** The outlet honors entryKey only for keyed, only for list and overlay only for chain; overlay elsewhere hides every occupant. */
declare type RenderOptionsOf<N extends ModSlotName> = ModSlotMap[N]['kind'] extends 'keyed' ? {
    fallback?: ReactNode;
    entryKey?: string;
} : ModSlotMap[N]['kind'] extends 'list' ? {
    fallback?: ReactNode;
    only?: string;
} : ModSlotMap[N]['kind'] extends 'chain' ? {
    fallback?: ReactNode;
    overlay?: boolean;
} : {
    fallback?: ReactNode;
};

declare type ResolvedStore<H> = H extends (...args: never[]) => infer R ? ResolvedStore<R> : H extends ModStoreHandle<infer S, infer A> ? ModStore<S, A> : H;

declare type ScopeProps<K extends ModSlotName> = ModSlotMap[K]['scope'] extends 'session' ? ModSessionProps : ModSlotMap[K]['scope'] extends 'session-maybe' ? Partial<ModSessionProps> : {
    sessionId?: string | null;
};

declare type SelectorOption<K extends ModSlotName, M> = ModSlotMap[K]['kind'] extends 'chain' ? {
    select(owner: ModOwner<K>): M | null;
} : {
    select?: never;
};

declare const SKIN_COLOR_TOKENS: readonly ["bg-primary", "bg-secondary", "bg-tertiary", "bg-input", "bg-card", "bg-user", "bg-hover", "bg-code", "bg-hover-strong", "bg-chip", "border-default", "border-muted", "border-input", "border-field", "border-field-focus", "border-card", "text-primary", "text-body", "text-secondary", "text-label", "text-tertiary", "text-user", "text-link", "accent-brand", "accent-brand-foreground", "accent-blue", "accent-green", "accent-red", "accent-yellow", "accent-orange", "accent-purple", "chat-body", "chat-muted", "chat-subtle", "chat-thinking-line", "chat-thinking-bg", "chat-tool-hover", "focus-ring", "disabled-text", "disabled-bg", "error-bg", "warning-bg", "success-bg", "info-bg", "composer-border", "composer-menu-active", "composer-menu-current", "composer-menu-active-border", "composer-send", "composer-send-hover", "bg-channel", "border-channel", "channel-accent", "bg-diff-add", "bg-diff-del", "scrollbar", "scrollbar-hover", "markdown-code", "composer-glow", "bot-avatar-outline", "bot-avatar-shadow", "canvas-grid-minor", "canvas-grid-major", "canvas-tile-border", "canvas-tile-border-selected", "canvas-tile-header", "canvas-tile-header-text", "canvas-selection-fill", "canvas-selection-stroke", "login-bg", "login-btn-bg", "login-btn-text", "login-text-primary", "login-text-secondary", "login-ellipse-border", "login-ellipse-border2"];

declare interface SkinBackground {
    image: string;
    size: 'cover' | 'contain' | 'tile';
    position: 'center' | 'top' | 'bottom' | 'left' | 'right';
    opacity: number;
    overlay: string;
    overlayOpacity: number;
    panelOpacity: number;
    chatOpacity?: number;
    sidebarOpacity?: number;
    composerOpacity?: number;
    messageOpacity?: number;
    menuOpacity?: number;
    settingsOpacity?: number;
    surfaceBlur?: number;
}

declare type SkinColors = Partial<Record<SkinColorToken, string>>;

declare type SkinColorToken = typeof SKIN_COLOR_TOKENS[number];

export declare interface SkinTokens {
    light: SkinTokenValues;
    dark: SkinTokenValues;
}

/** Dual-mode CSS custom property overrides: `--name` to one bounded CSS value, per palette mode. */
declare type SkinTokenValues = Record<string, string>;

declare interface SkinWelcome {
    mode: 'default' | 'hidden' | 'image';
    image?: string;
}

declare type SlotIdentity<K extends ModSlotName> = K extends 'app.page' ? {
    id: string;
    key?: never;
    label: string | (() => string);
    icon?: string;
} : K extends 'app.dock.tabs.item' ? {
    id: string;
    key?: never;
    label: string | (() => string);
} : ModSlotMap[K]['kind'] extends 'list' ? {
    id: string;
    key?: never;
    label?: string | (() => string);
} : ModSlotMap[K]['kind'] extends 'keyed' ? {
    key: string;
    id?: string;
    label?: never;
} : {
    id?: string;
    key?: never;
    label?: never;
};

declare type StoreProps<H> = ResolvedStore<H> extends ModStore<infer S, infer A> ? {
    useStore: ModSelector<S>;
    actions: A;
} : object;

export declare interface UiSkin {
    name: string;
    description: string;
    light: SkinColors;
    dark: SkinColors;
    tokens?: SkinTokens;
    font?: 'system' | 'mono';
    radius?: number;
    background?: SkinBackground;
    welcome?: SkinWelcome;
}

/**
 * These should also never be mapped but must be tested after regular Map and
 * Set
 */
declare type WeakReferences = IfAvailable<WeakMap<any, any>> | IfAvailable<WeakSet<any>>;

declare type WritableDraft<T> = {
    -readonly [K in keyof T]: Draft<T[K]>;
};

export { }

/** Standard prebuilt modules receive these bindings from the approved client evaluator. */
declare global {
    const host: ModHost;
    const styles: ModStyles;
}
