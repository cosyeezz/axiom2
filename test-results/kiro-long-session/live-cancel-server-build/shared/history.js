/** A retained live suffix must not reuse the archived prefix's identity or part masks. */
export function unarchivedGroups(groups, archived) {
    return groups.flatMap(group => {
        const ids = group.ids.filter(id => !archived.has(id));
        if (!ids.length)
            return [];
        const retained = new Set(ids);
        const id = ids[0] === group.ids[0] ? group.id
            : group.folded ? `final-process:${ids[0]}` : group.activity ? `process:${ids[0]}` : ids[0];
        return [{ ...group, id, ids,
                ...(group.thinkingOnlyIds ? { thinkingOnlyIds: group.thinkingOnlyIds.filter(id => retained.has(id)) } : {}),
                ...(group.callsOnlyIds ? { callsOnlyIds: group.callsOnlyIds.filter(id => retained.has(id)) } : {}),
                ...(group.bodyHiddenIds ? { bodyHiddenIds: group.bodyHiddenIds.filter(id => retained.has(id)) } : {}),
                ...(ids[0] !== group.ids[0] ? { selectionChange: undefined } : {}),
            }];
    });
}
//# sourceMappingURL=history.js.map