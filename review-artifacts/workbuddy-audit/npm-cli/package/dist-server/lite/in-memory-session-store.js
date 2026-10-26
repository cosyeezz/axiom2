"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemorySessionStore = void 0;
// Lite-artifact discipline (scripts/build-server.cjs): this file transpiles
// standalone into dist-server/lite for the host facade, so every import must
// be type-only. The values below are inlined copies (kept in sync with
// transcript-branch.ts FACT_TYPES; the conformance suite asserts it).
const MAIN_LANE = 'main';
// The facts domain: session-fact records (custom items + the off-tree
// session-meta snapshot). Facts never advance the lane.
const FACT_TYPES = new Set([
    'custom-title', 'ai-title', 'file-history-snapshot', 'summary', 'topic',
    'goal-result', 'goal-progress', 'turn-metrics', 'resend-fork-notice', 'acp-terminal-state',
    'request-recovery', 'model-usage', 'credit-usage', 'session-meta',
]);
function isFactEntry(entry) {
    return FACT_TYPES.has(entry.type);
}
function payloadOf(entry) {
    const payload = entry.payload;
    return payload && typeof payload === 'object' ? payload : undefined;
}
class InMemorySessionStore {
    store = new Map();
    mtimes = new Map();
    tips = new Map();
    keyToString(key) {
        return `${key.projectKey}|${key.sessionId}|${key.subpath ?? ''}`;
    }
    async create(key) {
        const id = this.keyToString(key);
        if (this.store.has(id)) {
            return;
        }
        this.store.set(id, []);
        this.mtimes.set(`${key.projectKey}|${key.sessionId}`, Date.now());
    }
    async append(key, entries) {
        const id = this.keyToString(key);
        const existing = this.store.get(id) ?? [];
        // Stage 1 — validate and build the whole batch before touching state:
        // a rejected batch is atomic (nothing becomes visible).
        const upserts = [];
        const appends = [];
        let tip = this.tips.get(id) ?? null;
        let tipTouched = false;
        for (const entry of entries) {
            const payload = payloadOf(entry);
            if (!payload) {
                throw new Error(`append: entry without a payload (type=${entry.type}) — the store contract carries envelope-shaped entries`);
            }
            const at = entry.uuid === undefined
                ? -1
                : existing.findIndex(candidate => candidate.uuid === entry.uuid);
            if (at >= 0) {
                upserts.push({ at, entry }); // upsert rewrites content; the lane never moves
                continue;
            }
            if (!isFactEntry(entry)) {
                if (payload.parentId === null) {
                    delete payload.parentId; // segment-root re-anchor: stored form is absence
                }
                else if (payload.parentId === undefined) {
                    if (tip !== null) {
                        payload.parentId = tip;
                    }
                }
                else if (payload.parentId !== tip) {
                    // Predicted-parent validation, fail-loud: a stale
                    // prediction rejects rather than silently forking.
                    throw new Error(`append: invalid_entry — predicted parentId '${String(payload.parentId)}' does not match the lane tip '${tip ?? 'null (unborn)'}'`);
                }
                if (typeof entry.uuid === 'string') {
                    tip = entry.uuid;
                    tipTouched = true;
                }
            }
            appends.push(entry);
        }
        // Stage 2 — commit.
        for (const { at, entry } of upserts) {
            existing[at] = entry;
        }
        existing.push(...appends);
        this.store.set(id, existing);
        if (tipTouched) {
            this.tips.set(id, tip);
        }
        this.mtimes.set(`${key.projectKey}|${key.sessionId}`, Date.now());
    }
    async load(key, opts) {
        const entries = this.store.get(this.keyToString(key));
        if (!entries) {
            return null;
        }
        const last = opts?.last;
        return last !== undefined && last >= 0 ? entries.slice(-last) : [...entries];
    }
    async listSessions(projectKey) {
        const sessions = [];
        for (const id of this.store.keys()) {
            const [entryProject, sessionId, subpath] = id.split('|');
            if (entryProject === projectKey && subpath === '') {
                sessions.push({ sessionId, mtime: this.mtimes.get(`${projectKey}|${sessionId}`) ?? 0 });
            }
        }
        return sessions;
    }
    async delete(key) {
        const id = this.keyToString(key);
        this.store.delete(id);
        this.tips.delete(id);
        if (!key.subpath) {
            this.mtimes.delete(`${key.projectKey}|${key.sessionId}`);
        }
    }
    async listSubkeys(key) {
        const subkeys = [];
        for (const id of this.store.keys()) {
            const [entryProject, sessionId, subpath] = id.split('|');
            if (entryProject === key.projectKey && sessionId === key.sessionId && subpath !== '') {
                subkeys.push(subpath);
            }
        }
        return subkeys;
    }
    async listLanes(key) {
        return [{ lane: MAIN_LANE, tip: this.tips.get(this.keyToString(key)) ?? null }];
    }
    async getLane(key, lane = MAIN_LANE) {
        if (lane !== MAIN_LANE) {
            return null;
        }
        return this.tips.get(this.keyToString(key)) ?? null;
    }
    async moveLane(key, lane, to) {
        if (lane !== MAIN_LANE) {
            throw new Error(`Unknown lane: ${lane}`);
        }
        this.tips.set(this.keyToString(key), to);
    }
    async appendFactAndMoveLane(key, entries, lane, to) {
        if (lane !== MAIN_LANE) {
            throw new Error(`appendFactAndMoveLane: unknown lane '${lane}'`);
        }
        // Validate: all entries must be fact-type (off-chain).
        for (const entry of entries) {
            if (!isFactEntry(entry)) {
                throw new Error(`appendFactAndMoveLane: entry type '${entry.type}' is not a fact type — ` +
                    'only fact entries (off-chain) are allowed in this atomic operation');
            }
        }
        const id = this.keyToString(key);
        const existing = this.store.get(id) ?? [];
        // Stage 1 — validate the whole batch.
        const upserts = [];
        const appends = [];
        for (const entry of entries) {
            const payload = payloadOf(entry);
            if (!payload) {
                throw new Error(`appendFactAndMoveLane: entry without a payload (type=${entry.type})`);
            }
            const at = entry.uuid === undefined
                ? -1
                : existing.findIndex(candidate => candidate.uuid === entry.uuid);
            if (at >= 0) {
                upserts.push({ at, entry });
                continue;
            }
            appends.push(entry);
        }
        // Stage 2 — commit: entries + lane move as one unit.
        for (const { at, entry } of upserts) {
            existing[at] = entry;
        }
        existing.push(...appends);
        this.store.set(id, existing);
        this.tips.set(id, to);
        this.mtimes.set(`${key.projectKey}|${key.sessionId}`, Date.now());
    }
    async loadLane(key, lane) {
        const id = this.keyToString(key);
        const entries = this.store.get(id) ?? [];
        const at = lane ?? MAIN_LANE;
        let start;
        if (at === MAIN_LANE) {
            start = this.tips.get(id) ?? null;
            if (start === null) {
                return []; // unborn lane: an empty active branch
            }
        }
        else {
            start = at;
        }
        const byUuid = new Map();
        for (const entry of entries) {
            if (!isFactEntry(entry) && typeof entry.uuid === 'string') {
                byUuid.set(entry.uuid, entry);
            }
        }
        if (!byUuid.has(start)) {
            throw new Error(`loadLane: unresolvable lane or entry id: ${String(at)}`);
        }
        const branch = [];
        const visited = new Set();
        let cursor = start;
        while (cursor !== undefined && !visited.has(cursor)) {
            visited.add(cursor);
            const entry = byUuid.get(cursor);
            if (!entry) {
                break; // tolerate a broken link: the walk ends here
            }
            branch.push(entry);
            const parentId = payloadOf(entry)?.parentId;
            cursor = typeof parentId === 'string' ? parentId : undefined;
        }
        return branch.reverse();
    }
    /** Test helper — all entries for a key, in stored order. */
    getEntries(key) {
        return [...(this.store.get(this.keyToString(key)) ?? [])];
    }
    /** Test helper — number of stored transcripts (main and subagent copies). */
    size() {
        return this.store.size;
    }
}
exports.InMemorySessionStore = InMemorySessionStore;
