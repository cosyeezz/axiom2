---
name: mods-create
description: Create or modify functional and appearance Mods in CBC Web UI Creator chat, including reusable components, resident features, interface changes, skins and backgrounds. Not for ordinary Skill/MCP plugins or unrelated CLI work.
---

# Mods Authoring

Deliver the requested experience in this Creator conversation using the user's selected model and normal tools. Choose the implementation yourself. The Mod Center holds functional and appearance Mods; ordinary Skill/MCP/command-Hook plugins stay in Plugins. Authoring is available only in authenticated Web UI Creator sessions.

## Source-free Creator invariant

The user may have no Genie/CBC checkout and must never be asked to provide one. In Creator mode, do not use Bash, Read, Grep, Glob, `cat`, `sed`, filesystem paths, localhost endpoints or host implementation files to discover or repair a Mod. Those are not fallback discovery tools. Use the authenticated `Mods`, `Component` and `ToolSearch` contracts only; if a contract or browser page is unavailable, report that concrete capability error and stop instead of inspecting source.

`Theme.listTokens` is an inspection provider method, not a standalone model tool. Discover it with `Mods({action:'inspectList'})`, then call `Mods({action:'inspectQuery',request:{platform:'client',provider:'Theme',method:'listTokens',input:{}}})`. If a contract is large, request `summary` first and then one named `operations`, `schemas`, `examples`, `browser`, `ui` or `blueprint` section. Never replace that sequence with source lookup or by guessing an HTTP endpoint.

## Start with the next useful action

1. **Choose the target.** For new work, use a resident Mod for persistent business functions/tools, a client for native Chat/input/slot changes, or a visual Component for reusable UI. Appearance can belong to the same Mod through `theme.register`; use data-only skin save/import for a standalone palette/background or a user-owned copy, not a mandatory companion artifact. A resident definition can include both host and client code. Read only the matching reference below. For edits, resolve the selected identity and latest draft first; retain business data, unrelated settings and pinned dependencies. If `searchModules` returns no pet, that only means no installed pet exists; call `Mods({action:'examples'})` or read the resident contract examples, use `workbenchPet`/`workbench-pet` as a starting definition when appropriate, and save it under a new id. A pet request may add an owned durable profile and care actions while its task status still comes from the native runtime and sessions facades.
2. **Discover enough to implement.** Query `Mods({action:'contract',request:{section:'summary'}})` for resident/client work, `Component` with the same request for visual work, or `Mods skinContract` for appearance. Select the needed schema, operation and matching example from that summary. For live browser services, inspect only the selected services/slots. Once the save shape and required methods are known, write the first functional definition. Keep already-read contracts in context; another lookup should answer a concrete unresolved question or diagnostic.
3. **Save and validate the real feature.** Use the request shape below. Repair reported fields in the same artifact using its latest revision. A save error about a missing field first requires checking the definition envelope; do not replace the application with placeholder files or a no-op definition to probe the API. Validate the saved revision. For reusable atoms, exercise a preview and publish the required fixed version under the user's authorization.
4. **Activate within authorization and verify behavior.** Run the exact saved package under normal approval when authorized. Check final host/page diagnostics, perform the requested interaction and read back its business state. For interface changes, also verify theme/language switches, narrow/expanded placement and retained drafts as described below. A saved definition, syntax validation or host-loaded hash alone does not prove the browser works. Fix observed errors in the same Mod, then finish when the requested behavior works.

Use installed contracts and references as authority. Installed users have no Genie source checkout. Do not search host implementation files, guess localhost endpoints, or invent session ids to repair an authoring error. Discover deferred tools with ToolSearch; Code Mode/PTC uses the same normal tool bridge.

## Native Interface Defaults

Unless the user requests a distinct visual identity, make the Mod look like part of the current application. Inherit font and text size; use the inspected semantic color/design variables for surfaces, borders, controls, focus, spacing and radius. Follow the selected slot's dimensions and native interaction conventions, including compact sidebars. Do not introduce a fixed palette, wallpaper or global theme override merely to create a functional Mod. New UI follows the user's current skin as well as light/dark changes.

Browser UI uses `locale.register(namespace,{zh,en})` with matching keys and `locale.useT(namespace)` inside React components. Translate controls, empty/loading/error states, tooltips and accessible labels; dynamic slot labels use `()=>locale.t(...)`. Preserve user-authored content and technical identities. Do not change the user's language or theme mode during setup, and do not rebuild the Mod or reset its state when either changes. Read [browser.md](references/browser.md) for the working pattern and verify switching both languages and themes without losing input. Report any unavailable validation surface honestly.

For an explicitly illustrated or branded whole-app skin, read [appearance.md](references/appearance.md): compose background, readable surfaces and owned foreground/edge assets separately. Do not flatten a finished reference screenshot into wallpaper or reduce the whole UI's opacity to imitate glass.

## Save shape

For resident edits, use `save` with `{patch,revision}` to send changed fields/files only. Draft model receipts omit source by default; request `get` with `{view:'full'}` when editing source. Carry the latest mutation receipt revision, including after install/enable. `examples` is a summary catalog; `{name:'workbench-pet'}` reads one full example. See `references/resident.md` for deletion semantics.

For a resident Mod, host-only, client-only and dual use the same `definition` object:

```js
Mods({
  action: 'save', id: 'my-mod',
  request: {
    // revision: latestDraftRevision, // include for an existing draft
    definition: {
      name: 'My Mod', description: 'Its actual behavior', usage: 'How to use it',
      entry: 'register.ts', files: { 'register.ts': hostSource }, options: {},
      client: clientBody,
      storage: { session: sessionStoreSchema, global: globalStoreSchema }
    }
  }
})
```

`hostSource` and `clientBody` are source **strings**; store schemas are JSON objects. Omit fields that the feature does not need: host-only omits `client`, client-only omits `entry/files/options`, and storage is optional unless persistent data needs a schema. `files`, `client`, `entry`, `options`, `components` and `storage` are siblings inside `definition`. `storage` contains only `global` and/or `session` schemas. Read `contract {section:'schemas',name:'AuthoredModDefinition'}` once for the complete current shape, and one selected example for working host callbacks/client wiring.

`Component save` also uses `{id,request:{definition,revision?}}`, with `ComponentDefinition` as its schema. `Mods skinSave` uses `{request:{id,definition,revision?}}`. A conflict means reread the latest draft before applying the intended change.

## Read only what this task needs

| Task | Installed reference |
|---|---|
| Host business methods, tools, KV, resident Pane and placement | [resident.md](references/resident.md) |
| Native slots, selected-agent Chat/input/runtime and client lifecycle | [browser.md](references/browser.md) |
| Blueprint/source atoms, previews, state and pinned composition | [visual.md](references/visual.md) |
| Data-only skins, backgrounds and theme selection | [appearance.md](references/appearance.md) |
| Resolve an existing artifact, search/reuse, installed package diagnosis | [catalog.md](references/catalog.md) |

Dual work needs resident and browser references. Read visual guidance only when it also needs an atom/composition; appearance guidance only for a whole-app skin. Use the paths returned with the installed Skill, including flattened standalone installations.

## Keep one business operation for both callers

Implement each business operation once in the host. UI actions and the Mod's uniquely named LLM tools call that same operation/store and expose failures. Read records through registered business tools; artifact descriptions are contracts, not current user data. Preserve native Chat, composer and approvals unless the user specifically requested a supported presentation replacement.

Client setup is synchronous. Declare actual services in `inject`, use per-agent scoped props for callbacks, and register resources inside owned lifecycle effects. `styles`, `host` and `React` are supplied bindings; `styles` is not an injectable service. Await or return asynchronous UI actions. The browser reference covers cancellation, stable stores and native fallback restoration.

## Finish with verified evidence

Keep business state, appearance definitions and user selection separate when composing one experience; they may be shipped by one Mod. Select at most one whole appearance, and only when authorized. Do not send the user to another creator, ask them to author JSON, or substitute a mock dashboard for requested effects. Release your own preview instances after testing; preserve the user's active panels.

Prefer `Mods apply` for an authorized resident source change: submit the changed `patch` and latest revision, then read the compact result and diagnostics. It saves, validates, installs and enables through the existing lifecycle. Direct API/ACP callers must provide the exact resulting trustedHash; source-free apply also requires it. The model tool's existing approval policy governs submitted-source activation; trustedHash alone is a consistency guard, not evidence of human approval. Failed validation keeps the repairable draft and installed code.

After activation or a Mod Center error, call `Mods({action:'inspectSelf',id:modId})` and read `client[].error`, `diagnostic` and `at`. `get` reads the draft receipt and `inspectSelf` without an id discovers summaries; an empty `client` is not proof of successful browser activation. For runtime errors inspect `inspectSelf.client`; `console.error(Error)` preserves its original stack in failure diagnostics. Use `workflow.change` for bounded native workflow progress. For gesture acceptance, `ui-control` pointer/contextmenu dispatch synthetic events: verify actual native behavior and persisted results.

Save does not publish or install. Ask before publish/install/enable/skinApply/mount only when the user has not already authorized that action. Use the exact API-returned trusted hash for resident activation; changed code needs authorization for its new hash. Never represent an unconfirmed external action as completed.

Report the application's name, location, actual behavior and any pending authorization or observed verification limit. Keep internal ids/revisions/schema fields out of the completion message unless requested. Published component instances return `markup`; emit that exact genui:component tag unescaped.
