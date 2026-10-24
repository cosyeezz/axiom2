import { resolve } from "node:path";
import type { Store } from "./storage.js";
import type { CapabilityItem, CapabilitySelection } from "../shared/capabilities.js";

export type ResourceReferenceChange = {
  kind: "skills" | "mcp";
  name: string;
  source: string;
  preferenceKeys: string[];
  next?: { name: string; source: string; preferenceKey: string };
};

/** Change persisted selections by resource identity, leaving same-name resources in other scopes alone.
 * Call inside the file operation's transaction. Historical messages and run snapshots stay intact. */
export function changeResourceReferences(store: Store, changes: ResourceReferenceChange[]) {
  const preferences = store.db.prepare("SELECT body FROM capability_preferences WHERE id=1").get();
  if (preferences) {
    const body = JSON.parse(String(preferences.body));
    for (const change of changes) {
      const values = body[change.kind] ??= {};
      const key = change.preferenceKeys.find(key => Object.hasOwn(values, key));
      const value = key === undefined ? undefined : values[key];
      for (const key of change.preferenceKeys) delete values[key];
      if (change.next && value !== undefined) values[change.next.preferenceKey] = value;
    }
    store.db.prepare("UPDATE capability_preferences SET revision=revision+1,body=? WHERE id=1").run(JSON.stringify(body));
  }
  for (const row of store.db.prepare("SELECT sessionId,selection,catalog FROM session_capabilities").all()) {
    if (!row.catalog) continue;
    const catalog = JSON.parse(String(row.catalog)) as { skills: CapabilityItem[]; mcp: CapabilityItem[] };
    const selection = row.selection ? JSON.parse(String(row.selection)) as CapabilitySelection : null;
    let changed = false;
    for (const change of changes) {
      const matches = (item: CapabilityItem) => item.name === change.name && resolve(item.source) === resolve(change.source);
      const prior = catalog[change.kind].filter(matches);
      if (!prior.length) continue;
      changed = true;
      const ids = new Set(prior.flatMap(item => [item.id, item.name]));
      if (selection?.[change.kind]) selection[change.kind] = [...new Set(selection[change.kind]!.flatMap(id =>
        ids.has(id) ? change.next ? [change.next.name] : [] : [id]))];
      catalog[change.kind] = catalog[change.kind].flatMap(item => !matches(item) ? [item] : change.next
        ? [{ ...item, id: change.next.name, name: change.next.name, source: change.next.source, preferenceKey: change.next.preferenceKey }] : []);
    }
    if (changed) store.db.prepare("UPDATE session_capabilities SET selection=?,catalog=?,revision=revision+1 WHERE sessionId=?")
      .run(selection ? JSON.stringify(selection) : null, JSON.stringify(catalog), row.sessionId);
  }
}
