(() => {
  // Installed only in the main document. The native port is transferred to this
  // origin, not exposed as a JavaScript interface to preview frames or links.
  window.__axiomConnectionSwipeCleanup?.();
  const handshake = '__AXIOM_CONNECTION_SWIPE_HANDSHAKE__';
  let port, gesture, suppressClickUntil = 0;
  const reset = () => { gesture = undefined; };
  const selected = () => { const selection = getSelection(); return selection && !selection.isCollapsed; };
  const selectionChanged = () => { if (selected()) reset(); };
  const blocked = target => {
    if (!(target instanceof Element) || selected()) return true;
    if (target.closest('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"]),iframe,canvas,dialog,[popover],[role="slider"],[role="scrollbar"],[data-connection-swipe="ignore"]')) return true;
    for (let element = target; element && element !== document.documentElement; element = element.parentElement) {
      const style = getComputedStyle(element);
      // Custom canvases/panners own their gestures even without native overflow.
      if (style.touchAction === 'none' || style.touchAction === 'pan-x') return true;
      // Preserve horizontal code/table/toolbar scrolling, including at its ends.
      if (element.scrollWidth > element.clientWidth + 2 && /^(auto|scroll)$/.test(style.overflowX)) return true;
    }
    return false;
  };
  const start = event => {
    reset();
    if (!port || !event.isTrusted || event.touches.length !== 1 || blocked(event.target)) return;
    const touch = event.touches[0];
    gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, time: performance.now(), horizontal: false };
  };
  const movement = event => {
    if (!gesture || selected() || event.touches.length !== 1 || performance.now() - gesture.time > 1200) { reset(); return; }
    const touch = event.touches[0];
    if (touch.identifier !== gesture.id) { reset(); return; }
    const x = Math.abs(touch.clientX - gesture.x), y = Math.abs(touch.clientY - gesture.y);
    if (!gesture.horizontal && y >= 8 && y >= x) { reset(); return; }
    if (x >= 8 && x > y * 1.5) gesture.horizontal = true;
    if (gesture.horizontal && event.cancelable) event.preventDefault();
  };
  const end = event => {
    const current = gesture;
    reset();
    if (!current || selected() || !event.isTrusted || event.touches.length || performance.now() - current.time > 1200) return;
    const touch = [...event.changedTouches].find(value => value.identifier === current.id);
    if (!touch) return;
    const x = touch.clientX - current.x, y = Math.abs(touch.clientY - current.y);
    if (Math.abs(x) < Math.max(64, Math.min(innerWidth * .18, 100)) || Math.abs(x) <= y * 1.5) return;
    if (event.cancelable) event.preventDefault();
    suppressClickUntil = performance.now() + 400;
    port.postMessage(x < 0 ? 'next' : 'previous');
  };
  const click = event => {
    if (performance.now() >= suppressClickUntil) return;
    event.preventDefault(); event.stopImmediatePropagation();
  };
  const receive = event => {
    if (event.data !== handshake || event.ports.length !== 1) return;
    port?.close(); port = event.ports[0]; reset();
  };
  document.addEventListener('touchstart', start, { capture: true, passive: true });
  document.addEventListener('touchmove', movement, { capture: true, passive: false });
  document.addEventListener('touchend', end, { capture: true, passive: false });
  document.addEventListener('touchcancel', reset, true);
  document.addEventListener('click', click, true);
  document.addEventListener('visibilitychange', reset);
  document.addEventListener('selectionchange', selectionChanged);
  window.addEventListener('blur', reset);
  window.addEventListener('message', receive);
  window.__axiomConnectionSwipeCleanup = () => {
    reset(); port?.close();
    document.removeEventListener('touchstart', start, true);
    document.removeEventListener('touchmove', movement, true);
    document.removeEventListener('touchend', end, true);
    document.removeEventListener('touchcancel', reset, true);
    document.removeEventListener('click', click, true);
    document.removeEventListener('visibilitychange', reset);
    document.removeEventListener('selectionchange', selectionChanged);
    window.removeEventListener('blur', reset);
    window.removeEventListener('message', receive);
    delete window.__axiomConnectionSwipeCleanup;
  };
})();
