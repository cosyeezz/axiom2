const referenceSuffix = / 〔[1-9]\d*〕$/u;
const canonicalKey = (purpose) => purpose.source.key === JSON.stringify([purpose.text.normalize("NFC")]);
/** Legacy locators included an ordinal. Never interpret that ordinal as a line or
 * infer a source from it: require an independently published canonical binding. */
export function canonicalMemoryPurpose(purpose, peers) {
    if (canonicalKey(purpose))
        return purpose;
    try {
        const key = JSON.parse(purpose.source.key);
        if (!Array.isArray(key) || key.length !== 2 || typeof key[0] !== "string" || !Number.isSafeInteger(key[1]) || key[1] < 0)
            return purpose;
    }
    catch {
        return purpose;
    }
    const candidates = peers.filter(other => other.source.sessionId === purpose.source.sessionId && canonicalKey(other));
    const exact = candidates.filter(other => other.text === purpose.text);
    if (exact.length)
        return exact.length === 1 ? exact[0] : purpose;
    if (/〔\d+〕$/u.test(purpose.text))
        return purpose;
    const numbered = candidates.filter(other => referenceSuffix.test(other.text) && other.text.replace(referenceSuffix, "") === purpose.text);
    return numbered.length === 1 ? numbered[0] : purpose;
}
/** Read-only compatibility for a historical goal annotated with a reference.
 * Real task/file identities keep their full titles. Arbitrary renames, changed
 * numbers, ambiguous matches and unsupported legacy keys still fail closed.
 */
export function locateMemoryPurpose(purpose, headings, peers = []) {
    const bound = canonicalMemoryPurpose(purpose, peers);
    const exact = headings.find(heading => heading.key === bound.source.key);
    if (exact)
        return exact.title === bound.text ? exact : undefined;
    if (!canonicalKey(bound) || /〔\d+〕$/u.test(bound.text))
        return;
    const candidates = headings.filter(heading => referenceSuffix.test(heading.title) && heading.title.replace(referenceSuffix, "") === bound.text);
    // A historical unnumbered alias must not bypass an already published numbered
    // identity. In particular A -> A〔1〕 -> A〔2〕 is a rename, not another annotation.
    const numberedPeers = peers.filter(other => other.source.sessionId === bound.source.sessionId && canonicalKey(other) && referenceSuffix.test(other.text) && other.text.replace(referenceSuffix, "") === bound.text);
    if (numberedPeers.length !== 1 || candidates[0]?.key !== numberedPeers[0].source.key)
        return;
    return candidates.length === 1 ? candidates[0] : undefined;
}
/** Project only proven redundant legacy leaves from the captured snapshot.
 * No source scan, index switch, persistence, or guessing from an old directory.
 * All actual source/completion/revision checks still happen before answering.
 */
export function queryMemorySnapshot(snapshot) {
    const redundant = new Set(snapshot.purposes.filter(purpose => canonicalMemoryPurpose(purpose, snapshot.purposes) !== purpose).map(purpose => purpose.id));
    if (!redundant.size)
        return snapshot;
    const prune = (nodes) => nodes.flatMap(node => {
        if (node.purposeId)
            return redundant.has(node.purposeId) ? [] : [node];
        const children = prune(node.children);
        return children.length ? [{ ...node, children }] : [];
    });
    const roots = prune(snapshot.roots);
    return { ...snapshot, roots, purposes: snapshot.purposes.filter(purpose => !redundant.has(purpose.id)), nameChars: Array.from(roots.map(root => root.name).join("\n")).length };
}
//# sourceMappingURL=memory-purpose-locator.js.map