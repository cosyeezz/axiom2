import type { Store } from "./storage.js";
import { AppError, object, type Command, type Scope } from "../shared/protocol.js";
import { capabilitiesScope, type CapabilityCatalog, type CapabilityItem, type CapabilitySelection, type CapabilityState } from "../shared/capabilities.js";
import { capabilityRuntime, discoverCapabilities, type DiscoveredCapabilities } from "./capability-resources.js";

export type CapabilityPlan = { revision: number; catalog: DiscoveredCapabilities; runtime: ReturnType<typeof capabilityRuntime> };
export class Capabilities {
  constructor(readonly store: Store, readonly publish: (scope: string, data?: unknown) => void, readonly sharedPiDir?: string) {}
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
  private selected(catalog: DiscoveredCapabilities, state: CapabilityState): CapabilitySelection {
    return state.selection ?? (state.legacy ? { skills: null, mcp: [] } : {
      skills: catalog.skills.filter(item => item.defaultSelected).map(item => item.id),
      mcp: catalog.mcp.filter(item => item.defaultSelected).map(item => item.id),
    });
  }
  private verify(catalog: DiscoveredCapabilities, selection: CapabilitySelection) {
    if (selection.skills?.some(id => !catalog.skills.some(item => item.id === id)) || selection.mcp.some(id => !catalog.mcp.some(item => item.id === id)))
      throw new AppError("CAPABILITY_UNAVAILABLE", "选中的能力已不可用，请恢复对应资源；启动前也可重新选择。");
  }
  async get(scope: Scope): Promise<CapabilityCatalog> {
    this.state(scope);
    const catalog = await this.discover(scope), state = this.state(scope);
    if (state.legacy) {
      const row = this.store.db.prepare("SELECT environment FROM agent_sessions WHERE sessionId=?").get(scope.sessionId);
      const names: string[] = row?.environment ? JSON.parse(String(row.environment)).skills ?? [] : [];
      return { state, revision: catalog.revision, skills: names.map(name => ({ id: name, name, description: "最近一次加载的技能",
        source: "历史会话环境", defaultSelected: true, available: true })), mcp: [], warnings: [], mcpPaths: catalog.mcpPaths };
    }
    const row = this.store.db.prepare("SELECT catalog FROM session_capabilities WHERE sessionId=?").get(scope.sessionId)!;
    const stored = row.catalog ? JSON.parse(String(row.catalog)) as { skills: CapabilityItem[]; mcp: CapabilityItem[] } : { skills: [], mcp: [] };
    const merge = (kind: "skills" | "mcp") => [...catalog[kind], ...stored[kind].filter(item => state.selection?.[kind]?.includes(item.id) && !catalog[kind].some(current => current.id === item.id))
      .map(item => ({ ...item, available: false }))];
    return { state, revision: catalog.revision, skills: merge("skills"), mcp: merge("mcp"), warnings: catalog.warnings, mcpPaths: catalog.mcpPaths };
  }
  async prepare(scope: Scope): Promise<CapabilityPlan> {
    const state = this.state(scope), catalog = await this.discover(scope);
    const selection = this.selected(catalog, state);
    this.verify(catalog, selection);
    return { revision: state.revision, catalog, runtime: capabilityRuntime(catalog, selection) };
  }
  /** Called within the same synchronous SQLite transaction that inserts the first run. */
  lock(scope: Scope, plan: CapabilityPlan) {
    const state = this.state(scope);
    if (state.revision !== plan.revision) throw new AppError("REVISION_CONFLICT", "能力选择在启动准备期间改变；消息未发送，请重新发送。");
    if (state.locked) return;
    this.store.db.prepare("UPDATE session_capabilities SET lockedAt=?,revision=revision+1,selection=?,catalog=? WHERE sessionId=?")
      .run(Date.now(), JSON.stringify(plan.runtime.selection), JSON.stringify({ skills: plan.catalog.skills, mcp: plan.catalog.mcp }), scope.sessionId);
  }
  changed(scope: Scope) { this.publish(capabilitiesScope(scope), this.state(scope)); }
  async command(c: Command) {
    const scope = { workspaceId: c.workspaceId!, sessionId: c.sessionId! }, p = object(c.params ?? {});
    this.owner(scope);
    if (c.op === "capabilities.get") {
      if (Object.keys(p).length) throw new AppError("INVALID_INPUT", "能力读取不接受额外参数。");
      return this.get(scope);
    }
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
      this.verify(catalog, selection);
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
