// Shared, inert synthetic backend for real-Workbench browser checks. No server,
// Store, model, personal files, or runner side effects are created by importing.
import type { Page, WebSocketRoute } from "playwright";
import type { Command, Scope, Session, Workspace } from "../../src/shared/protocol.js";
import type { SessionListCursor, SessionListGroup, SessionListInitial, SessionListItem, SessionListPage } from "../../src/shared/session-list.js";
import type { ChatMessage } from "../../src/shared/agent.js";
import { emptyCostTotals } from "../../src/shared/costs.js";
import { isTopSession, sessionFamilies } from "../../src/client/workspaces/session-order.js";

export const workspace = (id = "w"): Workspace => ({ id, name: `Workspace ${id}`, path: `/synthetic/${id}`, authorized: true, pinned: false });
export const session = (id: string, workspaceId = "w", extra: Partial<Session> = {}): Session => ({ id, workspaceId,
  title: `Session ${id}`, pinned: false, unread: false, messageCount: 2, updatedAt: 10, ...extra });
export type HeldSelectionRead = { c: Command; socket: WebSocketRoute; data: unknown; answered: boolean; canceled: boolean };
const key = (value: Pick<Session, "workspaceId" | "id">) => JSON.stringify([value.workspaceId, value.id]);
export class World {
  readonly workspaces = [workspace(), workspace("foreign")];
  readonly sessions = new Map<string, Session>();
  readonly lists = new Map<string, Session[]>();
  readonly messages = new Map<string, ChatMessage[]>();
  pinned: Session[] = [];
  readonly commands: Command[] = [];
  readonly unexpected: string[] = [];
  readonly sockets: WebSocketRoute[] = [];
  readonly pendingWrites = new Map<string, Command>();
  readonly pendingFirst: Command[] = [];
  readonly reads: HeldSelectionRead[] = [];
  readonly subscriptions = new Set<string>();
  readonly mutedScopes = new Set<string>();
  readonly drafts = new Map<string, Record<string, unknown>>();
  private readonly originating = new Map<string, WebSocketRoute>();
  readonly holdPages = new Set<SessionListGroup>();
  readonly exactCounts = new Map<string, number | undefined>();
  holdCounts = false;
  firstValue: Session | null = null;
  holdFirst = false;
  holdInitial = false;
  offline = false;
  verification: { status: string; data?: unknown } = { status: "not_found" };
  revision = 1;
  seq = 1;
  constructor(readonly page: Page, readonly view: Scope, readonly origin: string, readonly entry = "session-selection.tsx") {}
  get socket() { return this.sockets.at(-1)!; }
  send(value: unknown, socket = this.socket) { try { socket.send(JSON.stringify(value)); } catch { /* Originating connection may already be closed. */ } }
  receipt(c: Command, data: unknown) {
    const read = this.reads.find(read => read.c.requestId === c.requestId); if (read) read.answered = true;
    this.send({ type: "receipt", requestId: c.requestId, ok: true, data }, this.originating.get(c.requestId));
  }
  fail(c: Command, code: string) {
    const read = this.reads.find(read => read.c.requestId === c.requestId); if (read) read.answered = true;
    this.send({ type: "receipt", requestId: c.requestId, ok: false, error: { code, message: code } }, this.originating.get(c.requestId));
  }
  snapshot(scope: string, data = this.data(scope)) { this.send({ type: "snapshot", scope, streamId: "selection", seq: this.seq, data }); }
  publish(scope: string) { this.seq++; if (this.subscriptions.has(scope)) this.snapshot(scope); }
  invalidate() { this.revision++; this.publish("session-list"); }
  pending(op: string, group?: SessionListGroup) { return this.reads.filter(read => !read.answered && read.c.op === op && (!group || read.c.params?.group === group)); }
  answer(read: HeldSelectionRead, error?: string) { if (error) this.fail(read.c, error); else this.receipt(read.c, read.data); }
  data(scope: string): unknown {
    const [kind, workspaceId, sessionId] = scope.split(":");
    if (scope === "workspaces") return this.workspaces;
    if (scope === "workspace-preferences") return { lastWorkspaceId: "w", view: this.view };
    if (scope === "pinned-sessions") return this.pinned;
    if (scope === "favorites") return [];
    if (scope === "session-list" || scope === "deleted-sessions") return { revision: this.revision };
    if (scope === "configuration") return { revision: "synthetic", providerCount: 0, modelCount: 0, available: [], dataRoot: "/synthetic" };
    if (kind === "sessions") return this.lists.get(workspaceId) ?? [];
    if (kind === "session") return this.sessions.get(`${workspaceId}:${sessionId}`) ?? null;
    const messages = this.messages.get(`${workspaceId}:${sessionId}`) ?? [];
    if (kind === "messages") return messages;
    if (kind === "thread") return { ids: messages.map(m => m.id), groups: messages.map(m => ({ id: m.id, ids: [m.id], activity: false, delivery: m.role === "assistant" })), contextRevision: 1 };
    if (kind === "agent") return { selection: null, run: null, environment: null, usage: null };
    if (kind === "tasks") return { tasks: [], frozen: false, defaultModel: null };
    if (kind === "capabilities") return { revision: 0, locked: false, legacy: false, selection: null };
    if (scope === "capability-preferences") return { revision: 0, skills: {}, mcp: {} };
    if (kind === "costs") return { revision: 0 };
    if (kind === "memory-catalog") return [];
    if (kind === "memory-tree") return { version: 0, roots: [], purposes: [], nameChars: 0, pending: 0, failed: 0 };
    return null;
  }
  /** The title pool is deliberately NOT summary authority. Old selection cases
   * rely on page-external first/create/fork and list/summary count differences. */
  pageData(c: Command, group: SessionListGroup, cursor: SessionListCursor | null): SessionListPage {
    const query = String(c.params?.query ?? "");
    const candidates = [...new Map([...this.lists.values()].flat().concat(this.pinned).map(row => [key(row), row])).values()]
      .filter(row => (row.workspaceId === c.workspaceId || isTopSession(row)) && row.title.toLowerCase().includes(query.toLowerCase()));
    const locators = sessionFamilies(candidates).flatMap((family, index) => {
      const familyTop = family.some(isTopSession);
      return family.map((row, member) => ({ item: { ...row, familyId: family[0].id, familyTop } as SessionListItem,
        group: familyTop ? "top" : "workspace", familyRank: index + 1, memberRank: member + 1 }));
    }).filter(row => row.group === group && (!cursor || row.familyRank > cursor.familyRank || row.familyRank === cursor.familyRank && row.memberRank > cursor.memberRank));
    const chosen = locators.slice(0, 30), last = chosen.at(-1);
    return { revision: this.revision, items: chosen.map(row => row.item), next: locators.length > 30 && last ? {
      version: 1, streamId: "selection", revision: this.revision, workspaceId: c.workspaceId!, group, query,
      familyRank: last.familyRank, memberRank: last.memberRank } : null };
  }
  private hold(c: Command, socket: WebSocketRoute, data: unknown) {
    this.reads.push({ c, socket, data: JSON.parse(JSON.stringify(data)), answered: false, canceled: false });
  }
  async install() {
    await this.page.addInitScript(view => {
      (window as any).__name = (value: unknown) => value;
      sessionStorage.setItem("view", JSON.stringify(view)); sessionStorage.setItem("sidebarWorkspaceId", "w");
    }, this.view);
    await this.page.route("**/api/**", route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/status" && this.offline) return route.fulfill({ status: 503, json: { ok: false } });
      if (url.pathname === "/api/draft") {
        const draftKey = url.search;
        if (route.request().method() === "POST") {
          const write = route.request().postDataJSON() as Record<string, unknown>;
          const saved = { ...write, revision: Number(this.drafts.get(draftKey)?.revision ?? 0) + 1 };
          this.drafts.set(draftKey, saved); return route.fulfill({ json: saved });
        }
        return route.fulfill({ json: this.drafts.get(draftKey) ?? { revision: 0, writer: "fixture", sequence: 0, draft: { text: "", attachment: null } } });
      }
      return route.fulfill({ json: { ok: true } });
    });
    await this.page.route("**/__session_selection", route => route.fulfill({ contentType: "text/html",
      body: `<div id="root"></div><script type="module" src="/tests/fixtures/${this.entry}"></script>` }));
    await this.page.routeWebSocket("**/ws", socket => {
      this.sockets.push(socket); this.subscriptions.clear(); this.send({ type: "hello", streamId: "selection" });
      socket.onMessage(raw => {
        const c = JSON.parse(String(raw)) as Command; this.commands.push(c); this.originating.set(c.requestId, socket);
        const scope = String(c.params?.scope ?? "");
        if (c.op === "subscribe") { this.subscriptions.add(scope); if (!this.mutedScopes.has(scope)) this.snapshot(scope); this.receipt(c, { subscribed: scope }); return; }
        if (c.op === "unsubscribe") { this.subscriptions.delete(scope); this.receipt(c, {}); return; }
        if (c.op === "session-list.first") {
          if (this.holdFirst) { this.pendingFirst.push(c); this.hold(c, socket, this.firstValue); } else this.receipt(c, this.firstValue); return;
        }
        if (c.op === "session-list.initial") {
          const data: SessionListInitial = { revision: this.revision, top: this.pageData(c, "top", null), workspace: this.pageData(c, "workspace", null) };
          if (this.holdInitial) this.hold(c, socket, data); else this.receipt(c, data); return;
        }
        if (c.op === "session-list.page") {
          const group = c.params?.group as SessionListGroup, cursor = c.params?.cursor as SessionListCursor | null;
          if (cursor && (cursor.version !== 1 || cursor.streamId !== "selection" || cursor.revision !== this.revision || cursor.workspaceId !== c.workspaceId || cursor.group !== group || cursor.query !== String(c.params?.query ?? ""))) {
            this.fail(c, "CURSOR_STALE"); return;
          }
          const data = this.pageData(c, group, cursor);
          if (this.holdPages.has(group)) this.hold(c, socket, data); else this.receipt(c, data); return;
        }
        if (c.op === "session-list.counts") {
          const ids = c.params?.sessionIds;
          if (!Array.isArray(ids) || !ids.length || ids.length > 30 || new Set(ids).size !== ids.length ||
              ids.some(id => typeof id !== "string" || !this.sessions.has(`${c.workspaceId}:${id}`))) {
            this.fail(c, "INVALID_INPUT"); return;
          }
          const data = { workspaceId: c.workspaceId, items: ids.map(sessionId => {
            const key = `${c.workspaceId}:${sessionId}`;
            return { sessionId, messageCount: this.exactCounts.has(key) ? this.exactCounts.get(key) : this.sessions.get(key)!.messageCount };
          }) };
          if (this.holdCounts) this.hold(c, socket, data); else this.receipt(c, data); return;
        }
        if (["session.rename", "session.pin", "session.delete", "workspace.delete", "session.create", "agent.fork"].includes(c.op)) { this.pendingWrites.set(c.requestId, c); return; }
        if (c.op === "workspace.select") { this.receipt(c, {}); this.invalidate(); return; }
        if (c.op === "request.get") { this.receipt(c, this.verification); return; }
        if (c.op === "agent.history.index") { this.receipt(c, { revision: "empty", segments: [] }); return; }
        if (c.op === "costs.get") { this.receipt(c, { scope: { workspaceId: c.workspaceId, sessionId: c.sessionId }, requestedSessionId: c.sessionId,
          title: "Synthetic costs", updatedAt: 1, sessions: [], rows: [], total: emptyCostTotals(), warnings: [] }); return; }
        if (c.op === "input.status") { this.receipt(c, { inputs: [] }); return; }
        if (c.op === "agent.environment") { this.receipt(c, null); return; }
        if (c.op === "git.branch") { this.receipt(c, null); return; }
        if (c.op === "read.cancel") {
          const held = this.reads.find(read => read.c.requestId === c.params?.requestId); if (held) held.canceled = true;
          this.receipt(c, {}); return;
        }
        if (["ping", "session.view"].includes(c.op)) { this.receipt(c, {}); return; }
        this.unexpected.push(c.op); this.fail(c, "UNEXPECTED_TEST_OP");
      });
    });
  }
  add(value: Session, inList = false) {
    this.sessions.set(`${value.workspaceId}:${value.id}`, value);
    if (inList) this.lists.set(value.workspaceId, [...(this.lists.get(value.workspaceId) ?? []), value]);
    return value;
  }
  replace(value: Session) {
    this.sessions.set(`${value.workspaceId}:${value.id}`, value);
    for (const [id, rows] of this.lists) this.lists.set(id, rows.map(row => key(row) === key(value) ? value : row));
    this.pinned = this.pinned.map(row => key(row) === key(value) ? value : row);
  }
  async ready() {
    await this.page.goto(`${this.origin}/__session_selection`);
    await this.page.locator("#new-chat").waitFor(); await this.page.locator("#prompt").waitFor();
    await this.page.waitForFunction(() => document.querySelector("#workspace-picker summary strong")?.textContent?.includes("Workspace w"));
    await this.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  }
}
