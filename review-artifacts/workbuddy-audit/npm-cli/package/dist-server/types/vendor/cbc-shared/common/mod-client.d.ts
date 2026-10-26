import { type AgentBrowserEvent } from './agent-browser';
/** Public browser extension seats. The same declarations teach the model and admit registrations. */
export interface ModClientDiagnosticDetails {
    phase: 'load' | 'prepare' | 'activate' | 'render';
    code: string;
    slot?: string;
    guidance: string;
    stack?: string;
}
export declare const MOD_NAVIGATION_VIEWS: readonly ['chat', 'tasks', 'plugins', 'mods', 'terminal', 'canvas', 'canvas-pane', 'remote-control', 'hosts', 'settings', 'docs', 'editor', 'editor-page', 'changes', 'metrics', 'workers', 'logs', 'keybindings', 'stats', 'traces', 'app'];
export type ModNavigationView = typeof MOD_NAVIGATION_VIEWS[number];
export interface ModAgentDirectoryOwner {
    searching: boolean;
    loading: boolean;
    homeEnabled: boolean;
    mobile: boolean;
    focusSearch(): void;
    clearSearch(): void;
    refresh(): void;
    newAgent?: () => void;
}
export interface ModAgentDirectoryGroupOwner {
    group: {
        id: string;
        label: string;
    };
    rename?: () => void;
}
export interface ModAgentDirectoryItemOwner {
    item: {
        id: string;
        active: boolean;
        state: string;
    };
    activate(): void;
}
export type ModWorkspaceDockTool = 'explorer' | 'editor' | 'search' | 'scm' | 'terminal' | 'changes' | 'apps';
export interface ModWorkspaceDockOwner {
    open: boolean;
    mobile: boolean;
    subagentOnly: boolean;
    activeKind: string | null;
    tabCount: number;
    availableTools: readonly ModWorkspaceDockTool[];
    openTool?: (kind: ModWorkspaceDockTool) => void;
    collapse?: () => void;
}
export interface ModWorkspaceDockTabOwner extends ModWorkspaceDockOwner {
    tab: {
        kind: string;
        active: boolean;
    };
    activate(): void;
    close(): void;
}
export interface ModFileHandle {
    readonly name: string;
    readonly ext: string;
    readonly surface: 'dock' | 'editor';
    /** Read only this open file, up to 8 MiB. Closing the preview aborts pending reads. */
    read(as: 'text' | 'base64', options?: {
        signal?: AbortSignal;
    }): Promise<string>;
}
export interface ModFileViewerOwner {
    file: ModFileHandle;
    viewMode: string;
}
export interface ModSidebarOwner {
    mainView: ModNavigationView;
    expanded: boolean;
    mobile: boolean;
    navigate(view: ModNavigationView): void;
    openAgents(): void;
}
export interface ModSidebarItemOwner extends ModSidebarOwner {
    item: {
        id: string;
        label: string;
        active: boolean;
    };
    activate(): void;
}
/** Owner props of an `app.page` occurrence. `standalone` is true inside a desktop window or floating panel (no shell). */
export interface ModPageOwner {
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
/** `#/app/<id>` route of a Mod page; `standalone` adds the shell-free query used by desktop windows. */
export declare const MOD_PAGE_ID: RegExp;
export declare const MOD_PAGE_VIEW: RegExp;
export declare function modPageRoute(id: string, standalone?: boolean, view?: string): string;
export interface ModBrandMarkOwner {
    surface: 'sidebar';
    size: number;
    expanded: boolean;
    defaultSource: string;
}
export interface ModBrandNameOwner {
    surface: 'sidebar';
    expanded: boolean;
    defaultName: string;
}
export interface ModBrandArtworkOwner {
    surface: 'welcome';
    compact: boolean;
    defaultSource: string;
    defaultName: string;
}
export interface ModSessionHeaderOwner {
    mainChatActive: boolean;
    jobId: string | null;
    switching: boolean;
    /** Opens the native history for the selected conversation. */
    openHistory?: () => void;
}
export interface ModSettingOwner {
    settingKey: string;
    type: string;
    scope: 'user' | 'project';
    value: unknown;
    inherited: boolean;
}
export interface ModPluginsPageOwner {
    activeTab: 'installed' | 'browse' | 'marketplaces';
    loading: boolean;
    installedCount: number;
    enabledCount: number;
    marketplaceCount: number;
}
export declare const MOD_CLIENT_SLOTS: {
    readonly 'app.dock.tabs.item': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly ownerProps: readonly ['open', 'mobile', 'subagentOnly', 'activeKind', 'tabCount', 'availableTools', 'tab:{kind,active}', 'activate()', 'close()'];
        readonly description: 'Contribute a native dock tab with {id,label,order?,priority?}; Component is its content. Id is namespaced by the owning Mod. Native activation, close, keyboard and drag remain. Tabs are transient and withdrawn on stop; closing does not unregister the contribution. dock.open(id) reopens it.';
    };
    readonly 'app.dock.content': {
        readonly kind: 'chain';
        readonly scope: 'global';
        readonly ownerProps: readonly ['open', 'mobile', 'subagentOnly', 'activeKind', 'tabCount', 'availableTools', 'openTool?(kind)', 'collapse?()'];
        readonly description: 'Select or wrap the active native dock content by activeKind. Pure select returns a match or null; unmatched/broken selectors preserve native content. The native subtree stays mounted while covered.';
    };
    readonly 'app.dock.viewer': {
        readonly kind: 'chain';
        readonly scope: 'global';
        readonly ownerProps: readonly ['file:{name,ext,surface,read(as,{signal?})}', 'viewMode'];
        readonly description: 'Select a file preview by name/ext/viewMode. file.read(text|base64) reads only this open file, bounded to 8 MiB and revoked on close. No absolute path, download URL or credentials. Unmatched/broken viewers fall back to native preview.';
    };
    readonly 'app.dock.viewer.actions': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly ownerProps: readonly ['file:{name,ext,surface,read(as,{signal?})}', 'viewMode'];
        readonly description: 'Add compact actions above the current file preview. Uses the same revocable file handle as app.dock.viewer; native source/download controls remain.';
    };
    readonly 'app.sidebar.agents.toolbar.before': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly parent: 'app.sidebar.agents';
        readonly ownerProps: readonly ['searching', 'loading', 'homeEnabled', 'mobile', 'focusSearch()', 'clearSearch()', 'refresh()', 'newAgent?()'];
        readonly description: 'Add content at the native agent directory toolbar.before. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.';
    };
    readonly 'app.sidebar.agents.toolbar.actions': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly parent: 'app.sidebar.agents';
        readonly ownerProps: readonly ['searching', 'loading', 'homeEnabled', 'mobile', 'focusSearch()', 'clearSearch()', 'refresh()', 'newAgent?()'];
        readonly description: 'Add content at the native agent directory toolbar.actions. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.';
    };
    readonly 'app.sidebar.agents.search.before': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly parent: 'app.sidebar.agents';
        readonly ownerProps: readonly ['searching', 'loading', 'homeEnabled', 'mobile', 'focusSearch()', 'clearSearch()', 'refresh()', 'newAgent?()'];
        readonly description: 'Add content at the native agent directory search.before. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.';
    };
    readonly 'app.sidebar.agents.search.after': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly parent: 'app.sidebar.agents';
        readonly ownerProps: readonly ['searching', 'loading', 'homeEnabled', 'mobile', 'focusSearch()', 'clearSearch()', 'refresh()', 'newAgent?()'];
        readonly description: 'Add content at the native agent directory search.after. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.';
    };
    readonly 'app.sidebar.agents.list.before': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly parent: 'app.sidebar.agents';
        readonly ownerProps: readonly ['searching', 'loading', 'homeEnabled', 'mobile', 'focusSearch()', 'clearSearch()', 'refresh()', 'newAgent?()'];
        readonly description: 'Add content at the native agent directory list.before. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.';
    };
    readonly 'app.sidebar.agents.list.after': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly parent: 'app.sidebar.agents';
        readonly ownerProps: readonly ['searching', 'loading', 'homeEnabled', 'mobile', 'focusSearch()', 'clearSearch()', 'refresh()', 'newAgent?()'];
        readonly description: 'Add content at the native agent directory list.after. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.';
    };
    readonly 'app.sidebar.agents.group.label': {
        readonly kind: 'keyed';
        readonly scope: 'global';
        readonly parent: 'app.sidebar.agents';
        readonly ownerProps: readonly ['group:{id,label}', 'rename?()'];
        readonly description: 'Replace a directory section label by section id; fallback keeps the native label and rename/delete controls.';
    };
    readonly 'app.sidebar.agents.group.actions': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly parent: 'app.sidebar.agents';
        readonly ownerProps: readonly ['group:{id,label}', 'rename?()'];
        readonly description: 'Add actions beside a native directory section heading.';
    };
    readonly 'app.sidebar.agents.item.badges': {
        readonly kind: 'keyed';
        readonly scope: 'global';
        readonly parent: 'app.sidebar.agents';
        readonly ownerProps: readonly ['item:{id,active,state}', 'activate()'];
        readonly description: 'Add compact directory agent badges by opaque agent id; native selection, status, drag and hidden-row recovery remain. No title, preview or path is supplied.';
    };
    readonly 'app.sidebar.agents.footer': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly parent: 'app.sidebar.agents';
        readonly ownerProps: readonly ['searching', 'loading', 'homeEnabled', 'mobile', 'focusSearch()', 'clearSearch()', 'refresh()', 'newAgent?()'];
        readonly description: 'Add content at the native agent directory footer. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.';
    };
    readonly 'app.dock.toolbar.before': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly ownerProps: readonly ['open', 'mobile', 'subagentOnly', 'activeKind', 'tabCount', 'availableTools', 'openTool?(kind)', 'collapse?()'];
        readonly description: 'Add content at the native workspace dock toolbar.before. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.';
    };
    readonly 'app.dock.toolbar.actions': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly ownerProps: readonly ['open', 'mobile', 'subagentOnly', 'activeKind', 'tabCount', 'availableTools', 'openTool?(kind)', 'collapse?()'];
        readonly description: 'Add content at the native workspace dock toolbar.actions. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.';
    };
    readonly 'app.dock.tabs.before': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly ownerProps: readonly ['open', 'mobile', 'subagentOnly', 'activeKind', 'tabCount', 'availableTools', 'openTool?(kind)', 'collapse?()'];
        readonly description: 'Add content at the native workspace dock tabs.before. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.';
    };
    readonly 'app.dock.tabs.after': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly ownerProps: readonly ['open', 'mobile', 'subagentOnly', 'activeKind', 'tabCount', 'availableTools', 'openTool?(kind)', 'collapse?()'];
        readonly description: 'Add content at the native workspace dock tabs.after. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.';
    };
    readonly 'app.dock.tab.icon': {
        readonly kind: 'keyed';
        readonly scope: 'global';
        readonly ownerProps: readonly ['open', 'mobile', 'subagentOnly', 'activeKind', 'tabCount', 'availableTools', 'openTool?(kind)', 'collapse?()', 'tab:{kind,active}', 'activate()', 'close()'];
        readonly description: 'Replace a dock tab icon by kind. Render noninteractive decoration inside the native tab button; fallback is its native icon.';
    };
    readonly 'app.dock.tab.badges': {
        readonly kind: 'keyed';
        readonly scope: 'global';
        readonly ownerProps: readonly ['open', 'mobile', 'subagentOnly', 'activeKind', 'tabCount', 'availableTools', 'openTool?(kind)', 'collapse?()', 'tab:{kind,active}', 'activate()', 'close()'];
        readonly description: 'Add noninteractive dock tab decoration by kind inside the native tab button. Native close, keyboard and drag controls remain.';
    };
    readonly 'app.dock.content.before': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly ownerProps: readonly ['open', 'mobile', 'subagentOnly', 'activeKind', 'tabCount', 'availableTools', 'openTool?(kind)', 'collapse?()'];
        readonly description: 'Add content at the native workspace dock content.before. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.';
    };
    readonly 'app.dock.content.after': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly ownerProps: readonly ['open', 'mobile', 'subagentOnly', 'activeKind', 'tabCount', 'availableTools', 'openTool?(kind)', 'collapse?()'];
        readonly description: 'Add content at the native workspace dock content.after. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.';
    };
    readonly 'app.dock.empty': {
        readonly kind: 'single';
        readonly scope: 'global';
        readonly ownerProps: readonly ['open', 'mobile', 'subagentOnly', 'activeKind', 'tabCount', 'availableTools', 'openTool?(kind)', 'collapse?()'];
        readonly description: 'Replace only dock empty-state explanatory text; native launch and recovery controls remain.';
    };
    readonly 'app.dock.footer': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly ownerProps: readonly ['open', 'mobile', 'subagentOnly', 'activeKind', 'tabCount', 'availableTools', 'openTool?(kind)', 'collapse?()'];
        readonly description: 'Add content at the native workspace dock footer. Owner actions use native handlers; private paths, titles, prompts and credentials are omitted.';
    };
    readonly 'app.sidebar.agents.section.before': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly parent: 'app.sidebar.agents';
        readonly ownerProps: readonly ['group:{id,label}', 'rename?()'];
        readonly description: 'Add content before each native agent directory section while preserving its header and rows.';
    };
    readonly 'app.sidebar.agents.section.after': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly parent: 'app.sidebar.agents';
        readonly ownerProps: readonly ['group:{id,label}', 'rename?()'];
        readonly description: 'Add content after each native agent directory section while preserving its header and rows.';
    };
    readonly 'app.sidebar.agents.item.before': {
        readonly kind: 'keyed';
        readonly scope: 'global';
        readonly parent: 'app.sidebar.agents';
        readonly ownerProps: readonly ['item:{id,active,state}', 'activate()'];
        readonly description: 'Add content before a native agent directory row by opaque agent id; native selection, status, drag and hidden-row recovery remain.';
    };
    readonly 'app.sidebar.agents.item.actions': {
        readonly kind: 'keyed';
        readonly scope: 'global';
        readonly parent: 'app.sidebar.agents';
        readonly ownerProps: readonly ['item:{id,active,state}', 'activate()'];
        readonly description: 'Add actions beside a native agent directory row by opaque agent id; native selection and recovery remain.';
    };
    readonly 'app.sidebar.agents.item.after': {
        readonly kind: 'keyed';
        readonly scope: 'global';
        readonly parent: 'app.sidebar.agents';
        readonly ownerProps: readonly ['item:{id,active,state}', 'activate()'];
        readonly description: 'Add content after a native agent directory row by opaque agent id; native selection, status, drag and hidden-row recovery remain.';
    };
    readonly 'app.sidebar.agents.empty': {
        readonly kind: 'single';
        readonly scope: 'global';
        readonly parent: 'app.sidebar.agents';
        readonly ownerProps: readonly ['searching', 'loading', 'homeEnabled', 'mobile', 'focusSearch()', 'clearSearch()', 'refresh()', 'newAgent?()'];
        readonly description: 'Replace only the empty agent directory message; native refresh and create controls remain.';
    };
    readonly 'app.sidebar.agents.hidden.before': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly parent: 'app.sidebar.agents';
        readonly ownerProps: readonly ['searching', 'loading', 'homeEnabled', 'mobile', 'focusSearch()', 'clearSearch()', 'refresh()', 'newAgent?()'];
        readonly description: 'Add content before the native hidden or filtered agent recovery area.';
    };
    readonly 'app.sidebar.agents.hidden.after': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly parent: 'app.sidebar.agents';
        readonly ownerProps: readonly ['searching', 'loading', 'homeEnabled', 'mobile', 'focusSearch()', 'clearSearch()', 'refresh()', 'newAgent?()'];
        readonly description: 'Add content after the native hidden or filtered agent recovery area.';
    };
    readonly 'app.dock.before': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly ownerProps: readonly ['open', 'mobile', 'subagentOnly', 'activeKind', 'tabCount', 'availableTools', 'openTool?(kind)', 'collapse?()'];
        readonly description: 'Add content immediately before the native workspace dock while preserving its layout and handlers.';
    };
    readonly 'app.dock.after': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly ownerProps: readonly ['open', 'mobile', 'subagentOnly', 'activeKind', 'tabCount', 'availableTools', 'openTool?(kind)', 'collapse?()'];
        readonly description: 'Add content immediately after the native workspace dock while preserving its layout and handlers.';
    };
    readonly 'app.dock.resize': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly ownerProps: readonly ['open', 'mobile', 'subagentOnly', 'activeKind', 'tabCount', 'availableTools', 'openTool?(kind)', 'collapse?()'];
        readonly description: 'Add content beside the native workspace dock resize handle; native pointer and keyboard resizing remain.';
    };
    readonly 'app.dock.title': {
        readonly kind: 'single';
        readonly scope: 'global';
        readonly ownerProps: readonly ['open', 'mobile', 'subagentOnly', 'activeKind', 'tabCount', 'availableTools', 'openTool?(kind)', 'collapse?()'];
        readonly description: 'Replace only the workspace dock title treatment; native tabs and controls remain.';
    };
    readonly 'app.dock.tab.actions': {
        readonly kind: 'keyed';
        readonly scope: 'global';
        readonly ownerProps: readonly ['open', 'mobile', 'subagentOnly', 'activeKind', 'tabCount', 'availableTools', 'openTool?(kind)', 'collapse?()', 'tab:{kind,active}', 'activate()', 'close()'];
        readonly description: 'Add actions beside a native workspace dock tab by tab kind; native activation, close, keyboard and drag controls remain.';
    };
    readonly 'app.dock.plus.before': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly ownerProps: readonly ['open', 'mobile', 'subagentOnly', 'activeKind', 'tabCount', 'availableTools', 'openTool?(kind)', 'collapse?()'];
        readonly description: 'Add content immediately before the native workspace dock plus or launcher control.';
    };
    readonly 'app.dock.plus.after': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly ownerProps: readonly ['open', 'mobile', 'subagentOnly', 'activeKind', 'tabCount', 'availableTools', 'openTool?(kind)', 'collapse?()'];
        readonly description: 'Add content immediately after the native workspace dock plus or launcher control.';
    };
    readonly 'app.dock.launcher.before': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly ownerProps: readonly ['open', 'mobile', 'subagentOnly', 'activeKind', 'tabCount', 'availableTools', 'openTool?(kind)', 'collapse?()'];
        readonly description: 'Add content before the native workspace dock launcher menu while preserving its trigger and focus behavior.';
    };
    readonly 'app.dock.launcher.after': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly ownerProps: readonly ['open', 'mobile', 'subagentOnly', 'activeKind', 'tabCount', 'availableTools', 'openTool?(kind)', 'collapse?()'];
        readonly description: 'Add content after the native workspace dock launcher menu while preserving its trigger and focus behavior.';
    };
    readonly 'app.dock.launcher.item': {
        readonly kind: 'keyed';
        readonly scope: 'global';
        readonly ownerProps: readonly ['open', 'mobile', 'subagentOnly', 'activeKind', 'tabCount', 'availableTools', 'openTool?(kind)', 'collapse?()', 'tool:{kind}', 'open()'];
        readonly description: 'Add content beside a native workspace dock launcher item by stable tool kind; native availability, focus and open behavior remain.';
    };
    readonly 'app.dock.context.before': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly ownerProps: readonly ['open', 'mobile', 'subagentOnly', 'activeKind', 'tabCount', 'availableTools', 'openTool?(kind)', 'collapse?()'];
        readonly description: 'Add content before the native workspace dock context menu while preserving native close actions.';
    };
    readonly 'app.dock.context.after': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly ownerProps: readonly ['open', 'mobile', 'subagentOnly', 'activeKind', 'tabCount', 'availableTools', 'openTool?(kind)', 'collapse?()'];
        readonly description: 'Add content after the native workspace dock context menu while preserving native close actions.';
    };
    readonly 'app.content': {
        readonly kind: 'single';
        readonly scope: 'global';
        readonly description: 'Replace the main workspace layout. fallback is the original workspace, including Chat and its dock.';
    };
    readonly 'app.navigation': {
        readonly kind: 'single';
        readonly scope: 'global';
        readonly description: 'Replace the navigation and agent directory. fallback preserves the native navigation.';
    };
    readonly 'app.toolbar': {
        readonly kind: 'list';
        readonly scope: 'session';
        readonly description: 'Add controls to the existing status toolbar; do not cover native controls.';
    };
    readonly 'session.header.actions': {
        readonly kind: 'list';
        readonly scope: 'session';
        readonly ownerProps: readonly ['mainChatActive', 'jobId', 'switching', 'openHistory?()'];
        readonly description: 'Add compact actions beside native conversation header controls. sessionId is the selected main or embedded conversation, not necessarily the page connection. openHistory uses the existing owner handler; it is unavailable while switching. Native new-chat, history, export and dock controls stay reachable.';
    };
    readonly 'session.header.utilities': {
        readonly kind: 'list';
        readonly scope: 'session';
        readonly ownerProps: readonly ['mainChatActive', 'jobId', 'switching', 'openHistory?()'];
        readonly description: 'Add compact indicators beside native conversation header actions, scoped to the selected conversation. Absent in non-conversation views or before a session exists.';
    };
    readonly 'app.overlay': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly description: 'Add an unframed browser overlay. Own its placement; no OS desktop window.';
    };
    readonly 'app.sidebar.rail': {
        readonly kind: 'single';
        readonly scope: 'global';
        readonly description: 'Replace only the dashboard navigation rail, preserving the agent directory.';
    };
    readonly 'app.sidebar.agents': {
        readonly kind: 'single';
        readonly scope: 'global';
        readonly description: 'Replace only the agent directory, preserving the navigation rail.';
    };
    readonly 'app.sidebar.header': {
        readonly kind: 'single';
        readonly scope: 'global';
        readonly parent: 'app.sidebar.rail';
        readonly ownerProps: readonly ['mainView', 'expanded', 'mobile', 'navigate(view)', 'openAgents()'];
        readonly description: 'Replace the rail header band. Native brand mark/name/actions outlets remain only if fallback is preserved.';
    };
    readonly 'app.sidebar.header.actions': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly parent: 'app.sidebar.header';
        readonly ownerProps: readonly ['mainView', 'expanded', 'mobile', 'navigate(view)', 'openAgents()'];
        readonly description: 'Add compact controls beside the native brand button. Render an accessible icon at compact rail width.';
    };
    readonly 'app.sidebar.before': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly parent: 'app.sidebar.rail';
        readonly ownerProps: readonly ['mainView', 'expanded', 'mobile', 'navigate(view)', 'openAgents()'];
        readonly description: 'Add rail content before native navigation entries; keep compact/expanded presentation responsive.';
    };
    readonly 'app.sidebar.item': {
        readonly kind: 'keyed';
        readonly scope: 'global';
        readonly parent: 'app.sidebar.rail';
        readonly ownerProps: readonly ['mainView', 'expanded', 'mobile', 'navigate(view)', 'openAgents()', 'item:{id,label,active}', 'activate()'];
        readonly description: 'Replace one native navigation entry by exact key: agents/editor/tasks/canvas/plugins/mods/remote-control. Use activate() for its native action, fallback to preserve its button. Conditional entries only mount when available.';
    };
    readonly 'app.sidebar.after': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly parent: 'app.sidebar.rail';
        readonly ownerProps: readonly ['mainView', 'expanded', 'mobile', 'navigate(view)', 'openAgents()'];
        readonly description: 'Add native-owner navigation controls after the existing entries; each contribution is placed in a host row, so keep the returned element interactive content rather than another sized layout shell. navigate() uses App routing and closes the mobile drawer.';
    };
    readonly 'app.sidebar.footer': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly parent: 'app.sidebar.rail';
        readonly ownerProps: readonly ['mainView', 'expanded', 'mobile', 'navigate(view)', 'openAgents()'];
        readonly description: 'Add compact controls to one footer band above the account/settings trigger; the host wraps each contribution in a stable row and constrains rail width, so return the control itself and keep native account and recovery controls reachable.';
    };
    readonly 'app.sidebar.account': {
        readonly kind: 'single';
        readonly scope: 'global';
        readonly parent: 'app.sidebar.rail';
        readonly ownerProps: readonly ['mainView', 'expanded', 'mobile', 'navigate(view)', 'openAgents()'];
        readonly description: 'Replace the account/settings presentation; fallback contains the native account menu, not credentials. Preserve a route to settings and recovery.';
    };
    readonly 'app.brand.mark': {
        readonly kind: 'single';
        readonly scope: 'global';
        readonly ownerProps: readonly ['surface:sidebar', 'size', 'expanded', 'defaultSource'];
        readonly description: 'Replace the brand image inside native sidebar buttons. Return image/icon content only, not another button; native click and accessible label remain. Multiple occurrences receive their own size/surface.';
    };
    readonly 'app.brand.name': {
        readonly kind: 'single';
        readonly scope: 'global';
        readonly parent: 'app.sidebar.header';
        readonly ownerProps: readonly ['surface:sidebar', 'expanded', 'defaultName'];
        readonly description: 'Replace visible sidebar wordmark content. Native header retains its button and compact mode hides the name.';
    };
    readonly 'app.brand.artwork': {
        readonly kind: 'single';
        readonly scope: 'global';
        readonly ownerProps: readonly ['surface:welcome', 'compact', 'defaultSource', 'defaultName'];
        readonly description: 'Replace only welcome artwork, keeping the native caption, path and composer. Current skin welcome:hidden still controls visibility.';
    };
    readonly 'app.page': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly ownerProps: readonly ['page:{id,label,standalone}', 'openPage(id)', 'navigate(view)'];
        readonly description: 'Add a whole Mod-owned page with a stable id, label, optional icon (short glyph or data:image URL) and order. Each page gets a native entry at the very top of the sidebar rail and the route #/app/<id>; #/app/<id>?standalone renders it without the shell (desktop windows and floating panels). Chat stays resident.';
    };
    readonly 'app.view': {
        readonly kind: 'keyed';
        readonly scope: 'global';
        readonly description: 'Replace a selected auxiliary page by entryKey equal to its mainView (settings, mods, tasks, etc). Chat stays resident.';
    };
    readonly 'chat.workspace': {
        readonly kind: 'chain';
        readonly scope: 'session';
        readonly description: 'Select a presentation of the real Chat workspace using register({select}); use slots.wrap and next() for explicit wrapping that preserves native Chat, approval and composer behavior.';
    };
    readonly 'chat.before': {
        readonly kind: 'list';
        readonly scope: 'session';
        readonly description: 'Add content before the chat workspace.';
    };
    readonly 'chat.after': {
        readonly kind: 'list';
        readonly scope: 'session';
        readonly description: 'Add content after the chat workspace.';
    };
    readonly 'chat.view': {
        readonly kind: 'list';
        readonly scope: 'session';
        readonly description: 'Add a selectable conversation tab with stable id (not chat), optional dynamic label and order. The selected view renders with native Chat retained and the native composer, queue and approvals unchanged.';
    };
    readonly 'chat.welcome': {
        readonly kind: 'single';
        readonly scope: 'session';
        readonly description: 'Replace the welcome content; fallback is the native welcome.';
    };
    readonly 'chat.composer.before': {
        readonly kind: 'list';
        readonly scope: 'session';
        readonly description: 'Add controls above the existing input. Native approvals and sending stay intact.';
    };
    readonly 'chat.composer.after': {
        readonly kind: 'list';
        readonly scope: 'session';
        readonly description: 'Add controls below the existing input.';
    };
    readonly 'chat.composer': {
        readonly kind: 'chain';
        readonly scope: 'session';
        readonly description: 'Take over composer presentation with a pure select(owner) returning a match or null. The native textarea stays mounted but hidden; use standard useInput and inputActions, not next() or a duplicated send loop.';
    };
    readonly 'chat.input.dock': {
        readonly kind: 'list';
        readonly scope: 'session';
        readonly description: 'A full-width band above the native input card. Receives input snapshot and controlled inputActions.';
    };
    readonly 'chat.input.overlay': {
        readonly kind: 'list';
        readonly scope: 'session';
        readonly description: 'Native input-card overlay anchor; own positioning and do not obscure approvals.';
    };
    readonly 'chat.input.left': {
        readonly kind: 'list';
        readonly scope: 'session';
        readonly description: 'Left side of the native composer tools row. Receives input and inputActions.';
    };
    readonly 'chat.input.right': {
        readonly kind: 'list';
        readonly scope: 'session';
        readonly description: 'Right side of the native composer tools row, before send. Receives input and inputActions.';
    };
    readonly 'chat.input.after': {
        readonly kind: 'list';
        readonly scope: 'session';
        readonly description: 'Band below the native input card.';
    };
    readonly 'command.item': {
        readonly kind: 'keyed';
        readonly scope: 'session';
        readonly ownerProps: readonly ['command:{name,type,description}', 'key'];
        readonly description: 'Add an annotation or action inside one native slash-command menu item, keyed by the exact command name. It cannot replace the native command button or its execution.';
    };
    readonly 'model.item': {
        readonly kind: 'keyed';
        readonly scope: 'session';
        readonly ownerProps: readonly ['model:{id,name,meta,current}', 'key'];
        readonly description: 'Add an annotation or action inside one native model selector item, keyed by the exact model id. It cannot replace native model selection or thinking-level controls.';
    };
    readonly 'mode.item': {
        readonly kind: 'keyed';
        readonly scope: 'session';
        readonly ownerProps: readonly ['mode:{id,name,description,current}', 'key'];
        readonly description: 'Add an annotation or action inside one native mode/permission-selector item, keyed by the exact mode id. It cannot replace native mode selection.';
    };
    readonly 'preset.item': {
        readonly kind: 'keyed';
        readonly scope: 'global';
        readonly ownerProps: readonly ['preset:{id,name,description,default,custom,scope}', 'key'];
        readonly description: 'Add an annotation or action inside one native main-agent preset row, keyed by the exact preset id. It cannot replace default selection, file management, deletion or Create-mode actions.';
    };
    readonly 'chat.message': {
        readonly kind: 'single';
        readonly scope: 'session';
        readonly description: 'Replace assistant message body presentation. Receives message:{id,content,streaming}; fallback is the original body.';
    };
    readonly 'chat.message.actions': {
        readonly kind: 'list';
        readonly scope: 'session';
        readonly description: 'Actions on a finalized assistant message; message id/content are provided. No actions while streaming.';
    };
    readonly 'chat.turn.tail': {
        readonly kind: 'chain';
        readonly scope: 'session';
        readonly description: 'Route supplemental finalized assistant group content before the native footer.';
    };
    readonly 'chat.tool': {
        readonly kind: 'keyed';
        readonly scope: 'session';
        readonly description: 'Tool-call presentation keyed by the exact tool name. Receives toolCall data; fallback preserves native call and existing Mods render folds.';
    };
    readonly 'chat.tool.result': {
        readonly kind: 'keyed';
        readonly scope: 'session';
        readonly description: 'Expanded tool result keyed by exact tool name. Receives toolCall; fallback preserves native output and render folds.';
    };
    readonly 'tool.detail': {
        readonly kind: 'keyed';
        readonly scope: 'session';
        readonly ownerProps: readonly ['toolCall:{id,name,kind,status}', 'key'];
        readonly description: 'Append an annotation or action to the expanded native tool-call detail, keyed by the exact tool-call id. It cannot replace the native result, copy actions or tool approval state.';
    };
    readonly 'task.detail': {
        readonly kind: 'keyed';
        readonly scope: 'session';
        readonly ownerProps: readonly ['task:{id,toolCallId?,running?,seen?,exitStatus?,endReason?,kind?:scheduled,cron?,humanSchedule?,enabled?,recurring?,durable?,createdAt?,lastFiredAt?}', 'execution?:{id,taskId,status,sessionId?,runId?,startedAt?,completedAt?,durationMs?,inputTokens?,outputTokens?,totalTokens?}', 'surface:dock|inline', 'key'];
        readonly description: 'Append an annotation or action to native background-terminal or scheduled-task details, keyed by native task id. Scheduled cards and execution details project current task/execution metadata; dock and expanded mobile occurrences retain native controls. No output, command, cwd, prompt or error body is projected, and no second task store is created.';
    };
    readonly 'subagent.detail': {
        readonly kind: 'keyed';
        readonly scope: 'session';
        readonly ownerProps: readonly ['subagent:{toolCallId,name,type?,status,background}', 'surface:dock|inline', 'key'];
        readonly description: 'Append an annotation or action to native subagent dock or expanded inline details, keyed by the parent tool-call id. It receives native identity/status, without prompts, results or transcripts. Native history, copy actions and navigation remain reachable.';
    };
    readonly 'settings.before': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly description: 'Add settings content before the native header.';
    };
    readonly 'settings.row': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly ownerProps: readonly ['settingKey', 'type', 'scope', 'value', 'inherited'];
        readonly description: 'Add an action or annotation inside each native settings row. It receives the exact setting key/type/current effective value and cannot replace the native control.';
    };
    readonly 'settings.action': {
        readonly kind: 'keyed';
        readonly scope: 'global';
        readonly ownerProps: readonly ['settingKey', 'type', 'scope', 'value', 'inherited', 'key'];
        readonly description: 'Add a compact annotation or action in the native settings control band, keyed by the exact setting key. Projects the current effective value and user/project scope; native reset and editor controls remain. Does not expose a second settings writer.';
    };
    readonly 'settings.after': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly description: 'Add settings content after native sections.';
    };
    readonly 'plugins.page': {
        readonly kind: 'list';
        readonly scope: 'global';
        readonly ownerProps: readonly ['activeTab', 'loading', 'installedCount', 'enabledCount', 'marketplaceCount'];
        readonly description: 'Add content above native plugin management results. Receives native tab/loading/count metadata, without plugin paths, configuration or credentials. Native install, approval, enable, disable and recovery controls remain.';
    };
};
export type ModClientSlotName = keyof typeof MOD_CLIENT_SLOTS;
/** Presentation-only CSS targets; business state and actions remain native-owned. */
export declare const MOD_CLIENT_STYLE_SURFACES: {
    readonly app: {
        readonly selector: '[data-mod-surface="app"]';
        readonly description: 'Whole Web UI shell; data-mod-page is the current page id.';
    };
    readonly navigation: {
        readonly selector: '[data-mod-surface="navigation"]';
        readonly description: 'Native left navigation and agents region.';
    };
    readonly sidebarRail: {
        readonly selector: '[data-mod-surface="sidebar-rail"]';
        readonly description: 'Navigation rail, brand and account.';
    };
    readonly sidebarAgents: {
        readonly selector: '[data-mod-surface="sidebar-agents"]';
        readonly description: 'Agent directory and user sidebar panels.';
    };
    readonly brand: {
        readonly selector: '[data-mod-surface="brand"]';
        readonly description: 'Sidebar brand header; content replacement uses app.brand slots.';
    };
    readonly content: {
        readonly selector: '[data-mod-surface="content"]';
        readonly description: 'Main content column. Keep recovery and approvals reachable.';
    };
    readonly chat: {
        readonly selector: '[data-mod-surface="chat-workspace"]';
        readonly description: 'Actual Chat region; data-mod-chat-state is empty or active.';
    };
    readonly composer: {
        readonly selector: '[data-mod-surface="composer"]';
        readonly description: 'Native input card. Use inputActions rather than DOM input writes.';
    };
    readonly assistantMessage: {
        readonly selector: '[data-mod-surface="assistant-message"]';
        readonly description: 'Message body; data-mod-streaming is true or false. Do not rewrite stored content.';
    };
    readonly userMessage: {
        readonly selector: '[data-mod-surface="user-message"]';
        readonly description: 'A sent user message bubble in the Chat timeline. Presentation only; do not rewrite stored content.';
    };
    readonly toolSummary: {
        readonly selector: '[data-mod-surface="tool-summary"]';
        readonly description: 'Collapsed or expanded tool-group summary row in the Chat timeline.';
    };
    readonly settings: {
        readonly selector: '[data-mod-surface="settings"]';
        readonly description: 'Native settings presentation, including dock form.';
    };
};
/** Plain JavaScript function body returning {inject,apply(ctx)}; installation approves the complete source hash. */
export interface ModClientPackage {
    id: string;
    hash: string;
    generation: number;
    runtimeId?: string;
    /** Published package version/source labels for diagnostics; neither is an approval grant. */
    version?: string;
    source?: string;
    code: string;
    /** Package-relative modules compiled into this approved client, entry first. */
    modules?: string[];
    /** Approved manifest activation hints. Omitted means startup; [] means explicit use only. */
    activationEvents?: import('./mod-activation').ModActivationEvent[];
    /** Installed package dependencies by exact browser package id, not injected service names. */
    dependencies?: string[];
    /** Approved entry descriptions, available before client code is loaded. */
    contributes?: import('./mod-client-contributions').ModClientContributions;
}
export interface ModClientQuery {
    requestId: string;
    sessionId: string;
    provider: string;
    method: string;
    input?: Record<string, unknown>;
}
export interface ModClientQueryReply {
    requestId: string;
    data?: unknown;
    error?: string;
}
export interface ModClientInspectMethod {
    name: string;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
}
export interface ModClientInspectProvider {
    id: string;
    description: string;
    methods: ModClientInspectMethod[];
    owner?: string;
}
/** Directory entry a page publishes; `incarnation` is unique per registration, so re-registering the same name and schema still retracts in-flight reads. */
export interface ModClientInspectPublication extends ModClientInspectProvider {
    incarnation: string;
}
export declare const MOD_CLIENT_SERVICES: {
    readonly commands: readonly ['register({id,label:{zh,en}},({signal})=>void|Promise<void>): disposer; up to 32 local commands, namespaced by Mod identity; native command palette uses the same handlers', 'list(): this Mod\'s live command metadata; execute(id,{signal?}): Promise<void> runs only this exact approved version\'s handler', 'client.contributes.commands advertises unloaded commands; execution activates the exact package first. Stop/update cancels pending handlers cooperatively; failures are not replayed. No shortcuts or backend slash commands are overwritten.'];
    readonly assets: readonly ['read("assets/relative-file",{signal?}): Promise<Blob>; only this approved installed package, up to 8 MiB, no host path or credentials', 'url(path,{signal?}): Promise<string>; creates an owned Blob URL (64 URLs / 32 MiB); release(url) releases it early; stop aborts reads and releases every URL', 'Images, fonts, audio/video, WASM, JSON/text/CSV/TSV only; HTML/SVG/scripts are rejected. Authored bodies must first export/install a standard package for binary assets.'];
    readonly dock: readonly ['open(id): activate or reopen this Mod\'s app.dock.tabs.item contribution; returns namespaced kind', 'close(id): close this Mod\'s contributed tab without unregistering it', 'handleLinks(id, open(url)): plain clicks on http(s) chat links open this Mod\'s tab and call open(url) instead of the native preview; newest live claim wins; returns disposer', 'Ids must be registered by this Mod; native tabs and other Mod tabs cannot be changed. Stop removes the owned contributions and tabs.'];
    readonly runtime: readonly ['getSnapshot/useRuntime(selector)/subscribe: native current sessionId, agentId, jobId, attachment/readOnly, binding/connection, running, approval, phase/progress/stopReason and bounded job state', 'onSession(scope=>cleanup?): owns current-agent effects; switch aborts scope.signal and cleans its timers/subscriptions without stopping global Mod or deleting data; setup synchronous', 'forSession(sessionId): current session-bound read/check/effect/subscribe; retained actions cannot operate a replacement agent'];
    readonly slots: readonly ['register({name,id?,key?,order?,priority?,label?:string|()=>string,select?,children?:{slotName:{kind:"single"|"list"|"keyed"|"chain",scope?,description?}},store?,inject?}, Component): disposer; strict chain requires pure select, first non-null wins', 'wrap({name,id?,priority?,children?,store?,inject?}, Component): explicit next(props?) chain wrapper; no select, not supported for chat.composer', 'single/list/keyed render one winner per cell (slot/id/key), lower priority wins, same-priority conflict throws; same-plugin version updates stage and roll back safely', 'snapshot(root?): live slot ledger including shadowed occupants and active flags', 'list(name): winning {id,key?,owner,order,priority,label?} records; dynamic labels resolve per read', 'subscribe(listener): owned slot topology changes', 'inject(name,setup): disposer; waits for a declared child slot, runs synchronous setup, disposes it when declaration ends', 'defineStore({init,actions,persist?:key,persistence?:{version:1..1000000,validate(unknown):boolean,migrate?(previous,{fromVersion,toVersion}):state}}): versioned persistence retains at most 8 snapshots and 1 MiB per identity. Legacy raw JSON stays untouched; fromVersion 0 denotes legacy. Pure synchronous migration/validation prepares state; first successful action commits before publication. Reopen a saved version to restore its own snapshot, never reverse-migrate or silently clear corrupt data. Stale same-version edits fail; this is not a cross-tab atomic transaction or host modStorage migration', 'Component props: owner props, sessionId?,fallback?,message?,useChat(selector),chat,renderSlot(name,props,{entryKey?,only?,fallback?}),renderSlotChain; matched for register selectors, next(props?) only for wrap', 'defineStore({init:()=>state,actions:{name:(draft,...args)=>void},persist?:key}): shared handle; synchronous Immer draft actions and plugin/session-isolated browser persistence', 'store: handle | ()=>handle | (sessionId?)=>{getSnapshot,subscribe,actions,dispose?}; one handle per data scope, one instance per session; framework supplies useStore(selector) and actions', 'inject(sessionId?,actions?): plain data/callbacks and hooks:{name:{getSnapshot,subscribe}}; framework supplies useName(selector)'];
    readonly chat: readonly ['getSnapshot(): {sessionId,running,messages:[{id,role,content,streaming}]}', 'subscribe(listener): disposer', 'fill(text): fill the current input', 'submit(text): send through the ordinary Chat queue', 'useChat(selector): React selector hook'];
    readonly input: readonly ['getSnapshot(): native {sessionId,text,selection,attachments:[metadata],running,canSend,preparing,readOnly}', 'useInput(selector): selected native snapshot', 'subscribe(listener): disposer', 'actions.setText/insertText/setSelection/addFiles(File[])/removeAttachment/clear/focus/blur/submit/cancel: use native composer; no separate send loop'];
    readonly layout: readonly ['getSnapshot(): {sidebarOpen,agentsOpen,workspaceOpen,workspaceWidth}', 'subscribe(listener): owned native layout changes', 'setSidebarOpen(boolean)', 'setAgentsOpen(boolean)', 'setWorkspaceOpen(boolean): open/close the native details/workspace dock without deleting tabs', 'setWorkspaceWidth(320..8192): requested width in pixels; native viewport constraints still apply'];
    readonly locale: readonly ['getSnapshot(): {mode:"zh"|"en"|"system",resolved:"zh"|"en"}', 'setLocale(mode): uses native language settings', 'subscribe(listener): owned language changes', 'register(namespace,{zh:{key:text},en:{key:text}}): owned dictionary, matching keys, removed on stop', 't(namespace,key,params?): translate with native current language', 'useT(namespace): React translation function; updates with native language and dictionary versions'];
    readonly sessions: readonly ['create({prompt,cwd?,agent?,model?,effort?,permissionMode?,bgIsolation?}): independent CBC job', 'list({cwd?,all?,states?,search?,offset?,limit?}): bounded page', 'history({cwd?,agentId?,includeAttached?,offset?,limit?}): bounded page', 'detail(jobId)', 'reply(jobId,text)', 'stop(jobId)', 'resume({jobId}|{sessionId,cwd?})', 'transcript({jobId,sessionId?}|{sessionId},{offset?,limit?}): selected transcript page', 'open(sessionId,cwd?): use native App session binding; does not take another writer', 'createForeground(): native new Chat', 'forkPoints({sessionId,limit?:1..100,beforeMessageId?}): newest completed durable message points with canonical id/role/preview, exclusive nextBeforeMessageId cursor; current bound idle Chat only', 'fork({sessionId,atMessageId:string|null,open?:boolean}): create a durable native branch at the selected message or latest with null; source unchanged, open:false by default, explicit App navigation when true; no reconnect/retry of uncertain writes', 'subscribe(listener): owned job invalidations, not automatic transcript or catalog injection'];
    readonly goal: readonly ['getSnapshot(): {sessionId,active,latest}', 'get(): read the current bound Chat GoalService snapshot', 'set(condition)/clear()/pause()/resume(): native GoalService operations; actions are bound to the current Chat and fenced on session change', 'subscribe(listener): native goal/status changes; no polling or client-owned goal state'];
    readonly usage: readonly ['getSnapshot(): {sessionId,used,size,cost?,usageByCategory?,updatedAt} | null', 'subscribe(listener): native ACP usage updates for the bound page; read-only'];
    readonly workspace: readonly ['getSnapshot(): {cwd,agentCwd,explicit,initialized,directories}', 'select(cwd)/open(cwd): use the native folder/workspace selection and persistence glue', 'create(cwd): create and select a real directory through the native filesystem service', 'rename(source,destination): move and retarget through the native filesystem service', 'list(): persisted additional workspace directories; no second workspace registry', 'subscribe(listener): native workspace/folder/environment changes'];
    readonly agents: readonly ['getSnapshot(): read-only native Agent Home tree with agents, groups, channels, sections and job assignments', 'subscribe(listener): native directory changes; no second agent registry or mutation writer'];
    readonly settings: readonly ['getRuntimeDefaults(cwd?): Promise<{cwd:string,model:string|null,permissionMode:string|null}>; reads effective native project/user defaults only', 'setPermissionMode(mode): Promise<void>; writes only the validated user default permission mode through the native settings endpoint', 'setProject(path,value): Promise<void>; writes one host-allowlisted native project setting for the selected workspace; path is validated by the native Settings API allow-list', 'Secrets and arbitrary settings writes are unavailable; every operation is current-page fenced.'];
    readonly skills: readonly ['getSnapshot(): {sessionId:string|null,skills:Array<{name:string,description:string,source:string}>}', 'list(): native ACP skill directory entries, bounded to 512 items', 'get(name): read one native skill entry or null', 'subscribe(listener): native command/skill directory changes; read-only and page scoped'];
    readonly subagents: readonly ['list({parentToolCallId?,offset?,limit?}): bounded summaries from current native Chat, including nested attached tool calls; id is the actual toolCallId, not an invented sessionId', 'detail(toolCallId,{offset?,limit?}): selected native timeline positions with bounded message/tool metadata; no private inputs, outputs or attachment contents', 'open(toolCallId): opens the existing desktop WorkspaceDock subagent tab; background/member/mobile details are explicitly unavailable', 'subscribe(listener): owned native Chat/binding invalidation only, no automatic transcript injection'];
    readonly inspect: readonly ['register({manifest:{id,description,methods:[{name,inputSchema,outputSchema}]},query(method,input,{signal})}): disposer', 'list(): live provider manifests; handlers are read-only and return bounded JSON'];
    readonly theme: readonly ['getSnapshot(): {mode,resolved,skinId,skin}; native mode and effective skin, no credentials', 'setMode("light"|"dark"|"system"): native theme preference', 'subscribe(listener): owned native and plugin-theme changes', 'register(id,UiSkin): owned whole skin contribution (light/dark colors plus optional tokens:{light,dark} CSS custom properties); appears in Appearance, plugin-local id, exact version teardown', 'list(): live plugin skin summaries', 'select(id|null): choose this plugin skin or return to current saved skin; does not rewrite saved definitions', 'overrideTokens({light,dark,tokens?:{light,dark}}): owned layer; legacy colors plus bounded --custom-property tokens (same names in both modes; --skin-font/--skin-radius/--font-mono and native shadow/spacing variables allowed; no url()/declarations); native skin renderer applies it; user skin choices supersede contributions; stop restores current user choices'];
    readonly timer: readonly ['every(ms,callback,{signal?}?): disposer', 'after(ms,callback,{signal?}?): disposer', 'delay(ms,signal?): Promise<void>; rejects AbortError on abort/stop', 'debounce/throttle(ms,callback,{leading?,trailing?,signal?}?): callable with cancel/flush/pending/dispose; all callbacks/resources revoked on stop; delay 50..86400000ms'];
};
/**
 * Desktop shell bridge, aligned with DSH's `globalThis.dshDesktop` carrier: a native shell preload exposes
 * `globalThis.codebuddyDesktop = {protocolVersion:1, platform, capabilities, invoke(method, params) → {ok,value|error}}`
 * (CodeBuddy Desktop `apps/codebuddy-desktop` preload).
 * Plain CBC Web UI has no carrier, so the `desktop` service is simply absent there.
 */
export declare const MOD_CLIENT_DESKTOP_CARRIER = "codebuddyDesktop";
export declare const MOD_CLIENT_DESKTOP_PROTOCOL_VERSION = 1;
export declare const MOD_CLIENT_DESKTOP_CAPABILITIES: readonly ['shell.openExternal', 'shell.openPath', 'shell.revealPath', 'clipboard.writeText', 'notifications.show', 'terminal.open', 'device.info', 'window.open', 'window.close', 'floating.show', 'floating.hide', 'floating.toggle', 'shortcuts.register', 'shortcuts.unregister', 'webview.attach', 'webview.update', 'webview.navigate', 'webview.find', 'webview.detach', 'agentBrowser.acquire', 'agentBrowser.release', 'agentBrowser.call'];
/** Pushed by the native shell to the page that owns the resource (`carrier.subscribe`); agent browser events reach lease holders only. */
export type ModClientDesktopEvent = {
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
export type ModClientDesktopWebviewEvent = {
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
/** Events a Mod can observe through `desktop.on` (web view events go to their handle, agent browser events to its lease). */
export declare const MOD_CLIENT_DESKTOP_EVENTS: readonly ['window.closed', 'floating.visibility'];
/** Global shortcuts need a modifier (or a function key) so a page cannot capture plain typing system-wide. */
export declare const MOD_CLIENT_DESKTOP_ACCELERATOR: RegExp;
export declare function isModClientDesktopAccelerator(value: unknown): value is string;
export type ModClientDesktopCapability = typeof MOD_CLIENT_DESKTOP_CAPABILITIES[number];
/** Structural error codes (DSH RemoteError style `<namespace>/<kind>`); identify failures with `error.isCbcDesktopError`. */
export declare const MOD_CLIENT_DESKTOP_ERROR_CODES: readonly ['desktop/unavailable', 'desktop/unsupported', 'desktop/bad-request', 'desktop/denied', 'desktop/cancelled', 'desktop/internal'];
export type ModClientDesktopErrorCode = typeof MOD_CLIENT_DESKTOP_ERROR_CODES[number];
export type ModClientDesktopResult = {
    ok: true;
    value: unknown;
} | {
    ok: false;
    error: {
        code: ModClientDesktopErrorCode | string;
        message: string;
    };
};
export interface ModClientDesktopCarrier {
    readonly protocolVersion: number;
    readonly platform?: string;
    readonly capabilities?: readonly string[];
    /**
     * Native shell owner: it authorizes the final OS object and obtains user approval for terminal launches.
     * Resolves with the DSH RemoteResult envelope so error codes survive the context bridge.
     */
    invoke(method: ModClientDesktopCapability, params: Record<string, unknown>): Promise<ModClientDesktopResult>;
    /** Optional event channel (shortcuts, window lifecycle); absent carriers simply never deliver events. */
    subscribe?(listener: (event: ModClientDesktopEvent) => void): () => void;
}
/** Host-environment services that exist only where their native owner exists; names stay reserved everywhere. */
export declare const MOD_CLIENT_OPTIONAL_SERVICES: {
    readonly desktop: readonly ["Present only inside a desktop shell exposing globalThis.codebuddyDesktop (protocolVersion 1); plain Web UI has none. Use ctx.get(\"desktop\") for optional features, inject:[\"desktop\"] only when the Mod cannot work without it", string, "shell.openExternal(url: http/https/mailto): Promise<void>; shell.openPath(absolutePath)/shell.revealPath(absolutePath): Promise<void>", "clipboard.writeText(text <= 1 MiB): Promise<void>; notifications.show({title,body?,tag?}): Promise<void>", "terminal.open({cwd:absolutePath,title?,command?:string[] argv}): Promise<void>; the shell asks the user before running command", "deviceInfo(): Promise<string> without hostname, user name or serial number", "windows.open(page,{title?,width?,height?,view?}?): Promise<void> opens/focuses a native window showing this origin's #/app/<page>?standalone[&view]; windows.close(page,view?)", "floating.show/hide/toggle(page,{width?,height?,hideOnBlur?,view?,placement?:\"top-right\"|\"center\"}?): Promise<{visible}> one always-on-top, all-workspaces panel per app.page and view; center re-centers on the cursor display each show", "shortcuts.register(accelerator,callback): Promise<disposer> global OS shortcut (needs a modifier or F-key; at most 16 per page); unregistered on dispose, Mod stop or page reload", "on(event: window.closed|floating.visibility, callback): disposer for shell-owned window lifecycle", "webviews.attach(slot: HTMLElement, {url,cookies?,keys?,visible?}): Promise<handle> docks a native http(s) web view over the slot element and follows its position; the Mod renders every surrounding UI (toolbar, loading/error states). The view stays hidden until its document is ready. handle: navigate(url,{cookies?}?)/back()/forward()/reload()/stop()/find(text,{forward?,findNext?}?)/setVisible(bool)/sync()/on(state|failed|open|key|found,callback)/dispose(); no open listener navigates in place; keys (Escape, F-keys, modified accelerators) are claimed from the page; persistent session; cookies only for the loaded site or its parent domains; at most 8 per page", "agentBrowser (shell primitives, protocol 1): acquire({label?}) → lease {lease,plugin,platform,methods,partition,endpoint{socketPath,token},node{command,env},natives[{name,version,root,entry}]} plus call(method,params), on(event,cb), release(); released with the Mod scope", "views.create({owner,url?,viewport?}) background view (works hidden); views.list({owner?})/info/navigate({viewId,url http(s)})/history({viewId,action back|forward|reload|stop})/close/wait({viewId,timeoutMs?})/resize({viewId,width,height})", "views.cdp({viewId,method,params}) page-local CDP allowlist (DOM/Accessibility/Runtime/Page/Input…, no Target/Browser/Storage/navigation); views.capture({viewId,format png|jpeg,quality?}); views.reveal({viewId}) emits agentBrowser.reveal", "page only: views.attach({viewId,rect CSS px}) native, user-interactive view over the area (its viewport follows the area) / views.detach; views.devtools({viewId,x?,y?}) opens DevTools (inspecting x,y); views.screencast({viewId,action start|stop,quality?,maxWidth?,maxHeight?}) frames as agentBrowser.frame; webview.reserve({owner,url?}) → {viewId,partition,src} for <webview partition src>", "cookies.set({cookies:[{url,name,value,...}]})/cookies.get({url})/storage.clear() on the plugin partition; logins.replace({entries:[{origin,username,password}]})/list/clear; logins.fill({viewId,loginId?}) asks the user natively, never returns passwords", "dialog.confirm({message,detail?,buttons[1-6],defaultId?,cancelId?,kind?}) → {response}; tokens.issue({owner}) → {token} limited to that owner's views for agent processes", "events: agentBrowser.views {owner} | agentBrowser.reveal {owner,viewId} | agentBrowser.open {viewId,url,created?} | agentBrowser.frame {viewId,data,mimeType,width,height} | agentBrowser.released", string];
};
export declare const MOD_CLIENT_BUILTINS: {
    readonly React: 'React runtime including createElement and hooks; no JSX or TypeScript transformation';
    readonly host: 'host.call(noun,method,args?:JSON[]): Promise<JSON>; only this approved Mod\'s custom CBC engine.create methods';
    readonly styles: 'styles.insert(css): disposer; trusted package-owned CSS, removed on stop/update';
    readonly timers: 'setTimeout/setInterval/requestAnimationFrame with clearTimeout/clearInterval/cancelAnimationFrame: ordinary function callbacks, owned by this Mod version and cleared on stop/update/page change; at most 1024 pending, intervals have a 4 ms floor, string callbacks are rejected. Use ctx.timer for abortable delay, debounce and throttle';
    readonly console: 'Package-tagged logging; errors are reported to the authoring session';
    readonly ctx: 'ctx.provide(name,value,{description?,signatures?,apiVersion?:1..1000000}): disposer; provides:[names] reserves outputs for cycle checks. inject:[names] waits for actual services; serviceVersions:{injectedName:integer} requires an exact interface revision, suspends incompatible consumers and reapplies after compatible providers return. Omitted requirements keep legacy name-only matching; a required version rejects unversioned providers. Runtime.snapshot lists expected/actual/owner mismatches; Service.listService lists apiVersion. ctx.get(name): optional lookup; ctx.registerEvent(name,{signature,description}) and ctx.emit(name,...JSON) extend events; ctx.on owns subscriptions; ctx.registerInspect or ctx.inspect.register publishes a read-only provider. ctx.effect owns cleanup; apply must be synchronous';
};
export declare const MOD_CLIENT_EVENTS: {
    readonly 'file.open': {
        readonly signature: '(file: ModFileHandle) => unknown';
        readonly description: 'A native file preview was mounted. Metadata and an 8 MiB bounded read(text|base64,{signal?}) handle only; no paths or credentials. Handle is revoked when that preview closes or its source binding changes. No automatic content reads.';
    };
    readonly 'chat.change': {
        readonly signature: '(snapshot: ClientChatSnapshot) => unknown';
        readonly description: 'Current Chat messages or execution state changed. Read only; subscribing does not submit prompts.';
    };
    readonly 'agent.change': {
        readonly signature: '(snapshot: ModAgentSnapshot) => unknown';
        readonly description: 'Native current-agent binding, connection, phase, approval, job and completion state changed.';
    };
    readonly 'theme.change': {
        readonly signature: '(theme: "light" | "dark") => unknown';
        readonly description: 'Resolved theme changed.';
    };
    readonly 'slots.change': {
        readonly signature: '() => unknown';
        readonly description: 'Browser slot declarations or occupants changed.';
    };
    readonly 'goal.change': {
        readonly signature: '(snapshot: {sessionId:string|null,active:unknown,latest:unknown}) => unknown';
        readonly description: 'The native current-session GoalService projection changed.';
    };
    readonly 'usage.change': {
        readonly signature: '(usage: unknown) => unknown';
        readonly description: 'The native ACP context usage projection changed.';
    };
    readonly 'workspace.change': {
        readonly signature: '(snapshot: {cwd:string|null,agentCwd:string|null,explicit:boolean,initialized:boolean,directories:string[]}) => unknown';
        readonly description: 'The native workspace/folder selection changed.';
    };
    readonly 'agents.change': {
        readonly signature: '(snapshot: {agents:unknown[],groups:unknown[],channels:unknown[],sections:unknown[]}) => unknown';
        readonly description: 'The native Agent Home directory tree changed.';
    };
    readonly 'connection.change': {
        readonly signature: '(connection: {status:string,sessionId:string|null,switching:boolean}) => unknown';
        readonly description: 'The current browser page connection or Chat binding changed.';
    };
    readonly 'jobs.change': {
        readonly signature: '(change: {type:string,jobId?:string,sessionId?:string}) => unknown';
        readonly description: 'A bounded native job invalidation was published for the current page owner.';
    };
    readonly 'skills.change': {
        readonly signature: '(snapshot: {sessionId:string|null,skills:Array<{name:string,description:string,source:string}>}) => unknown';
        readonly description: 'The native ACP skill directory changed; entries are bounded metadata only.';
    };
    readonly 'session.change': {
        readonly signature: '(change: {type:"bound"|"unbound"|"switch",sessionId:string|null,previousSessionId:string|null,status:string}) => unknown';
        readonly description: 'The native page Chat binding changed; no transcript is included.';
    };
    readonly 'model.change': {
        readonly signature: '(change: {type:"start"|"delta"|"complete"|"error",sessionId:string|null,phase:string|null,outputChars:number,stopReason:string|null,errorCategory:string|null,modelId:string|null,modelName:string|null,effort:string|null}) => unknown';
        readonly description: 'Bound native model execution lifecycle, selected model identity and bounded output activity.';
    };
    readonly 'tool.change': {
        readonly signature: '(change: {type:"start"|"result",sessionId:string|null,id:string,toolName:string,name:string,kind:string,status:"running"|"completed"|"failed"}) => unknown';
        readonly description: 'Bound native tool start/result metadata without private input or output contents.';
    };
    readonly 'approval.change': {
        readonly signature: '(change: {pending:boolean,count:number,sessionId:string|null}) => unknown';
        readonly description: 'Native approval/question pending state for the bound Chat.';
    };
    readonly 'workflow.change': {
        readonly signature: '(event: {type:"progress"|"snapshot"|"removed",sessionId:string,runId:string,run:{loadState:"loading"|"ready"|"missing"|"error",status:"running"|"completed"|"failed"|"aborted"|null,paused:boolean|null,phaseCount:number|null,agentCount:number|null,cachedAgentCount:number|null,agentInFlightCount:number|null,pendingAction:"abort"|"pause"|"resume"|"skipAgent"|null},signal:{kind:"workflow_run_started"|"workflow_run_finished"|"workflow_phase_started"|"workflow_phase_finished"|"workflow_agent_started"|"workflow_agent_finished"|"workflow_agent_cached",at:number|null,status:"running"|"completed"|"failed"|"aborted"|null,phase:string|null,agentKey:string|null}|null}) => unknown';
        readonly description: 'Bound native workflow progress and bounded run snapshots for the current Chat; no prompts, logs, errors or agent detail arrays.';
    };
};
//# sourceMappingURL=mod-client.d.ts.map