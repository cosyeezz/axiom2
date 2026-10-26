import { evidenceIds } from "../domain/semantic.js";
/** One current authorization/provenance gate for every presentation surface. */
export class AuthorizedReadView {
    store;
    policy;
    snapshot;
    workspaceId;
    objects;
    visibility = new Map();
    freshnessCache = new Map();
    parseErrors;
    deleted;
    constructor(store, policy, snapshot, workspaceId) {
        this.store = store;
        this.policy = policy;
        this.snapshot = snapshot;
        this.workspaceId = workspaceId;
        this.objects = new Map(store.objects().map(object => [object.id, object]));
        this.parseErrors = new Set(store.files().filter(file => file.status === "parse_error" || file.status === "unresolved").map(file => file.path));
        this.deleted = new Set(store.files().filter(file => file.status === "deleted").map(file => file.path));
    }
    pathAllowed(path) { return this.policy.allows(path) && (this.snapshot.files.has(path) || this.snapshot.complete && this.deleted.has(path)); }
    scopeAllowed(id) {
        const scope = this.store.scopes().find(scope => scope.id === id);
        return !!scope && scope.members.every(member => this.pathAllowed(member.path)) && [...scope.definition.include, ...scope.definition.exclude].every(pattern => pattern === "**/*" || this.policy.allows(pattern.replace(/[?*]/g, "x")));
    }
    basisAllowed(basis) {
        return basis.every(item => item.kind === "file" ? this.pathAllowed(item.key) : item.kind === "object" ? this.allowed(item.key) : item.kind === "scope" ? this.scopeAllowed(item.key) : true);
    }
    source(id) {
        const ref = this.store.source(id, this.workspaceId);
        return ref && this.pathAllowed(ref.path) ? ref : null;
    }
    allowed(id) {
        if (this.visibility.has(id))
            return this.visibility.get(id);
        const pending = [id], seen = new Set();
        let valid = true;
        while (valid && pending.length) {
            const current = pending.pop();
            if (seen.has(current) || this.visibility.get(current) === true)
                continue;
            seen.add(current);
            const object = this.objects.get(current);
            if (!object || this.visibility.get(current) === false) {
                valid = false;
                break;
            }
            const paths = new Set(object.review.basis.filter(basis => basis.kind === "file").map(basis => basis.key));
            for (const evidenceId of new Set([...evidenceIds(object), ...object.review.evidenceIds])) {
                const evidence = this.store.evidence(evidenceId);
                if (!evidence || evidence.record.kind === "scope_observation" && !this.scopeAllowed(evidence.record.scopeId)) {
                    valid = false;
                    break;
                }
                for (const name of evidence.sourcePaths)
                    paths.add(name);
                if (evidence.record.kind === "source_range" && !this.source(evidence.record.sourceRefId)) {
                    valid = false;
                    break;
                }
            }
            if (object.kind === "symbol")
                valid &&= "sourceRefId" in object.body && !!this.source(object.body.sourceRefId);
            if ("authoritySourceIds" in object.body)
                for (const sourceId of object.body.authoritySourceIds)
                    valid &&= !!this.source(sourceId);
            valid &&= [...paths].every(name => this.pathAllowed(name));
            valid &&= [...object.review.scopeIds, ...object.review.basis.filter(basis => basis.kind === "scope").map(basis => basis.key), ...("scopeIds" in object.body ? object.body.scopeIds : [])].every(scopeId => this.scopeAllowed(scopeId));
            for (const basis of object.review.basis)
                if (basis.kind === "object")
                    pending.push(basis.key);
            if (object.kind === "edge") {
                const edge = object.body;
                pending.push(edge.fromId);
                if ("objectId" in edge.target)
                    pending.push(edge.target.objectId);
                else
                    valid &&= !!this.source(edge.target.sourceRefId);
            }
        }
        if (valid)
            for (const objectId of seen)
                this.visibility.set(objectId, true);
        this.visibility.set(id, valid);
        return valid;
    }
    get(id, includeRetired = false) {
        const object = this.objects.get(id);
        return object && (includeRetired || object.lifecycle === "active") && this.allowed(id) ? object : null;
    }
    freshness(id) {
        if (this.freshnessCache.has(id))
            return this.freshnessCache.get(id);
        const pending = [id], seen = new Set(), scopes = new Map(this.store.scopes().map(scope => [scope.id, scope]));
        let state = this.store.meta("reconciled") === "true" ? "current" : "unresolved", grounded = false;
        const unresolved = () => { if (state !== "stale")
            state = "unresolved"; };
        while (pending.length) {
            const current = pending.pop();
            if (seen.has(current))
                continue;
            seen.add(current);
            const object = this.objects.get(current);
            if (!object || !this.allowed(current)) {
                unresolved();
                continue;
            }
            if (object.lifecycle === "retired")
                state = "stale";
            if (object.review.unresolved || !object.review.basis.length)
                unresolved();
            for (const basis of object.review.basis) {
                if (basis.kind === "file") {
                    grounded = true;
                    if (this.parseErrors.has(basis.key))
                        unresolved();
                    else if (this.snapshot.files.get(basis.key)?.contentHash !== basis.version)
                        state = "stale";
                }
                else if (basis.kind === "scope") {
                    grounded = true;
                    const scope = scopes.get(basis.key);
                    if (!scope?.complete)
                        unresolved();
                    else if (scope.contentDigest !== basis.version)
                        state = "stale";
                }
                else if (basis.kind === "context") {
                    if (basis.version !== (basis.key === "policy" ? this.snapshot.policyHash : this.snapshot.analysisContextHash))
                        state = "stale";
                }
                else {
                    const dependency = this.objects.get(basis.key);
                    if (!dependency || dependency.lifecycle !== "active" || String(dependency.contentRev) !== basis.version)
                        state = "stale";
                    else
                        pending.push(basis.key);
                }
            }
        }
        if (!grounded)
            unresolved();
        this.freshnessCache.set(id, state);
        return state;
    }
    active() { return [...this.objects.values()].filter(object => object.lifecycle === "active" && this.allowed(object.id)); }
}
//# sourceMappingURL=authorized-view.js.map