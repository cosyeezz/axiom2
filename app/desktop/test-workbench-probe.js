// Runs only in the isolated native probe build after the real workbench loads.
(() => {
  if (window.__axiomWorkbenchProbeStarted) return;
  window.__axiomWorkbenchProbeStarted = true;
  const invoke = (action, observation) => window.__TAURI_INTERNALS__.invoke("axiom_test_probe", { action, observation });
  const wait = async (condition) => {
    const until = Date.now() + 30000;
    while (Date.now() < until) { const value = condition(); if (value) return value; await new Promise((done) => setTimeout(done, 50)); }
    throw Error("Workbench probe condition timed out");
  };
  void (async () => {
    const row = await wait(() => document.querySelector('[data-session-id="desktop-probe-session"] .history-item'));
    row.click();
    const input = await wait(() => document.querySelector('textarea[data-od-id="message-input"]'));
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, "Mac 单窗口切换保留草稿");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus(); input.setSelectionRange(3, 8);
    const content = document.createElement("div"); content.style.height = "2400px";
    document.getElementById("messages").append(content);
    await new Promise((done) => setTimeout(done, 150));
    const thread = document.getElementById("thread"); thread.scrollTop = 237;
    const token = crypto.randomUUID(); let sample = 0;
    const denied = [];
    for (const [name, args] of [["axiom_service", { action: "stop" }], ["axiom_update", { action: "status" }], ["axiom_controls", {}], ["axiom_connection", {}], ["axiom_local", { port: 0 }], ["axiom_remote", { address: "127.0.0.1", port: 0 }]]) {
      try { await window.__TAURI_INTERNALS__.invoke(name, args); denied.push(false); }
      catch (error) { denied.push(/内置页面|not allowed|not permitted|denied/i.test(String(error))); }
    }
    window.__axiomProbeSample = (sampleId) => invoke("record", { token, sample: ++sample, sampleId, draft: input.value,
      selection: [input.selectionStart, input.selectionEnd], scroll: thread.scrollTop,
      focused: document.hasFocus() && document.activeElement === input, denied,
      titleIconCount: document.querySelectorAll('.title-heading .connection-status svg').length,
      titleCopyIconCount: document.querySelectorAll('.title-heading .title-copy svg').length,
      viewport: { width: innerWidth, height: innerHeight, scale: devicePixelRatio } });
    await window.__axiomProbeSample();
  })().catch((error) => { console.error(error); void invoke("record", { error: String(error) }); });
})();
