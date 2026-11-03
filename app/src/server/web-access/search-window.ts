import { execFile } from "node:child_process";
import type { OpenCliCommand } from "./opencli-command.js";

/** Keeps the OpenCLI search window out of the way; only verification brings it forward. */
export interface SearchWindow {
  hide(command: OpenCliCommand, signal: AbortSignal): Promise<void>;
  show(command: OpenCliCommand, signal: AbortSignal): Promise<void>;
}

const GROUP_TITLE = "OpenCLI Browser";
type ChromeCall = (method: string, args: unknown[]) => Promise<unknown>;
interface ContainerGroup { id: number; windowId: number }
interface ChromeTab { id?: number; groupId?: number; url?: string }

const isId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
const tabList = (value: unknown): ChromeTab[] => Array.isArray(value)
  ? value.filter((tab): tab is ChromeTab => !!tab && typeof tab === "object") : [];

/** A window belongs to OpenCLI only when it holds nothing but the given group and blank tabs. */
const isContainerWindow = (tabs: ChromeTab[], groupId: number) => tabs.length > 0
  && tabs.every(tab => tab.groupId === groupId || tab.url === "about:blank");

async function titledGroups(call: ChromeCall): Promise<ContainerGroup[]> {
  const groups = await call("tabGroups.query", [{ title: GROUP_TITLE }]);
  return Array.isArray(groups)
    ? groups.filter((group): group is ContainerGroup => !!group && isId((group as ContainerGroup).id) && isId((group as ContainerGroup).windowId))
    : [];
}

/**
 * The bridge only recognises the container groups it still holds in its ledger, and that ledger lives in
 * chrome.storage.session, which Chrome clears on restart. Groups created before such a restart keep the title
 * but are never adopted or merged, so every later search opens another window. Merge them here, keeping the
 * fullest clean container as the canonical group; only its own tabs move, user tabs stay untouched.
 */
async function convergeGroups(call: ChromeCall, groups: ContainerGroup[], signal: AbortSignal) {
  const tabsByWindow = new Map<number, ChromeTab[]>();
  for (const { windowId } of groups) {
    if (tabsByWindow.has(windowId)) continue;
    signal.throwIfAborted();
    tabsByWindow.set(windowId, tabList(await call("tabs.query", [{ windowId }])));
  }
  const ownTabs = (group: ContainerGroup) => (tabsByWindow.get(group.windowId) ?? []).filter(tab => tab.groupId === group.id);
  const ownTabIds = (group: ContainerGroup) => ownTabs(group).map(tab => tab.id).filter(isId);
  const [canonical] = groups
    .filter(group => isContainerWindow(tabsByWindow.get(group.windowId) ?? [], group.id))
    .sort((a, b) => ownTabs(b).length - ownTabs(a).length || a.windowId - b.windowId || a.id - b.id);
  if (!canonical) return;
  for (const group of groups) {
    if (group.id === canonical.id) continue;
    const ids = ownTabIds(group);
    if (ids.length === 0) continue;
    signal.throwIfAborted();
    try {
      await call("tabs.move", [ids, { windowId: canonical.windowId }]);
      await call("tabs.group", [{ groupId: canonical.id, tabIds: ids }]);
    } catch {
      // Best effort: an unsettled duplicate must never change the search itself.
    }
  }
}

/** Find the window holding OpenCLI's own tab group; refuse windows that also hold user tabs. */
export async function ownedSearchWindow(command: OpenCliCommand, signal: AbortSignal): Promise<number | undefined> {
  const call: ChromeCall = (method, args) => command(["browser", "chrome", "call", method, JSON.stringify(args)], signal);
  let groups = await titledGroups(call);
  if (groups.length === 0) return;
  if (groups.length > 1) {
    await convergeGroups(call, groups, signal);
    groups = await titledGroups(call);
  }
  if (groups.length !== 1) return;
  const { id, windowId } = groups[0];
  return isContainerWindow(tabList(await call("tabs.query", [{ windowId }])), id) ? windowId : undefined;
}

const script = (body: string) => `on run argv
  if application "Google Chrome" is not running then return
  set targetId to (item 1 of argv) as integer
  tell application "Google Chrome"
    set target to (first window whose id is targetId)
${body}
  end tell
end run`;
const hideScript = script("    set minimized of target to true");
const showScript = script("    set minimized of target to false\n    set index of target to 1\n    activate");

function osascript(source: string, windowId: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    execFile("osascript", ["-e", source, String(windowId)], { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]), windowsHide: true },
      error => error ? reject(error) : resolve());
  });
}

/** macOS: Browser Bridge cannot change its own protected window, so AppleScript minimizes or restores it by Chrome window ID. */
export const macSearchWindow: SearchWindow = {
  async hide(command, signal) {
    const windowId = await ownedSearchWindow(command, signal);
    if (windowId !== undefined) await osascript(hideScript, windowId, signal);
  },
  async show(command, signal) {
    const windowId = await ownedSearchWindow(command, signal);
    if (windowId !== undefined) await osascript(showScript, windowId, signal);
  },
};