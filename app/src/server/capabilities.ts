import type { Store } from "./storage.js";
import { AppError, object, type Command, type Scope } from "../shared/protocol.js";
import { capabilityPreferencesScope, capabilitiesScope, type CapabilityPreferences, type CapabilityCatalog, type CapabilityItem, type CapabilitySelection, type CapabilityState, type CapabilityReloadSelection, type SkillSelectionChange } from "../shared/capabilities.js";
import { capabilityRuntime, discoverCapabilities, type DiscoveredCapabilities } from "./capability-resources.js";

type StoredCatalog = { skills: CapabilityItem[]; mcp: CapabilityItem[] };
export type CapabilityPlan = { preferencesRevision: number; revision: number; catalog: DiscoveredCapabilities; runtime: ReturnType<typeof capabilityRuntime> };
export class Capabilities {
  constructor(readonly store: Store, readonly publish: (scope: string, data?: unknown) => void, readonly sharedPiDir?: string) {
    store.db.exec("CREATE TABLE IF NOT EXISTS capability_preferences(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,body TEXT NOT NULL)");
  }
  preferences(): CapabilityPreferences {
    const row = this.store.db.prepare("SELECT revision,body FROM capability_preferences WHERE id=1").get();
    return row ? { ...JSON.parse(String(row.body)), revision: Number(row.revision) } : { revision: 0, skills: {}, mcp: {} };
  }
  private defaults(catalog: DiscoveredCapabilities, preferences = this.preferences()) {
    for (const kind of ["skills", "mcp"] as const) for (const item of catalog[kind]) {
      const keys = [item.preferenceKey ?? item.name, ...catalog.preferenceAliases[kind][item.name] ?? []];
      const key = keys.find(key => preferences[kind][key] !== undefined);
      item.defaultSelected = key === undefined ? item.defaultSelected : preferences[kind][key];
    }
    return catalog;
  }
  private owner(scope: Scope) { this.store.session(scope.workspaceId, scope.sessionId); }
  state(scope: Scope): CapabilityState {
    this.owner(scope);
    // Initialize before any new prompt creates a JSONL. Old bound sessions keep
    // their prior Skill behavior and never acquire MCP connections by upgrading.
    this.store.db.prepare(`INSERT OR IGNORE INTO session_capabilities(sessionId,lockedAt,legacy)
      SELECT ?, CASE WHEN EXISTS(SELECT 1 FROM runs WHERE sessionId=?) OR
        EXISTS(SELECT 1 FROM agent_sessions WHERE sessionId=? AND file IS NOT NULL) OR
        EXISTS(SELECT 1 FROM tasks WHERE sessionId=?) THEN 1 ELSE NULL END,
        CASE WHEN EXISTS(SELECT 1 FROM runs WHERE sessionId=?) OR
        EXISTS(SELECT 1 FROM agent_sessions WHERE sessionId=? AND file IS NOT NULL) OR
        EXISTS(SELECT 1 FROM tasks WHERE sessionId=?) THEN 1 ELSE 0 END`)
      .run(scope.sessionId, scope.sessionId, scope.sessionId, scope.sessionId, scope.sessionId, scope.sessionId, scope.sessionId);
    const row = this.store.db.prepare("SELECT revision,lockedAt,legacy,selection FROM session_capabilities WHERE sessionId=?").get(scope.sessionId)!;
    return { revision: Number(row.revision), locked: row.lockedAt !== null, legacy: !!row.legacy,
      selection: row.selection ? JSON.parse(String(row.selection)) : null };
  }
  private async discover(scope: Scope) {
    this.owner(scope);
    try { return await discoverCapabilities(this.store.root, this.store.workspace(scope.workspaceId).path, this.sharedPiDir); }
    catch { throw new AppError("CAPABILITIES_UNAVAILABLE", "无法读取能力目录，请检查技能与 MCP 配置文件后重试。"); }
  }
  private storedCatalog(scope: Scope): StoredCatalog {
    const row = this.store.db.prepare("SELECT catalog FROM session_capabilities WHERE sessionId=?").get(scope.sessionId);
    return row?.catalog ? JSON.parse(String(row.catalog)) : { skills: [], mcp: [] };
  }
  private selected(catalog: DiscoveredCapabilities, state: CapabilityState, stored: StoredCatalog): CapabilitySelection {
    if (state.selection) {
      // Historical rows carry path IDs; recover their saved names once on read.
      // Every current choice and resource lookup is keyed by type + exact name.
      const skills = state.selection.skills?.map(name =>
        stored.skills.find(item => item.id === name)?.name ?? name) ?? null;
      return { ...state.selection, skills: skills && [...new Set(skills)] };
    }
    return state.legacy ? { skills: null, mcp: [] } : {
      skills: catalog.skills.filter(item => item.defaultSelected).map(item => item.id),
      mcp: catalog.mcp.filter(item => item.defaultSelected).map(item => item.id),
    };
  }
  private verify(catalog: DiscoveredCapabilities, selection: CapabilitySelection, stored: StoredCatalog) {
    const missing = (["skills", "mcp"] as const).flatMap(kind => (selection[kind] ?? [])
      .filter(id => !catalog[kind].some(item => item.id === id))
      .map(id => stored[kind].find(item => item.name === id || item.id === id)?.name ?? id));
    if (missing.length)
      throw new AppError("CAPABILITY_UNAVAILABLE", `选中的资源已不可用：${missing.join("、")}。请在“技能与 MCP”的“当前会话”中取消失效项或选择可用资源，点击“应用并重新加载”后重试。`);
  }
  async get(scope: Scope): Promise<CapabilityCatalog> {
    this.state(scope);
    const catalog = this.defaults(await this.discover(scope)), saved = this.state(scope), stored = this.storedCatalog(scope);
    const state = { ...saved, selection: saved.selection ? this.selected(catalog, saved, stored) : null };
    const merge = (kind: "skills" | "mcp") => [...catalog[kind], ...stored[kind].filter(item => state.selection?.[kind]?.includes(item.name) && !catalog[kind].some(current => current.name === item.name))
      .map(item => ({ ...item, id: item.name, available: false }))];
    const environment = state.legacy ? this.store.db.prepare("SELECT environment FROM agent_sessions WHERE sessionId=?").get(scope.sessionId)?.environment : null;
    const names: string[] = environment ? JSON.parse(String(environment)).skills ?? [] : [];
    const sessionSkills = state.legacy ? names.map(name => catalog.skills.find(item => item.name === name) ??
      { id: name, name, description: "最近一次加载的技能", source: "历史会话环境", defaultSelected: true, available: false }) : undefined;
    return { state, sessionSkillsEditable: !this.store.db.prepare("SELECT 1 FROM tasks WHERE sessionId=?").get(scope.sessionId), ...(sessionSkills ? { sessionSkills } : {}), preferencesRevision: this.preferences().revision, revision: catalog.revision, skills: merge("skills"), mcp: merge("mcp"), warnings: catalog.warnings, mcpPaths: catalog.mcpPaths };
  }
  async prepare(scope: Scope, reload = false, skillChange?: SkillSelectionChange, change?: CapabilityReloadSelection): Promise<CapabilityPlan> {
    const state = this.state(scope), discovered = await this.discover(scope), preferences = this.preferences();
    const catalog = this.defaults(discovered, preferences), stored = this.storedCatalog(scope);
    if (reload && !change && state.selection?.mcp.length && catalog.config.errors.length)
      throw new AppError("CAPABILITY_UNAVAILABLE", "MCP 配置无法完整读取，未应用重载；请修复配置后重试。");
    let selection = reload ? {
      skills: catalog.skills.filter(item => item.defaultSelected).map(item => item.id),
      mcp: catalog.mcp.filter(item => item.defaultSelected).map(item => item.id),
    } : this.selected(catalog, state, stored);
    if (change) {
      const revision = change.target === "defaults" ? preferences.revision : this.state(scope).revision;
      if (revision !== change.revision || state.revision !== this.state(scope).revision)
        throw new AppError("REVISION_CONFLICT", "选择已在另一窗口更新，请重置选择后重试。");
      if (catalog.revision !== change.catalogRevision)
        throw new AppError("REVISION_CONFLICT", "能力目录已改变，请重置选择后重试。");
      selection = { skills: [...change.skills].sort(), mcp: [...change.mcp].sort() };
      if (selection.mcp.length && catalog.config.errors.length)
        throw new AppError("CAPABILITY_UNAVAILABLE", "MCP 配置无法完整读取，未应用重载；请修复配置后重试。");
    }
    if (skillChange) {
      if (state.revision !== skillChange.revision || this.state(scope).revision !== skillChange.revision)
        throw new AppError("REVISION_CONFLICT", "当前会话的技能选择已改变，请刷新后重新选择。");
      if (catalog.revision !== skillChange.catalogRevision)
        throw new AppError("REVISION_CONFLICT", "能力目录已改变，请刷新后重新选择。");
      if (!catalog.skills.some(item => item.id === skillChange.id) && (skillChange.checked || !selection.skills?.includes(skillChange.id)))
        throw new AppError("CAPABILITY_UNAVAILABLE", "此技能已不可用，请刷新列表。");
      const previous = selection.skills ?? (() => {
        const environment = this.store.db.prepare("SELECT environment FROM agent_sessions WHERE sessionId=?").get(scope.sessionId)?.environment;
        const names: string[] = environment ? JSON.parse(String(environment)).skills ?? [] : [];
        return catalog.skills.filter(item => names.includes(item.name)).map(item => item.id);
      })();
      const skills = new Set(previous);
      if (skillChange.checked) skills.add(skillChange.id); else skills.delete(skillChange.id);
      selection = { skills: [...skills].sort(), mcp: selection.mcp };
    }
    this.verify(catalog, skillChange ? { ...selection, mcp: [] } : selection, stored);
    const required = new Set(catalog.skills.filter(item => selection.skills?.includes(item.id)).map(item => item.source));
    if (!skillChange && selection.mcp.length) for (const path of catalog.mcpPaths) required.add(path);
    if (catalog.files.some(file => file.digest === "unreadable" && required.has(file.path)))
      throw new AppError("CAPABILITY_UNAVAILABLE", "能力文件无法读取，请检查列表中的警告并修复后重试。");
    return { preferencesRevision: preferences.revision, revision: state.revision, catalog, runtime: capabilityRuntime(catalog, selection) };
  }
  /** Called within the synchronous transaction that admits a run. */
  lock(scope: Scope, plan: CapabilityPlan) {
    const state = this.state(scope);
    if (state.revision !== plan.revision) throw new AppError("REVISION_CONFLICT", "能力选择在启动准备期间改变；消息未发送，请重新发送。");
    if (state.locked && (!state.selection || JSON.stringify(state.selection) === JSON.stringify(plan.runtime.selection))) return;
    if (!state.locked && this.preferences().revision !== plan.preferencesRevision)
      throw new AppError("REVISION_CONFLICT", "全局能力选择在启动准备期间改变；消息未发送，请重新发送。");
    this.store.db.prepare("UPDATE session_capabilities SET lockedAt=COALESCE(lockedAt,?),revision=revision+1,selection=?,catalog=? WHERE sessionId=?")
      .run(Date.now(), JSON.stringify(plan.runtime.selection), JSON.stringify({ skills: plan.catalog.skills, mcp: plan.catalog.mcp }), scope.sessionId);
  }
  /** Commit only skills; idle sessions pick up the changed execution profile next time. */
  appliedSkills(scope: Scope, plan: CapabilityPlan) {
    const state = this.state(scope);
    if (state.revision !== plan.revision)
      throw new AppError("REVISION_CONFLICT", "会话状态已改变，请刷新后重新选择。");
    const row = this.store.db.prepare("SELECT catalog FROM session_capabilities WHERE sessionId=?").get(scope.sessionId);
    const mcp = row?.catalog ? JSON.parse(String(row.catalog)).mcp : plan.catalog.mcp;
    this.store.db.prepare("UPDATE session_capabilities SET legacy=0,selection=?,catalog=?,revision=revision+1 WHERE sessionId=?")
      .run(JSON.stringify(plan.runtime.selection), JSON.stringify({ skills: plan.catalog.skills, mcp }), scope.sessionId);
    this.changed(scope);
  }
  /** Publish only the selection actually accepted by a successful native reload.
   * Defaults may change while loading; those newer defaults remain pending. */
  appliedReload(scope: Scope, plan: CapabilityPlan, change?: CapabilityReloadSelection) {
    this.owner(scope);
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      if (change && this.state(scope).revision !== plan.revision)
        throw new AppError("REVISION_CONFLICT", "会话选择在重载期间改变，请重新核对后应用。");
      if (change?.target === "defaults") {
        const preferences = this.preferences();
        if (preferences.revision !== plan.preferencesRevision)
          throw new AppError("REVISION_CONFLICT", "全局默认在重载期间改变，请重新核对后应用。");
        for (const kind of ["skills", "mcp"] as const) for (const item of plan.catalog[kind])
          preferences[kind][item.preferenceKey ?? item.id] = plan.runtime.selection[kind]!.includes(item.id);
        this.store.db.prepare("INSERT INTO capability_preferences(id,revision,body) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body")
          .run(preferences.revision + 1, JSON.stringify({ skills: preferences.skills, mcp: preferences.mcp }));
        this.store.db.prepare("UPDATE session_capabilities SET selection=NULL,revision=revision+1 WHERE lockedAt IS NULL AND sessionId<>?").run(scope.sessionId);
      }
      this.store.db.prepare("UPDATE session_capabilities SET lockedAt=COALESCE(lockedAt,?),legacy=0,selection=?,catalog=?,revision=revision+1 WHERE sessionId=?")
        .run(Date.now(), JSON.stringify(plan.runtime.selection), JSON.stringify({ skills: plan.catalog.skills, mcp: plan.catalog.mcp }), scope.sessionId);
      this.store.db.exec("COMMIT");
    } catch (error) { this.store.db.exec("ROLLBACK"); throw error; }
    if (change?.target === "defaults") this.publish(capabilityPreferencesScope, { revision: this.preferences().revision });
    this.changed(scope);
  }
  changed(scope: Scope) { this.publish(capabilitiesScope(scope), this.state(scope)); }
  async command(c: Command) {
    const scope = { workspaceId: c.workspaceId!, sessionId: c.sessionId! }, p = object(c.params ?? {});
    this.owner(scope);
    if (c.op === "capabilities.get") {
      if (Object.keys(p).length) throw new AppError("INVALID_INPUT", "能力读取不接受额外参数。");
      return this.get(scope);
    }
    if (c.op === "capabilities.defaults.save") return this.store.external(c, async () => {
      if (Object.keys(p).some(key => !["revision", "catalogRevision", "kind", "id", "checked"].includes(key)) ||
          !Number.isSafeInteger(p.revision) || !["skills", "mcp"].includes(String(p.kind)) || typeof p.id !== "string" || typeof p.checked !== "boolean")
        throw new AppError("INVALID_INPUT", "全局能力偏好参数无效。");
      const catalog = await this.discover(scope), kind = p.kind as "skills" | "mcp";
      if (catalog.revision !== p.catalogRevision) throw new AppError("REVISION_CONFLICT", "能力目录已改变，请刷新后重新选择。");
      const item = catalog[kind].find(item => item.id === p.id);
      if (!item) throw new AppError("CAPABILITY_UNAVAILABLE", "此能力已不可用，请刷新列表。");
      const preferences = this.preferences();
      if (preferences.revision !== p.revision) throw new AppError("REVISION_CONFLICT", "全局选择已在另一窗口更新，请重新选择。");
      preferences[kind][item.preferenceKey ?? item.id] = p.checked;
      preferences.revision++;
      this.store.db.exec("BEGIN IMMEDIATE");
      try {
        this.store.db.prepare("INSERT INTO capability_preferences(id,revision,body) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body")
          .run(preferences.revision, JSON.stringify({ skills: preferences.skills, mcp: preferences.mcp }));
        // Explicit global changes supersede pre-upgrade per-session draft choices.
        this.store.db.prepare("UPDATE session_capabilities SET selection=NULL,revision=revision+1 WHERE lockedAt IS NULL").run();
        const result = { revision: preferences.revision };
        this.store.db.prepare("UPDATE external_requests SET state='committed',response=? WHERE id=?").run(JSON.stringify(result), c.requestId);
        this.store.db.exec("COMMIT");
      } catch (error) { this.store.db.exec("ROLLBACK"); throw error; }
      this.publish(capabilityPreferencesScope, { revision: preferences.revision });
      return { revision: preferences.revision };
    });
    if (c.op !== "capabilities.save") throw new AppError("UNKNOWN_OPERATION", "不支持的能力操作。");
    return this.store.external(c, async () => {
      const assertEditable = () => {
        const state = this.state(scope);
        if (state.locked) throw new AppError("CAPABILITIES_LOCKED", "会话已启动，能力选择已锁定；新建会话后可重新选择。");
        if (state.revision !== p.revision) throw new AppError("REVISION_CONFLICT", "能力选择已在其他窗口更新，请重新读取。");
      };
      if (Object.keys(p).some(key => !["revision", "catalogRevision", "skills", "mcp"].includes(key)) || !Number.isSafeInteger(p.revision))
        throw new AppError("INVALID_INPUT", "能力保存参数无效。");
      const ids = (value: unknown) => {
        if (!Array.isArray(value) || value.length > 2000 || value.some(id => typeof id !== "string" || id.length > 1024) || new Set(value).size !== value.length)
          throw new AppError("INVALID_INPUT", "能力选择列表无效。");
        return [...value].sort() as string[];
      };
      const selection: CapabilitySelection = { skills: ids(p.skills), mcp: ids(p.mcp) };
      assertEditable();
      const catalog = await this.discover(scope);
      if (catalog.revision !== p.catalogRevision) throw new AppError("REVISION_CONFLICT", "能力目录已改变，请刷新列表后重新选择。");
      this.verify(catalog, selection, this.storedCatalog(scope));
      this.store.db.exec("BEGIN IMMEDIATE");
      try {
        assertEditable();
        this.store.db.prepare("UPDATE session_capabilities SET selection=?,catalog=?,revision=revision+1 WHERE sessionId=?")
          .run(JSON.stringify(selection), JSON.stringify({ skills: catalog.skills, mcp: catalog.mcp }), scope.sessionId);
        const result = this.state(scope);
        this.store.db.prepare("UPDATE external_requests SET state='committed',response=? WHERE id=?")
          .run(JSON.stringify(result), c.requestId);
        this.store.db.exec("COMMIT");
        this.changed(scope);
        return result;
      } catch (error) { this.store.db.exec("ROLLBACK"); throw error; }
    });
  }
}
