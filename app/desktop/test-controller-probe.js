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
  const fixturePort = window.__axiomProbePort;
  check(Number.isInteger(fixturePort) && fixturePort > 0 && fixturePort <= 65535 && fixturePort !== 4317, "Expected explicit isolated fixture port");
  const fixtureURL = `http://127.0.0.1:${fixturePort}/`;
  const setPort = async (port) => {
    const input = await wait(() => document.querySelector('input[aria-label="本地端口"]:not(:disabled)'));
    await invoke("progress", { stage: "port-input-found", port });
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, String(port));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // Wait for React's actual custom/managed-port UI, not animation frames:
    // WKWebView can withhold those indefinitely when the test app is occluded.
    await wait(() => {
      const meta = document.querySelector('.connection-primary-meta [role="status"]');
      return input.value === String(port) && meta
        && (meta.textContent === "连接此端口上已有的服务") === (port !== 4317);
    });
    await invoke("progress", { stage: "port-ui-committed", port });
  };
  const connectFixture = async () => {
    await setPort(fixturePort);
    (await button("连接工作台")).click();
    await wait(async () => {
      const state = await invoke("snapshot");
      const view = state.views.find((item) => item.label === "axiom-workbench");
      return state.current === "workbench" && view?.url === fixtureURL;
    });
  };
  const preparation = async () => {
    await invoke("progress", { stage: "preparation-find" });
    const details = await wait(() => document.querySelector(".startup-preparation"));
    if (!details.open) details.querySelector("summary").click();
    await wait(() => details.open && details.querySelector('.setup-simple[aria-label="本地连接准备"]')?.getClientRects().length);
    details.querySelector("summary").click();
    await wait(() => !details.open);
    await invoke("progress", { stage: "preparation-collapsed" });
  };
  const heading = async (text) => {
    const state = { "服务运行中": "running", "服务已停止": "stopped" }[text];
    const label = { running: "运行中", stopped: "已停止" }[state];
    check(state, `Unknown service state: ${text}`);
    // A custom port is navigation-only. Restore the managed controls explicitly.
    await invoke("progress", { stage: "service-heading-port", expectedState: state });
    await setPort(4317);
    await invoke("progress", { stage: "service-heading-state", expectedState: state });
    return wait(async () => {
      const visible = [...document.querySelectorAll('.connection-service-heading .connection-status-tag')].some((item) => item.dataset.state === state && item.textContent.trim() === label && item.getClientRects().length);
      const service = await window.__TAURI_INTERNALS__.invoke("axiom_service", { action: "status" });
      return visible && service.state === state;
    });
  };
  const serviceButton = async (state, label) => {
    await heading(state === "running" ? "服务运行中" : "服务已停止");
    return wait(() => [...document.querySelectorAll('button.connection-primary-button')].find((item) => item.textContent.trim() === label && !item.disabled && item.getClientRects().length));
  };
  const observation = async (condition) => wait(async () => {
    const value = (await invoke("snapshot")).observation;
    if (value?.error) throw Error(value.error);
    return value && condition(value) ? value : null;
  });
  const freshSample = async (condition) => {
    const sampleId = crypto.randomUUID();
    await invoke("sample", { sampleId });
    return observation((value) => value.sampleId === sampleId && condition(value));
  };
  const bounds = (state) => {
    check(state.windows.length === 1 && state.windows[0] === "pake", "Expected one native window");
    check(state.views.length === 2 && state.current === "workbench", "Expected two views in the workbench presentation");
    const control = state.views.find((view) => view.label === "pake");
    const workbench = state.views.find((view) => view.label === "axiom-workbench");
    check(control && workbench, "Expected local and remote views");
    check(control.x === state.contentX && control.y === state.contentY && workbench.x === state.contentX, "Unexpected view positions");
    check(Math.abs(control.height - 48 * state.scale) <= 2 && Math.abs(workbench.y - control.y - control.height) <= 2, "Navigation bar overlaps workbench");
    check(Math.abs(innerHeight - 48) <= 2, "Native title bar obscures the navigation bar");
    check(Math.abs(control.width - state.width) <= 2 && Math.abs(workbench.width - state.width) <= 2, "Views must follow native width");
    check(Math.abs(control.height + workbench.height - state.height) <= 2, "Views must cover native height");
  };
  const settledBounds = async () => {
    let lastError;
    try {
      return await wait(async () => {
        const state = await invoke("snapshot");
        try { bounds(state); return state; } catch (error) { lastError = error; return null; }
      });
    } catch (error) { throw Error(`${error}; last native layout assertion: ${lastError}`); }
  };
  const controllerLayouts = [];
  const retention = {};
  const viewport = () => ({ width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio,
    clientWidth: document.documentElement.clientWidth, clientHeight: document.documentElement.clientHeight,
    visualWidth: visualViewport?.width, visualHeight: visualViewport?.height, visualScale: visualViewport?.scale });
  let lastControlLayout;
  let stage = "initial-controller-layout";
  const controlBounds = async (expectedWidth) => {
    const state = await wait(async () => {
      const state = await invoke("snapshot");
      const control = state.views.find((view) => view.label === "pake");
      lastControlLayout = { state, viewport: viewport() };
      return state.current === "control" && control && control.x === state.contentX && control.y === state.contentY
        && (!state.nativeGeometry || (Math.abs(state.nativeGeometry.layoutWidth * state.scale - state.width) <= 2
          && Math.abs(state.nativeGeometry.layoutHeight * state.scale - state.height) <= 2))
        && (!expectedWidth || Math.abs(state.width / state.scale - expectedWidth) <= 2)
        && Math.abs(control.width - state.width) <= 2 && Math.abs(control.height - state.height) <= 2
        && Math.abs(innerWidth * state.scale - state.width) <= 2
        && Math.abs(innerHeight * state.scale - state.height) <= 2 ? state : null;
    });
    controllerLayouts.push({ stage, state, viewport: viewport() });
    await invoke("progress", { stage, controllerLayouts });
  };
  void (async () => {
    // Exercise the controller before the first workbench exists, including expansion.
    await invoke("progress", { stage, viewport: viewport() });
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
    (await serviceButton("stopped", "启动")).click();
    await heading("服务运行中");
    await connectFixture();
    stage = "workbench-initial-observation";
    let before = await observation((value) => value.sample === 1);
    retention.initial = before;
    check(before.denied.length === 6 && before.denied.every(Boolean), "Remote management or local connection query was not rejected");
    check(before.titleIconCount === 0, "The old title connection icon must be removed");
    check(before.titleCopyIconCount === 1, "The title copy button must retain its icon");
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
    const header = { bridgeStates, colors, titleIconCount: before.titleIconCount, titleCopyIconCount: before.titleCopyIconCount };
    check(before.scroll > 0 && before.draft === "Mac 单窗口切换保留草稿", "Real composer/scroll fixture missing");
    stage = "workbench-lifecycle";
    bounds(await invoke("snapshot"));
    await invoke("checkpoint", { controllerLayouts });
    await wait(async () => (await invoke("snapshot")).acknowledged);
    // The window/second-instance checks may change layout or focus. Capture the
    // actual retained state immediately before leaving, not the old load sample.
    before = await freshSample((value) => value.sample > before.sample);
    retention.before = before;
    check(before.token === retention.initial.token && before.draft === "Mac 单窗口切换保留草稿"
      && before.scroll === 237 && JSON.stringify(before.selection) === "[3,8]"
      && before.inputConnected && before.threadConnected && before.focused, "Reading fixture was not stable before switching");
    (await button("服务与更新")).click();
    await heading("服务运行中");
    const hidden = await invoke("snapshot");
    check(hidden.views.length === 2 && hidden.current === "control", "Returning must retain the hidden workbench");
    check(hidden.views.find((view) => view.label === "pake").height === hidden.height, "Returning must restore full-height controls");
    await connectFixture();
    await button("服务与更新");
    const after = await freshSample((value) => value.sample > before.sample);
    retention.after = after;
    check(after.token === before.token && after.draft === before.draft && after.scroll === before.scroll, "Switching reloaded the view or lost its state");
    check(JSON.stringify(after.selection) === JSON.stringify(before.selection) && after.focused, "Switching lost selection or keyboard focus");
    if (/Mac/.test(navigator.platform)) {
      await invoke("menu-home");
      await heading("服务运行中");
      const menu = await invoke("snapshot");
      check(menu.current === "control" && menu.views.length === 2, "Native menu must return to controls without replacing the workbench");
      await connectFixture();
      await button("服务与更新");
      await invoke("hide");
      await invoke("dock-hidden");
      await wait(async () => (await invoke("snapshot")).visible);
      const dock = await freshSample((value) => value.sample > after.sample);
      retention.dock = dock;
      check(dock.token === before.token && dock.draft === before.draft && dock.scroll === before.scroll
        && JSON.stringify(dock.selection) === JSON.stringify(before.selection) && dock.focused, "Native menu or Dock reopen lost the working view");
    }
    await invoke("resize");
    await wait(async () => {
      const state = await invoke("snapshot");
      return Math.abs(state.width / state.scale - 900) < 2
        && state.views.every((view) => Math.abs(view.width - state.width) <= 2)
        && Math.abs(state.views.reduce((height, view) => height + view.height, 0) - state.height) <= 2;
    });
    bounds(await invoke("snapshot"));
    stage = "direct-service-lifecycle";
    (await button("服务与更新")).click();
    await heading("服务运行中");
    (await serviceButton("running", "关闭")).click();
    (await button("确认关闭服务")).click();
    await heading("服务已停止");
    const directStopped = await invoke("snapshot");
    check(directStopped.views.length === 2 && directStopped.current === "control", "Stopping must preserve the direct workbench");
    await wait(async () => await window.__TAURI_INTERNALS__.invoke("axiom_connection") === "disconnected");
    (await serviceButton("stopped", "启动")).click();
    await heading("服务运行中");
    await connectFixture();
    await wait(async () => await window.__TAURI_INTERNALS__.invoke("axiom_connection") === "connected");
    const directRestarted = await freshSample((value) => value.sample > after.sample);
    retention.directRestarted = directRestarted;
    check(directRestarted.token === before.token && directRestarted.draft === before.draft && directRestarted.scroll === before.scroll, "Restarting the endpoint replaced the direct view or lost its state");
    check(JSON.stringify(directRestarted.selection) === JSON.stringify(before.selection) && directRestarted.focused, "Direct restart lost selection or focus");
    bounds(await invoke("snapshot"));
    // Exercise the distinct managed contract too, without replacing the real UI direct-connection stage.
    stage = "managed-service-lifecycle";
    (await button("服务与更新")).click();
    await heading("服务运行中");
    await window.__TAURI_INTERNALS__.invoke("axiom_service", { action: "open" });
    await settledBounds();
    (await button("服务与更新")).click();
    await heading("服务运行中");
    (await serviceButton("running", "关闭")).click();
    (await button("确认关闭服务")).click();
    await heading("服务已停止");
    const stopped = await invoke("snapshot");
    check(stopped.views.length === 1 && stopped.current === "control", "Stopping must discard the managed workbench and preserve controls");
    (await serviceButton("stopped", "启动")).click();
    await heading("服务运行中");
    await window.__TAURI_INTERNALS__.invoke("axiom_service", { action: "open" });
    await observation((value) => value.token !== before.token);
    await settledBounds();
    await invoke("finished", { controllerLayouts, retention, header, checks: ["explicit-isolated-ui-endpoint", "direct-restart-preserves-view", "managed-stop-discards-view", "native-connection-bridge", "fixed-status-text-and-waveform-colors", "offline-control", "start-stop-restart", "one-window-two-views", "remote-command-denial", "draft-scroll-selection-focus", "controller-resize-before-connect", "controller-maximize", "controller-fullscreen", "native-resize", "native-close-with-running-service"] });
    void invoke("close");
  })().catch(async (error) => {
    console.error(error);
    await invoke("inspect-workbench").catch(() => {});
    await new Promise((done) => setTimeout(done, 300));
    await invoke("failed", { error: String(error), stack: error.stack, stage, controllerLayouts, retention, lastControlLayout, viewport: viewport() });
  });
})();
