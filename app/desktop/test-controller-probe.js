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
  const button = async (text) => wait(() => [...document.querySelectorAll("button")].find((item) => (item.getAttribute("aria-label") || item.textContent).includes(text) && !item.disabled && item.getClientRects().length));
  const preparation = async () => {
    const details = await wait(() => document.querySelector(".startup-preparation"));
    if (!details.open) details.querySelector("summary").click();
    await wait(() => details.open);
    const connect = await wait(() => [...details.querySelectorAll(".startup-steps button")].find((item) => item.textContent.includes("连接工作台") && !item.disabled));
    connect.click();
  };
  const heading = async (text) => {
    const state = { "服务运行中": "running", "服务已停止": "stopped" }[text];
    check(state, `Unknown service state: ${text}`);
    return wait(() => [...document.querySelectorAll(`.connection-status-tag[data-state="${state}"]`)].some((item) => item.getClientRects().length));
  };
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
  const controllerLayouts = [];
  let stage = "initial-controller-layout";
  const controlBounds = async (expectedWidth) => {
    const state = await wait(async () => {
      const state = await invoke("snapshot");
      const control = state.views.find((view) => view.label === "pake");
      return state.current === "control" && control && control.x === 0 && control.y === 0
        && (!expectedWidth || Math.abs(state.width / state.scale - expectedWidth) <= 2)
        && Math.abs(control.width - state.width) <= 2 && Math.abs(control.height - state.height) <= 2
        && Math.abs(innerWidth * state.scale - state.width) <= 2
        && Math.abs(innerHeight * state.scale - state.height) <= 2 ? state : null;
    });
    controllerLayouts.push({ stage, state, viewport: { width: innerWidth, height: innerHeight } });
  };
  void (async () => {
    // Exercise the controller before the first workbench exists, including expansion.
    await invoke("resize");
    await controlBounds(900);
    stage = "controller-large";
    await invoke("resize-large");
    await controlBounds(1480);
    stage = "controller-maximized";
    await invoke("maximize");
    await wait(async () => (await invoke("snapshot")).maximized);
    await controlBounds();
    await invoke("unmaximize");
    await wait(async () => !(await invoke("snapshot")).maximized);
    if (/Mac/.test(navigator.platform)) {
      stage = "controller-fullscreen";
      await invoke("fullscreen");
      await wait(async () => (await invoke("snapshot")).fullscreen);
      await new Promise((done) => setTimeout(done, 1000));
      await controlBounds();
      stage = "controller-leave-fullscreen";
      await invoke("leave-fullscreen");
      await wait(async () => !(await invoke("snapshot")).fullscreen);
      await new Promise((done) => setTimeout(done, 1000));
      await controlBounds();
    }
    stage = "controller-restored";
    await invoke("resize");
    await controlBounds(900);
    stage = "service-preparation";
    await preparation();
    if (window.__axiomProbeMode === "reopen") {
      await heading("服务运行中");
      const state = await invoke("snapshot");
      check(state.current === "control" && state.views.length === 1 && state.windows.length === 1, "Reopening must restore only the controller");
      await invoke("finished", { controllerLayouts, checks: ["reopen-running-service-without-starting-another"] });
      void invoke("close"); return;
    }
    await heading("服务已停止");
    (await button("启动后台服务")).click();
    await heading("服务运行中");
    (await button("打开工作台")).click();
    stage = "workbench-initial-observation";
    const before = await observation((value) => value.sample === 1);
    check(before.denied.length === 4 && before.denied.every(Boolean), "Remote management or local connection query was not rejected");
    check(before.titleIconCount === 0, "The old title connection icon must be removed");
    const headerStatus = await wait(() => document.querySelector('.desktop-workbench-status[data-state="connected"]'));
    check(headerStatus.textContent.trim() === "后台服务已连接", "Connected header label missing");
    const bridgeStates = await Promise.all([1, 2].map(() => window.__TAURI_INTERNALS__.invoke("axiom_connection")));
    check(bridgeStates.every((state) => state === "connected"), "Native connection observations must return the real connected state");
    const colors = {};
    for (const [state, expected] of Object.entries({ connected: "rgb(104, 191, 124)", disconnected: "rgb(224, 138, 138)", checking: "rgb(152, 159, 169)" })) {
      // Check packaged CSS in WKWebView; live connected state is checked above.
      headerStatus.dataset.state = state;
      const text = getComputedStyle(headerStatus).color;
      const icon = getComputedStyle(headerStatus.querySelector("svg")).color;
      check(text === "rgb(174, 182, 176)" && icon === expected, `Unexpected ${state} header colors: ${text} / ${icon}`);
      colors[state] = { text, icon };
    }
    headerStatus.dataset.state = "connected";
    const header = { bridgeStates, colors, titleIconCount: before.titleIconCount };
    check(before.scroll > 0 && before.draft === "Mac 单窗口切换保留草稿", "Real composer/scroll fixture missing");
    stage = "workbench-lifecycle";
    bounds(await invoke("snapshot"));
    await invoke("checkpoint", { controllerLayouts });
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
    await wait(async () => {
      const state = await invoke("snapshot");
      return Math.abs(state.width / state.scale - 900) < 2
        && state.views.every((view) => Math.abs(view.width - state.width) <= 2)
        && Math.abs(state.views.reduce((height, view) => height + view.height, 0) - state.height) <= 2;
    });
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
    await invoke("finished", { controllerLayouts, header, checks: ["native-connection-bridge", "fixed-status-text-and-waveform-colors", "offline-control", "start-stop-restart", "one-window-two-views", "remote-command-denial", "draft-scroll-selection-focus", "controller-resize-before-connect", "controller-maximize", "controller-fullscreen", "native-resize", "native-close-with-running-service"] });
    void invoke("close");
  })().catch(async (error) => {
    console.error(error);
    await invoke("inspect-workbench").catch(() => {});
    await new Promise((done) => setTimeout(done, 300));
    await invoke("failed", { error: String(error), stack: error.stack, stage, controllerLayouts });
  });
})();
