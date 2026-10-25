/** Query-local presentation only. Internal IDs/paths are not metadata in the catalog; titles stay verbatim. */
export type MemoryMatchCandidate = { id: string; text: string } & (
  { kind: "directory" | "purpose" } | { purposeId: string; purpose: string; state: string }
);
type CatalogRow = [number, "D" | "P", string] | ["G", number, string] | [number, number, string, string];

export function projectMemoryCandidates(candidates: readonly MemoryMatchCandidate[]) {
  // Copy identities now: a later caller mutation cannot change an in-flight binding.
  const ids = candidates.map(candidate => candidate.id);
  const purposes = new Map<string, number>();
  // Keep structured tuples: the prompt's JSON encoder escapes titles once, and
  // audit sanitization can inspect complete JSON instead of hiding JSON fragments.
  const catalog: CatalogRow[] = [];
  for (const [index, candidate] of candidates.entries()) {
    const number = index + 1;
    if ("kind" in candidate) {
      catalog.push([number, candidate.kind === "directory" ? "D" : "P", candidate.text]);
    } else {
      let purpose = purposes.get(candidate.purposeId);
      if (purpose === undefined) {
        purpose = purposes.size + 1;
        purposes.set(candidate.purposeId, purpose);
        catalog.push(["G", purpose, candidate.purpose]);
      }
      catalog.push([number, purpose, candidate.state, candidate.text]);
    }
  }
  return {
    catalog,
    resolve(answer: string): string[] {
      const selected: unknown = JSON.parse(answer);
      if (!Array.isArray(selected) || selected.some(number => !Number.isSafeInteger(number) || number < 1 || number > ids.length) || new Set(selected).size !== selected.length)
        throw Error("索引导航返回非整数、越界或重复编号");
      return selected.map(number => ids[number - 1]!);
    },
  };
}
