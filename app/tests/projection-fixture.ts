import { buildSessionProjection } from "@earendil-works/pi-coding-agent";
/** Use pi's real projection even in small display fixtures. */
export function projectionFixture(entries: any[]) {
  const branch = entries.map((entry, index) => ({ ...entry, id: entry.id ?? `entry-${index}`,
    parentId: index ? entries[index - 1].id ?? `entry-${index - 1}` : null }));
  return {
    getEntries: () => [...branch],
    buildSessionProjection: () => buildSessionProjection(branch),
  } as any;
}
