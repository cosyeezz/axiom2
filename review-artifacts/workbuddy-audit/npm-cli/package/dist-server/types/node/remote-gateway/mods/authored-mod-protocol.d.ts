import type { Mods } from '../../../vendor/cbc-plugins/node/index.js';
import type { ModAppearance, ModRunDiagnostic } from '../../../vendor/cbc-shared/common/index.js';
import type { JsonObject } from '../../../vendor/cbc-worker/node/protocol/index.js';
import type { ComponentCategory } from './component-protocol';
export interface AuthoredModDefinition {
    client?: string;
    components?: Record<string, {
        id: string;
        version: number;
    }>;
    category?: ComponentCategory;
    tags?: string[];
    /** Schemas describe the complete KV object in each scope, not a visual instance. */
    storage?: {
        global?: JsonObject;
        session?: JsonObject;
    };
    appearance?: ModAppearance;
    name: string;
    description: string;
    entry: string;
    files: Record<string, string>;
    options: Mods.PluginOptions;
    usage: string;
}
export interface AuthoredMod {
    id: string;
    revision: number;
    definition: AuthoredModDefinition;
    hash: string;
    updatedAt: number;
    installedHash?: string;
    pluginId?: string;
    /** Uninstalled entries keep their source/data but leave the active library. */
    archived?: boolean;
    /** Last fully successful explicit activation, retained across stop and failed updates. */
    currentPackageId?: string;
    nextPackageId?: string;
    run?: AuthoredModRun;
}
export interface AuthoredModRun {
    id: string;
    packageId: string;
    sessionId: string;
    connectionId?: string;
    pageLease?: string;
    generation?: number;
    runtimeId?: string;
    status: 'starting' | 'awaiting-client' | 'running' | 'failed' | 'stopped';
    at: number;
    error?: string;
    diagnostic?: ModRunDiagnostic;
}
export interface AuthoredModDiagnostic {
    phase: 'compile' | 'runtime';
    message: string;
    file?: string;
    line?: number;
    column?: number;
}
export declare const AUTHORED_MOD_INSTRUCTIONS = "Create a complete resident CodeBuddy Mod implementing the user's requested functionality, not merely a visual widget.\nSave {name,description,entry,files,options,usage} through Mods. files contains complete TS/JS/TSX source, using relative plugin-local imports only.\nOptional appearance:{light:{semanticColorToken:hex},dark:{semanticColorToken:hex},font:'system'|'mono',radius:0..24} customizes the Mod's own view only.\nHost render-tree nodes accept props.style with safe JSON CSS layout, sizing, spacing, colors, border and typography. Host files do not execute browser scripts. An optional client field separately contains an approved plain-JavaScript browser extension; read the contract's browser section before using it.\nCustom nouns added via engine.create can be invoked from the API by their noun and method names with JSON arguments. Use them to expose reusable business actions beyond tools/commands.\nExport register(on,options). Hooks receive ($,e,next). Use next(e) to observe or rewrite; return the event's result to implement functionality.\nThe plugin is loaded once and remains active between model turns. Closure variables survive events; $.store persists JSON between sessions and reloads.\nThe resident plugin runtime is host-generation scoped, not a separate closure per session. Use $.store.get/set/delete/keys with {scope:'session'} for session-local data; default or {scope:'global'} is durable plugin-shared data. Session data survives Mod reload/enable/disable until the actual Session runtime closes or the process restarts. Reload revokes old APIs and callbacks, not pending session records. Read shared values per operation, not only on startup.\nSet category and tags using the component library vocabulary. Define storage:{global:JSONSchema,session:JSONSchema} for the scopes used. Each schema describes the complete KV object; $.store.set('data',...) means properties.data. Reads and writes are validated; allow an empty initial store and initialise missing keys lazily in a business function. Do not reset existing data or remove validation to hide incompatible state.\nRegister tools and commands in on('session.start',async($,e,next)=>{...;return next(e)}).\n$.tool.register({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}}) registers a tool.\nImplement on('tool.call',{tool:name},...) returning {result:{content:JSON.stringify(data)}}.\nTool input is e.input in CLI and fields of e in Server: const input=e.input??e. Use globally unique tool names with only letters, digits and underscores, e.g. my_app_action. The SDK converts hyphens to underscores for model calls; keep the registered tool, tool.call matcher, usage and submitted prompts on the same underscore name. Plugin ids and command names may still use hyphens.\n$.command.register({name,description,argumentHint?}) registers a local command; on('command.run',{command:name},...) returns {text:string} without an LLM turn.\nCommands must use a unique prefix derived from the requested id; do not replace a builtin.\nUse $.fs.read/write/list/exists/stat, $.process.run(argv,{cwd?,timeoutMs?}), $.http.fetch(url,{method?,headers?,body?}), and $.http.register({routeId,method,path,noun,capability,requestSchema?,corsOrigins?}) for an authenticated CBC Gateway route. The route is fixed under /api/v1/mods/http/<plugin>/<routeId>, is session-owned, and invokes only this plugin's existing custom noun method; it is revoked on stop/update/uninstall. requestSchema is bounded JSON schema and browser callers must send X-CodeBuddy-Session-Id. $.store.get/set/delete/keys,\n$.clock.now/after/every/sleep, $.session.id/cwd/model/messages, $.model.complete({prompt,system?,model?}), $.mcp.call(server,tool,args), $.ui.ask, and $.prompt.fill/submit/suggest where needed. prompt.read is not bound in this host; do not rely on it.\nThese are host APIs, not Node or browser globals. External capabilities require the user to trust installation; preview must not perform external side effects.\nLong-lived timers start in session.start, using $.clock.every(ms,fn); never await an endless loop in a hook. Capture the returned timer and cancel it in session.end.\nFor custom capability composition, on('engine.create',async($,e,next)=>({...await next(e),myNoun:{...}})); do not replace host nouns. Targeted updates privately prepare candidate engine folds before retiring the live version; host operations are denied during preparation. Build noun functions there, but initialize storage, tools, timers and external effects in session.start after activation, not inside engine.create.\nObserve/guard engine events via tool.call/tool.check/prompt.submit/prompt.context/turn.start/turn.complete/classic.*. Do not claim support for unimplemented events.\nUI is optional. When useful, on('ui.render',{component:'Pane'},async($,e)=>{const {Box,Text,Button,Input,Select,Markdown,Code,Link,Svg}=await $.ui.resolve(e);return {tree:...}}).\nResident UI can reuse published visual components. Declare components:{Row:{id:'published-child',version:1}} and use Component({key:stableItemId,component:'Row',props:{...}}) from $.ui.resolve(e). Children retain independent actions, timers and scope-aware data, including nested dependencies; the parent retains business capability ownership. Publish dependency definitions first using Component. Stable parent keys and occurrence keys preserve state through reorder/restyle. Visual children never gain host execution privileges.\nInput({multiline:true,rows:5,...}) renders a multiline editor; onInput still receives committed strings.\nUI uses data {type,props,children}, not React DOM. Use Text({text}), callbacks onPress/onInput/onSelect and stable keys. Call $.ui.invalidate('ui.render') after state changes.\nFunctions stay in the server. Tools, commands and UI must use the same business state/functions, not independent mock states.\nName and usage describe the actual feature and public commands/tools. options is a record of string/number/boolean/string-array defaults.\nHost files must not import Node modules or third-party packages, access process/global/require/fetch directly, or emit browser scripts. Use the optional client field only for browser extensions. Do not fake operations.\nUse valid JSON in tool arguments. Save and validate through tools, then complete authorised installation and verify the requested behavior. Handle operational failures explicitly and tell the user where the application is available; printing source in chat is not installation.";
