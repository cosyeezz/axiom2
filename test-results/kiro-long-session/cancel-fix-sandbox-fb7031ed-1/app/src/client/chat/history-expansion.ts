/** A closed prefix and open suffix. New compactions never close a range being read. */
export class SegmentExpansion {
  readonly open = new Map<string, boolean>();
  readonly manual: Record<string, boolean>;
  constructor(saved: Record<string, boolean> = {}) { this.manual = { ...saved }; }
  reconcile(ids: string[]) {
    const current = new Set(ids);
    for (const id of this.open.keys()) if (!current.has(id)) this.open.delete(id);
    const known = (id: string) => this.open.has(id) || Object.hasOwn(this.manual, id);
    const lastKnown = ids.reduce((last, id, i) => known(id) ? i : last, -1);
    const firstOpen = ids.findIndex(id => this.open.get(id) ?? this.manual[id] ?? false);
    const next = ids.map((id, i) => [id, this.open.get(id) ?? this.manual[id]
      ?? (lastKnown < 0 ? i >= ids.length - 3 : i > lastKnown || (firstOpen >= 0 && i > firstOpen))] as const);
    // Migrate older independent choices without leaving an open island above a closed range.
    let closed = false;
    this.open.clear();
    for (let i = next.length - 1; i >= 0; i--) {
      const [id, value] = next[i];
      if (!value) closed = true;
      next[i] = [id, !closed] as const;
    }
    for (const [id, value] of next) {
      this.open.set(id, value);
      this.manual[id] = value; // Persist the effective boundary, including default and newly appended ranges.
    }
  }
  set(id: string, value: boolean) {
    const ids = [...this.open.keys()], position = ids.indexOf(id);
    if (position < 0) return;
    ids.forEach((key, i) => {
      if (value ? i >= position : i <= position) {
        this.manual[key] = value;
        this.open.set(key, value);
      }
    });
  }
}
