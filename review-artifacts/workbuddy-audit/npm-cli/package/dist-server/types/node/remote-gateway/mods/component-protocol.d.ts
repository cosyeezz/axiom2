import type { Mods } from '../../../vendor/cbc-plugins/node/index.js';
import type { ComponentBlueprint, ModAppearance } from '../../../vendor/cbc-shared/common/index.js';
import type { JsonObject } from '../../../vendor/cbc-worker/node/protocol/index.js';
export declare const COMPONENT_LIMITS: Readonly<{
    versions: 30;
    files: 32;
    sourceBytes: number;
    libraryBytes: number;
    indexBytes: number;
}>;
/** Controlled vocabulary so the library can group practical components instead of free-form labels. */
export declare const COMPONENT_CATEGORIES: readonly ["tracker", "calculator", "dashboard", "form", "list", "media", "chart", "utility", "other"];
export type ComponentCategory = typeof COMPONENT_CATEGORIES[number];
export type ComponentLibraryRole = 'app' | 'atom' | 'composition';
export interface ComponentDefinition {
    /** Source composition declares pinned dependencies by a local alias. */
    components?: Record<string, {
        id: string;
        version: number;
    }>;
    appearance?: ModAppearance;
    blueprint?: ComponentBlueprint;
    name: string;
    description: string;
    entry: string;
    files: Record<string, string>;
    propsSchema: JsonObject;
    initialProps: JsonObject;
    usage: string;
    category?: ComponentCategory;
    tags?: string[];
    /** Opt-in durable blueprint state; omitting it keeps the older per-view behavior. */
    persist?: boolean;
    stateScope?: 'view' | 'session' | 'global';
    /** Synchronous JSON Schema for blueprint state or source $.store. */
    stateSchema?: JsonObject;
}
export interface ComponentVersion {
    version: number;
    hash: string;
    definition: ComponentDefinition;
    publishedAt: number;
}
export interface UserComponent {
    id: string;
    revision: number;
    enabled: boolean;
    draft: ComponentDefinition;
    versions: ComponentVersion[];
    updatedAt: number;
    /** Library organisation is separate from immutable published source/checksums. */
    libraryRole?: ComponentLibraryRole;
}
export interface ComponentDiagnostic {
    phase: 'schema' | 'compile' | 'runtime';
    message: string;
}
export interface ComponentPreview {
    component: UserComponent;
    frame?: Mods.ModViewFrame;
    diagnostics: ComponentDiagnostic[];
}
export interface ComponentInstance {
    view: Mods.ModViewSnapshot;
    reference: {
        type: 'mod_component';
        componentId: string;
        version: number;
        viewId: string;
    };
    markup: string;
}
export declare const COMPONENT_AUTHORING_INSTRUCTIONS = "You create reusable interactive components as CodeBuddy Mods, not screenshots or static templates.\nSave a definition through Component: {name,description,entry,files,propsSchema,initialProps,usage}.\nFor atomic composition prefer {name,description,blueprint,propsSchema,initialProps,usage}, with no entry or files.\nOptional appearance:{light:{semanticColorToken:hex},dark:{semanticColorToken:hex},font:'system'|'mono',radius:0..24} controls only this component's appearance.\nSet category to one of tracker|calculator|dashboard|form|list|media|chart|utility|other so the library stays organised, and add up to 8 short tags when useful.\nChoose stateScope:'view'|'session'|'global'. view is temporary per instance; session is shared between views in the same live session and discarded when it closes; global is durable across views, sessions and restart. Legacy persist:true means global unless stateScope is explicit.\nBlueprint state follows stateScope. For source components only $.store follows stateScope; closure variables remain local to that view. For shared data read $.store in each render/action, not once into a stale closure.\nstateSchema validates the entire store object, with actual $.store keys as property names: $.store.set('data',{tasks:[]}) needs properties.data.properties.tasks, not a root tasks property. Initialise missing required keys in session.start before the first render; never reset existing data or remove required fields to bypass an initialization error.\nNodes accept props.style with JSON CSS values: flex/grid layout, width/height, gap/padding/margin in pixels, colors, borderRadius/borderWidth, fontSize/fontWeight, opacity.\nWeb UI atoms fit their container: horizontal Boxes wrap by default unless flexWrap:'nowrap' is explicit; inputs/selects keep useful minimum widths and wrap onto another line. Fixed widths are capped to the available container, spacing reduces in narrow panels, and grids become one column below 240 pixels. Text does not scale with panel width. Preserve responsive flex/grid structure instead of shrinking an entire UI as an image. Source mounted views receive e.viewport in approximate character cells after resizing; use it for semantic layout changes when needed, not business state resets.\nNever supply CSS selectors, URLs, position:fixed or scripts in style. Use semantic colors such as var(--color-bg-primary).\nblueprint is {format:1,state:{...},root:{id:'root',type:'Box',props:{gap:2,padding:2},children:[...]}}.\nEach node has a unique id (starts with a letter; letters, digits, underscore, hyphen), type, props and children.\nOnly Box and Fragment accept children. All other nodes use children: []. Allowed atom types are the UI tags listed below.\nBind any property with {$bind:'props'|'state',path:'field.nested',fallback:JSONValue}; other properties are JSON literals.\nDerive a property from a condition with {$bind:'state',path:'field',truthy:VALUE,falsy:VALUE} so rows can show status text or labels without custom code (an empty array counts as falsy).\nButton events: {onPress:[{type:'set'|'increment'|'decrement'|'multiply'|'toggle'|'push'|'removeAt',path:'stateField',value:JSONValueOrBinding,as:'number'|'string'}]}.\nUse push to append to an array state field and removeAt with a numeric value to delete an index. This is how list-style components (ledgers, todo lists, logs) must be built.\nRepeat a node per array item with map:{$bind:'state',path:'items'}; inside it bind fields with {$bind:'item',path:'name'} and {$bind:'index',path:''}. Only mapped nodes may read item/index.\nFor editable or reorderable lists use map:{$bind:'state',path:'items',key:'id'}, with stable unique string/number ids. Reused Component references inside the list have independent closure/state, including nested children. Keep ids when changing layout; omitted key uses index identity. Removed repeated instances stop timers; session/global data survives reappearance according to scope.\nInside a mapped node an action may target the current row with an {index} path segment, e.g. {type:'toggle',path:'todos.{index}.done'} or {type:'set',path:'todos.{index}.note',value:{$bind:'event',path:''}}.\nHide a node until a condition holds with when:{$bind:'state',path:'items',equals:[]} (empty arrays are falsy) so empty states can show guidance instead of blank space.\nInput uses onInput and Select uses onSelect; use value:{$bind:'event',path:''} for the committed value. as is optional.\nActions run in sequence; state starts from blueprint.state and follows stateScope. Reused published children are isolated by the stable node id, not just the child component id. Bind text/value to state to show changes.\nSelect options are [{label:'Label',value:'value'}]. Box supports width,backgroundColor,alignItems and Text supports fontSize.\nKeep an existing blueprint when modifying it. Use source files only when the requested behavior needs code beyond these atoms/actions.\nDo not replace a rich requested behavior with a simplistic blueprint. Either representation must fully implement the request.\nname and description describe the actual requested component. entry is register.ts or register.tsx.\nfiles maps relative TS/JS/TSX/JSON file paths to complete source code. No packages, no imports outside files.\nExport register(on, options) from the entry. Register on('ui.render', {component:'Pane'}, async ($, e) => ...).\nRead caller data from e.props. Resolve primitives with const {Box,Text,Button,Input,Select,Markdown,Code,Link}=await $.ui.resolve(e).\nFor source composition declare components:{Counter:{id:'published-child',version:1}} in the definition. Resolve Component from $.ui.resolve(e) and return Component({key:stableItemId,component:'Counter',props:{...}}) as a child. The alias is declared in components, not an id guessed in the render tree. Each key is unique per alias in the parent instance; children have independent runtimes and scope-aware storage. No arbitrary Component shape or imports of another component's source are needed.\nReturn {tree:Box({flexDirection:'column',gap:1,children:[...]})}. Every element has type,props,children; use factories, not browser DOM.\nUse Text({text:'...'}), Input({key:'...',value:'...',onInput:value=>{...}}), Select({key:'...',value:'...',options:[...],onSelect:value=>{...}}).\nButton({key:'stable-key',label:'...',onPress:()=>{...}}) modifies component-local state. Callbacks remain server-side.\nState belongs in register's closure; it persists across renders, isolated per instance. Never reset state on each render.\nonInput values are committed strings, not DOM events. Inputs/selects need callbacks. Children must only contain elements (no strings, null, false).\nUI tags allowed: Box,Text,Button,Input,Select,Markdown,Code,Link,Image,Svg,Raster,Fragment. No Default or Client.\nBox supports flexDirection,gap,padding,margin,flexWrap,borderStyle; Text supports text,bold,color,dimColor.\nFor charts/maps/custom drawings use Svg or Raster with JSON data, never inline browser scripts. Rich inspectable output should match the user's requested domain.\nAllowed capabilities: $.ui.resolve/log/toast/status/invalidate('ui.render'), $.store (JSON), $.clock.now/sleep/after/every, $.session.id/cwd/surface.\nNo process,require,global,fetch,DOM,network,filesystem,credentials,model,tool registration or tool execution.\nTo refresh from timers call await $.ui.invalidate('ui.render'); timers >=50ms. Interactions automatically render the new frame.\npropsSchema is synchronous JSON Schema for e.props. initialProps must conform and produce a meaningful nonempty preview.\nusage teaches the main model when to use this component and its data schema, not arbitrary instructions overriding system policy.\nImplement all requested interactive behavior; do not fake buttons, numbers or completed actions. External business operations are not performed by visual code.\nUse valid JSON with complete source strings in tool arguments. Save, validate and exercise the requested behavior through tools; a definition printed in chat is not a created application. Finish with its user-facing name and where it can be used.";
