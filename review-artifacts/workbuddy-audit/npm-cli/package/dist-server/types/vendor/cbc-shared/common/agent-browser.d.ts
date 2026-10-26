/**
 * Agent browser primitives (protocol 1): the native shell's lease-scoped browser building blocks.
 *
 * The shell implements only what needs its process or guards a security boundary: web views and their page-local CDP,
 * the plugin's own storage partition and saved sign-ins, native confirmation, and an authenticated endpoint for agent
 * processes. Everything else (tabs, address bar, presentation, imports, when to show what) belongs to the plugin.
 *
 * Nothing exists until a plugin acquires a lease. A lease is per plugin; pages holding it keep it alive, and it ends
 * when the last holder releases it (or 30 s after the last holder page went away), closing its views and revoking its
 * tokens. Plugins may restrict further but cannot widen: http(s) only, no other plugin's views, no plaintext secrets.
 */
export declare const AGENT_BROWSER_PROTOCOL = 1;
/** Methods available through `lease.call` (page) and the endpoint (agent processes). */
export declare const AGENT_BROWSER_METHODS: readonly ['lease.info', 'views.create', 'views.list', 'views.info', 'views.navigate', 'views.history', 'views.close', 'views.wait', 'views.cdp', 'views.capture', 'views.reveal', 'views.resize', 'views.attach', 'views.detach', 'views.screencast', 'views.devtools', 'webview.reserve', 'cookies.set', 'cookies.get', 'storage.clear', 'logins.replace', 'logins.list', 'logins.clear', 'logins.fill', 'dialog.confirm', 'tokens.issue'];
export type AgentBrowserMethod = typeof AGENT_BROWSER_METHODS[number];
/** Need the calling page (where to attach, who receives frames, which document hosts the webview). */
export declare const AGENT_BROWSER_PAGE_METHODS: readonly ["views.attach", "views.detach", "views.screencast", "views.devtools", "webview.reserve"];
/** What an owner-scoped endpoint token may call; `views.*` are further limited to that owner's views. */
export declare const AGENT_BROWSER_SCOPED_METHODS: readonly ["lease.info", "views.create", "views.list", "views.info", "views.navigate", "views.history", "views.close", "views.wait", "views.cdp", "views.capture", "views.reveal", "views.resize", "logins.fill", "dialog.confirm"];
/** Exist only where the shell can keep secrets (safeStorage) — check `lease.methods`. */
export declare const AGENT_BROWSER_LOGIN_METHODS: readonly ["logins.replace", "logins.list", "logins.clear", "logins.fill"];
export interface AgentBrowserNative {
    /** Bundled native component shipped with the shell for this platform, e.g. `cua-driver`. */
    name: string;
    version: string;
    /** Absolute install directory and its entry (executable or app bundle) inside it. */
    root: string;
    entry: string;
}
export interface AgentBrowserLeaseInfo {
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
export interface AgentBrowserView {
    id: string;
    /** Plugin-chosen group, normally the CBC session id. */
    owner: string;
    /** `background`: shell-owned view that keeps working with no page showing it; `webview`: a reserved `<webview>` in a page. */
    kind: 'background' | 'webview';
    url: string;
    title: string;
    loading: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
    crashed: boolean;
    /** 站点图标；about:blank、未声明图标或加载中尚未拿到时为 ''。 */
    favicon: string;
    /** Natively shown over a page area (`views.attach`): real input, a context menu with Inspect, DevTools and browser shortcuts. */
    attached: boolean;
    /** Streaming frames to a page (`views.screencast`). */
    screencast: boolean;
    viewport: {
        width: number;
        height: number;
    };
    createdAt: number;
}
export interface AgentBrowserLogin {
    id: string;
    origin: string;
    username: string;
}
export interface AgentBrowserCookie {
    url: string;
    name: string;
    value: string;
    domain?: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
    expirationDate?: number;
    sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
}
/** Delivered only to pages holding the plugin's lease (and to that plugin's Mod scope). */
export type AgentBrowserEvent = {
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
export declare const AGENT_BROWSER_EVENTS: readonly ['agentBrowser.views', 'agentBrowser.reveal', 'agentBrowser.open', 'agentBrowser.frame', 'agentBrowser.released'];
export type AgentBrowserEventName = typeof AGENT_BROWSER_EVENTS[number];
export declare const AGENT_BROWSER_DOCS: readonly ['agentBrowser (shell primitives, protocol 1): acquire({label?}) → lease {lease,plugin,platform,methods,partition,endpoint{socketPath,token},node{command,env},natives[{name,version,root,entry}]} plus call(method,params), on(event,cb), release(); released with the Mod scope', 'views.create({owner,url?,viewport?}) background view (works hidden); views.list({owner?})/info/navigate({viewId,url http(s)})/history({viewId,action back|forward|reload|stop})/close/wait({viewId,timeoutMs?})/resize({viewId,width,height})', 'views.cdp({viewId,method,params}) page-local CDP allowlist (DOM/Accessibility/Runtime/Page/Input…, no Target/Browser/Storage/navigation); views.capture({viewId,format png|jpeg,quality?}); views.reveal({viewId}) emits agentBrowser.reveal', 'page only: views.attach({viewId,rect CSS px}) native, user-interactive view over the area (its viewport follows the area) / views.detach; views.devtools({viewId,x?,y?}) opens DevTools (inspecting x,y); views.screencast({viewId,action start|stop,quality?,maxWidth?,maxHeight?}) frames as agentBrowser.frame; webview.reserve({owner,url?}) → {viewId,partition,src} for <webview partition src>', 'cookies.set({cookies:[{url,name,value,...}]})/cookies.get({url})/storage.clear() on the plugin partition; logins.replace({entries:[{origin,username,password}]})/list/clear; logins.fill({viewId,loginId?}) asks the user natively, never returns passwords', 'dialog.confirm({message,detail?,buttons[1-6],defaultId?,cancelId?,kind?}) → {response}; tokens.issue({owner}) → {token} limited to that owner\'s views for agent processes', 'events: agentBrowser.views {owner} | agentBrowser.reveal {owner,viewId} | agentBrowser.open {viewId,url,created?} | agentBrowser.frame {viewId,data,mimeType,width,height} | agentBrowser.released'];
//# sourceMappingURL=agent-browser.d.ts.map