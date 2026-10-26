export function isEnvironmentInventory(value) {
    const record = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    const strings = (v) => Array.isArray(v) && v.every(item => typeof item === 'string');
    const count = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
    const location = (v) => record(v) && typeof v.path === 'string' && typeof v.purpose === 'string'
        && ['present', 'missing', 'unknown', 'link'].includes(String(v.state)) && count(v.bytes) && count(v.files) && count(v.links)
        && typeof v.complete === 'boolean' && strings(v.issues);
    if (!record(value) || typeof value.root !== 'string' || !Array.isArray(value.items) || !Array.isArray(value.commands)
        || !strings(value.notes) || typeof value.pathIncomplete !== 'boolean' || !count(value.entries) || !count(value.elapsedMs)
        || ![undefined, 'current', 'selected'].includes(value.scope)
        || value.origin !== undefined && value.origin !== 'unknown'
        || value.automaticRemovalAllowed !== undefined && value.automaticRemovalAllowed !== false)
        return false;
    if (!value.items.every(item => record(item) && typeof item.id === 'string' && typeof item.label === 'string' && typeof item.note === 'string'
        && ['detected', 'missing', 'unknown'].includes(String(item.state)) && Array.isArray(item.locations) && item.locations.every(location))
        || !value.commands.every(command => record(command) && typeof command.command === 'string' && typeof command.path === 'string' && typeof command.link === 'boolean'))
        return false;
    const residuals = value.residuals;
    return residuals === undefined || record(residuals) && typeof residuals.complete === 'boolean' && strings(residuals.issues)
        && Array.isArray(residuals.items) && residuals.items.every(item => record(item) && location(item) && item.automaticRemovalAllowed === false && typeof item.retention === 'string');
}
//# sourceMappingURL=environment-inventory.js.map