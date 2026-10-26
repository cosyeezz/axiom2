import React from 'react';

export const inject = ['slots', 'chat', 'locale'];
export function apply(ctx) {
    const namespace = '__PLUGIN_NAME__';
    ctx.locale.register(namespace, { zh: { title: '对话摘录', saved: '已保存 {count} 条', saving: '保存中', save: '摘录回答', use: '填入聊天', records: '已保存摘录', failed: '操作失败', details: '错误详情' },
        en: { title: 'Conversation excerpts', saved: 'Saved {count}', saving: 'Saving', save: 'Save answer', use: 'Fill Chat', records: 'Saved excerpts', failed: 'Operation failed', details: 'Error details' } });
    styles.insert('.__PLUGIN_NAME__-clips{font:inherit;color:var(--color-text-primary)}.__PLUGIN_NAME__-clips :is(button,select){font:inherit;border:1px solid var(--color-border-default);border-radius:var(--skin-radius,6px);padding:6px 8px;background:var(--color-bg-input);color:inherit}.__PLUGIN_NAME__-clips button{cursor:pointer}.__PLUGIN_NAME__-clips button:hover:not(:disabled){background:var(--color-bg-hover)}.__PLUGIN_NAME__-clips button:disabled{opacity:.45;cursor:default}.__PLUGIN_NAME__-clips :is(button,select):focus-visible{outline:2px solid var(--color-focus-ring);outline-offset:2px}');
    ctx.slots.register({ name: 'chat.composer.before', id: '__PLUGIN_NAME__-clips' }, function Clips(p) {
        const t = ctx.locale.useT(namespace);
        const [records, setRecords] = React.useState([]), [selected, setSelected] = React.useState('');
        const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
        const latest = p.useChat(state => state.messages.filter(message => message.role === 'assistant' && !message.streaming).at(-1)?.content ?? '');
        React.useEffect(() => {
            let live = true;
            host.call('__TOOL_PREFIX__Clips', 'list').then(value => { if (live) { setRecords(value); } }, failure => { if (live) { setError(String(failure)); } });
            return () => { live = false; };
        }, []);
        const current = records.find(item => item.id === selected);
        return React.createElement('section', { className: namespace + '-clips', 'aria-label': t('title'), style: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '8px 16px' } },
            React.createElement('button', { type: 'button', disabled: busy || !latest || latest.length > 12000, onClick: async () => {
                setBusy(true); setError('');
                try { const item = await host.call('__TOOL_PREFIX__Clips', 'save', [latest]);
                    setRecords(await host.call('__TOOL_PREFIX__Clips', 'list')); setSelected(item.id); }
                catch (failure) { setError(String(failure)); } finally { setBusy(false); }
            } }, busy ? t('saving') : t('save')),
            React.createElement('select', { 'aria-label': t('records'), value: selected, onChange: event => setSelected(event.target.value), style: { maxWidth: '100%' } },
                React.createElement('option', { value: '' }, t('saved', { count: records.length })),
                ...records.map(item => React.createElement('option', { key: item.id, value: item.id }, item.content.slice(0, 40)))),
            React.createElement('button', { type: 'button', disabled: !current, onClick: () => ctx.chat.fill(current.content) }, t('use')),
            error && React.createElement('div', { role: 'alert', style: { width: '100%', overflowWrap: 'anywhere' } }, t('failed'),
                React.createElement('details', null, React.createElement('summary', null, t('details')), error)));
    });
}
