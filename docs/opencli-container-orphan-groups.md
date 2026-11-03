# OpenCLI 容器分组堆积（多排 `OpenCLI Browser`）

Chrome 标签栏里出现多个同名 `OpenCLI Browser` 分组（橙色分组胶囊），每个都对应扩展的一批“交互容器”窗口。它们不是用户标签，也不是 Axiom 的界面元素，而是 OpenCLI Chrome 扩展 `extension/src/background.ts` 中 `CONTAINER_TAB_GROUP_TITLE.interactive` 生成的分组。

## 为什么只增不减

扩展只承认“自己还记得”的分组，记忆分四层，全部基于易失状态：

1. 内存 `ownedContainers[role].groupId`；
2. `interactiveGroupLedger`（group id 台账，持久化在 `chrome.storage.session`）；
3. 各 lease 的 `preferredTabId` 所在分组；
4. 无标题且含 `preferredTabId` 的残留分组。

`chrome.storage.session` 在浏览器关闭时被清空，因此**每次重启 Chrome 后，上一轮的容器分组就变成“孤儿”**：标题仍是 `OpenCLI Browser`，但四个来源都不再指向它（第 4 层只收无标题分组）。

跨重启恢复只剩一条路：`idle-container.ts` 的 `findIdleInteractiveGroup()`，它要求扩展把归还的标签停在 `idle.html#<token>` 占位页上，并且全浏览器**唯一**。而 `parkIdleInteractiveTab()` 只在容器窗口里恰好只有这一个标签时才返回占位 URL；窗口里多一个 `about:blank`、`chrome://newtab/` 之类就退化成空白页，占位令牌不入库，于是重启后无法恢复。

结果是：`ensureOwnedContainerWindow()` 找不到候选 → `chrome.windows.create()` 新建窗口 → `createOwnedGroup()` 建新分组。孤儿分组既不会被 `convergeOwnedGroupDuplicates()` 合并（不在候选里），也没有任何清理路径，于是只增不减。若这些窗口后续被会话恢复或拖动合并到同一窗口，就会看到一整排同名胶囊。

附带后果：Axiom 的窗口定位要求该标题的分组**恰好 1 个**，并且窗口内只有分组标签或 `about:blank`。分组一多，最小化/还原静默失效，容器窗口更容易露在用户面前。

## Axiom 端处理（已实现）

`app/src/server/web-access/search-window.ts`：

- `titledGroups()` 读取全部同名分组；只有 1 个时沿用原有“只认干净窗口”的判断。
- 多于 1 个时执行 `convergeGroups()`：只把看起来很干净（窗口内除该分组标签外只有 `about:blank`）的容器作为候选，按“自有标签最多 → 窗口 ID 最小 → 分组 ID 最小”选一个规范分组，其余分组里的自有标签用 `tabs.move` 迁到规范窗口，再用 `tabs.group` 并入规范分组；空分组和空窗口由 Chrome 自行回收。用户窗口里的其他标签一律不动（窗口里带用户标签的分组只能在它是唯一干净候选时被整体迁出）。
- 合并是最尽力而为的：单步失败被吞掉，绝不改变搜索结果；`signal` 在每个窗口查询和每次搬迁前检查。
- 合并后再复查分组，仍不是 1 个就照旧放弃窗口操作。

因此每次搜索最多把现存孤儿收敛回一个容器，不再越积越多；下次重启仍可能再造一个新的，但不会再出现一排。

## 上游补丁（待提交，未在真实扩展构建上验证）

根治要扩展自己按标题收养孤儿分组。补丁见 [patches/opencli-titled-orphan-adoption.patch](patches/opencli-titled-orphan-adoption.patch)，在 `extension/src/background.ts` 的 `collectOwnedGroupCandidates()` 里加第 5 层候选：

```ts
const idleMarkerUrl = await idlePlaceholderUrl();
for (const group of await chrome.tabGroups.query({ title: CONTAINER_TAB_GROUP_TITLE[role] })) {
  if (groupsById.has(group.id)) continue;
  const windowTabs = await chrome.tabs.query({ windowId: group.windowId });
  if (windowTabs.length === 0) continue;
  const foreign = windowTabs.some(tab => tab.groupId !== group.id && tab.url !== BLANK_PAGE && tab.url !== idleMarkerUrl);
  if (!foreign) groupsById.set(group.id, group);
}
```

只收养“窗口里除该分组标签外只有空白/占位标签”的同名分组，用户自建的同名分组不会被劫持。补丁基于 `jackwener/OpenCLI@main` 的 `extension/src/background.ts` 头部原样生成，仅做过文本核对：本机没有扩展源码树，也没有跑 `extension` 的 `typecheck`/构建。

## 验证

- `app/tests/web-search-opencli.test.ts`：16 项全过，含新增“duplicate container groups are merged into the cleanest one instead of piling up”（两个分组合成一个、混合窗口里用户标签不被搬动）。
- `tests/web-search-cache.test.ts`、`tests/web-search.test.ts`：25 项全过。
- `npx tsc --noEmit` 与 `npx tsc -p tsconfig.server.json --noEmit` 通过。
- 现场观察（2026-11-02，本机 Chrome 156）：合并后只剩 1 个 `OpenCLI Browser` 分组。同一容器窗口里存在一个未分组的 `chrome://newtab/` 标签，属于“窗口多标签 → 无法停占位页”的状态，即下次重启仍会造新容器；本轮未删除该标签。另注意同一台 Chrome 可能被其他 Axiom 会话（如 `AX C1 隔离验收`）同时驱动，现场验证的窗口/分组会与其交叠。

## 未做的可选加固

容器窗口里杂散的 `about:blank`、`chrome://newtab/` 标签会让窗口不再满足“干净容器”，既挡住最小化，也挡住占位页停放。可以在合并后顺手关闭这类空白标签（仅当窗口内其余标签都属于该分组），但这是删除用户窗口内的标签，需要单独确认后再做。