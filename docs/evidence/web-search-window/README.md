# axiom_search 窗口不弹出：验证记录

改动：`opencli-command.ts` 不再设置 `OPENCLI_CLOSE_OWNED_TAB`（复用容器窗口）；新增 `search-window.ts`，macOS 上 `open` 后最小化 OpenCLI 窗口，验证码／同意页时还原并激活，验证通过后再最小化。

- 定向测试：`tests.log`，84/84 通过（web-search*、web-read*、tool-summary、session-environment、kiro-error-observation）。两次 `tsc --noEmit` 和 `git diff --check` 均为 0。
- 实测：`live-search.mts` 直接调用 `WebSearchService`（未经生产后台），两次查询均 success。`watch.log` 每约 0.5 秒采样 Chrome 窗口：
  - 00:04:21 OpenCLI 窗口 1340722416 打开 Google 标签；00:04:24 变为 `min=true`（open 后约 3 秒，含两次只读查询和 osascript）。
  - 第二次查询全程保持最小化；用户窗口 1340722266／1340721922 状态未变。
- 未实测：窗口首次新建的场景（本次窗口已存在且未最小化）；真实验证码页的还原（只有单元测试覆盖）。
