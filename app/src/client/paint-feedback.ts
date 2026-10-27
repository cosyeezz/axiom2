/** Let React commit local feedback and give the browser a paint opportunity
 * before dispatching work. Hidden/paused windows still make progress. */
export function paintFeedback() {
  if (typeof document === "undefined") return Promise.resolve();
  return new Promise<void>(resolve => {
    let frame: number | undefined, task: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      clearTimeout(fallback);
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (task !== undefined) clearTimeout(task);
      resolve();
    };
    const fallback = setTimeout(finish, 250);
    if (document.visibilityState === "hidden") task = setTimeout(finish, 0);
    else frame = requestAnimationFrame(() => { task = setTimeout(finish, 0); });
  });
}
