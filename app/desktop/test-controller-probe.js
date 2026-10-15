// Runs only in the isolated native probe build; exercises the packaged React UI.
(() => {
  if (window.__axiomControllerProbeStarted) return;
  window.__axiomControllerProbeStarted = true;
  const invoke = (action, observation) => window.__TAURI_INTERNALS__.invoke("axiom_test_probe", { action, observation });
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const wait = async (condition) => {
    const until = Date.now() + 60000;
    while (Date.now() < until) { const value = await condition(); if (value) return value; await new Promise((done) => setTimeout(done, 50)); }
    throw Error("Controller probe condition timed out");
  };
  const button = async (text) => wait(() => [...document.querySelectorAll("button")].find((item) => item.textContent.includes(text) && !item.disabled && item.getClientRects().length));
  const heading = async (text) => wait(() => [...document.querySelectorAll("h2")].some((item) => item.textContent === text && item.getClientRects().length));
  const observation = async (condition) => wait(async () => {
    const value = (await invoke("snapshot")).observation;
    if (value?.error) throw Error(value.error);
    return value && condition(value) ? value : null;
  });
  const bounds = (state) => {
    check(state.windows.length === 1 && state.windows[0] === "pake", "Expected one native window");
    check(state.views.length === 2 && state.current === "workbench", "Expected two views in the workbench presentation");
    const control = state.views.find((view) => view.label === "pake");
    const workbench = state.views.find((view) => view.label === "axiom-workbench");
    check(control && workbench, "Expected local and remote views");
    check(control.x === 0 && control.y === 0 && workbench.x === 0, "Unexpected view positions");
    check(Math.abs(control.height - 48 * state.scale) <= 2 && Math.abs(workbench.y - control.height) <= 2, "Navigation bar overlaps workbench");
    check(Math.abs(control.width - state.width) <= 2 && Math.abs(workbench.width - state.width) <= 2, "Views must follow native width");
    check(Math.abs(control.height + workbench.height - state.height) <= 2, "Views must cover native height");
  };
  void (async () => {
    if (window.__axiomProbeMode === "reopen") {
      await heading("服务运行中");
      const state = await invoke("snapshot");
      check(state.current === "control" && state.views.length === 1 && state.windows.length === 1, "Reopening must restore only the controller");
      await invoke("finished", { checks: ["reopen-running-service-without-starting-another"] });
      void invoke("close"); return;
    }
    await heading("服务已停止");
    (await button("启动后台服务")).click();
    await heading("服务运行中");
    (await button("打开工作台")).click();
    const before = await observation((value) => value.sample === 1);
    check(before.denied.length === 3 && before.denied.every(Boolean), "Remote management command was not rejected");
    check(before.scroll > 0 && before.draft === "Mac 单窗口切换保留草稿", "Real composer/scroll fixture missing");
    bounds(await invoke("snapshot"));
    await invoke("checkpoint");
    await wait(async () => (await invoke("snapshot")).acknowledged);
    (await button("服务与更新")).click();
    await heading("服务运行中");
    const hidden = await invoke("snapshot");
    check(hidden.views.length === 2 && hidden.current === "control", "Returning must retain the hidden workbench");
    check(hidden.views.find((view) => view.label === "pake").height === hidden.height, "Returning must restore full-height controls");
    (await button("打开工作台")).click();
    await button("服务与更新");
    await invoke("sample");
    const after = await observation((value) => value.sample > before.sample);
    check(after.token === before.token && after.draft === before.draft && after.scroll === before.scroll, "Switching reloaded the view or lost its state");
    check(JSON.stringify(after.selection) === JSON.stringify(before.selection) && after.focused, "Switching lost selection or keyboard focus");
    if (/Mac/.test(navigator.platform)) {
      await invoke("menu-home");
      await heading("服务运行中");
      const menu = await invoke("snapshot");
      check(menu.current === "control" && menu.views.length === 2, "Native menu must return to controls without replacing the workbench");
      (await button("打开工作台")).click();
      await button("服务与更新");
      await invoke("hide");
      await invoke("dock-hidden");
      await wait(async () => (await invoke("snapshot")).visible);
      await invoke("sample");
      const dock = await observation((value) => value.sample > after.sample);
      check(dock.token === before.token && dock.draft === before.draft && dock.scroll === before.scroll && dock.focused, "Native menu or Dock reopen lost the working view");
    }
    await invoke("resize");
    await wait(async () => { const state = await invoke("snapshot"); return Math.abs(state.width / state.scale - 1100) < 2; });
    bounds(await invoke("snapshot"));
    (await button("服务与更新")).click();
    (await button("关闭后台服务")).click();
    (await button("确认关闭服务")).click();
    await heading("服务已停止");
    const stopped = await invoke("snapshot");
    check(stopped.views.length === 1 && stopped.current === "control", "Stopping must discard the workbench and preserve controls");
    (await button("启动后台服务")).click();
    await heading("服务运行中");
    (await button("打开工作台")).click();
    await observation((value) => value.token !== before.token);
    bounds(await invoke("snapshot"));
    await invoke("finished", { checks: ["offline-control", "start-stop-restart", "one-window-two-views", "remote-command-denial", "draft-scroll-selection-focus", "native-resize", "native-close-with-running-service"] });
    void invoke("close");
  })().catch((error) => { console.error(error); void invoke("failed", { error: String(error), stack: error.stack }); });
})();
