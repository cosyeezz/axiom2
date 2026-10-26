export function register(on) {
    let tail = Promise.resolve();
    const list = async ($) => (await $.store.get('clips')) ?? [];
    on('engine.create', async (_$, event, next) => {
        const beneath = await next(event);
        return { ...beneath, __TOOL_PREFIX__Clips: {
            list: () => list(beneath),
            save(content) {
                if (typeof content !== 'string' || !content.trim() || content.length > 12000) { throw new Error('Excerpt must contain 1-12000 characters'); }
                const operation = tail.then(async () => {
                    const records = await list(beneath);
                    if (records.length >= 100) { throw new Error('Excerpt storage is full; manage saved excerpts before adding more'); }
                    const at = await beneath.clock.now(), item = { id: String(at) + '-' + String(records.length + 1), content, at };
                    await beneath.store.set('clips', [...records, item]); return item;
                });
                tail = operation.then(() => undefined, () => undefined); return operation;
            },
        } };
    });
    on('session.start', async ($, event, next) => {
        await $.tool.register({ name: '__TOOL_PREFIX___clips_list', description: 'Read actual saved conversation excerpts',
            inputSchema: { type: 'object', additionalProperties: false } });
        return next(event);
    });
    on('tool.call', { tool: '__TOOL_PREFIX___clips_list' }, async ($) => ({ result: { content: JSON.stringify(await list($)) } }));
}
