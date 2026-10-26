import React from 'react';

export const inject = ['slots', 'chat', 'locale', 'commands', 'dock'];
/** @param {import('@tencent-ai/codebuddy-code/mods/client').ModContext<['slots','chat','locale','commands','dock']>} ctx */
export function apply(ctx) {
    const namespace = '__PLUGIN_NAME__';
    ctx.locale.register(namespace, { en: { notes: 'Workbench Notes', capture: 'Capture answer', use: 'Fill Chat' },
        zh: { notes: '工作台便签', capture: '摘录回答', use: '填入聊天' } });
    styles.insert(`.__PLUGIN_NAME__-workbench{display:flex;flex-direction:column;gap:12px;padding:16px;min-width:0;min-height:0;height:100%;box-sizing:border-box;font:inherit;color:var(--color-text-primary)}
.__PLUGIN_NAME__-workbench textarea{flex:1;min-height:120px;width:100%;box-sizing:border-box;resize:none;padding:12px;background:var(--color-bg-input);color:inherit}
.__PLUGIN_NAME__-workbench :is(button,textarea){font:inherit;border:1px solid var(--color-border-default);border-radius:var(--skin-radius,6px)}
.__PLUGIN_NAME__-workbench button{padding:6px 10px;background:var(--color-bg-card);color:inherit;cursor:pointer}
.__PLUGIN_NAME__-workbench button:hover:not(:disabled){background:var(--color-bg-hover)}
.__PLUGIN_NAME__-workbench button:disabled{opacity:.45;cursor:default}
.__PLUGIN_NAME__-workbench :is(button,textarea):focus-visible{outline:2px solid var(--color-focus-ring);outline-offset:2px}`);
    const store = ctx.slots.defineStore({ init: () => ({ text: '' }), persist: 'workbench-notes',
        persistence: { version: 1, validate: value => !!value && typeof value === 'object' && 'text' in value && typeof value.text === 'string',
            migrate(value, context) {
                if (context.fromVersion !== 0 || !value || typeof value !== 'object' || !('text' in value) || typeof value.text !== 'string') {
                    throw new Error('Cannot migrate the saved notes');
                }
                return { text: value.text };
            } },
        actions: { edit(draft, /** @type {string} */ text) { draft.text = text; } } });
    ctx.slots.register({ name: 'app.dock.tabs.item', id: 'notes', label: () => ctx.locale.t(namespace, 'notes'), store }, function Notes(p) {
        const t = ctx.locale.useT(namespace), text = p.useStore(state => state.text);
        const latest = p.useChat(state => state.messages.filter(message => message.role === 'assistant' && !message.streaming).at(-1)?.content ?? '');
        return React.createElement('section', { className: namespace + '-workbench' },
            React.createElement('textarea', { 'aria-label': t('notes'), value: text,
                onChange: /** @param {React.ChangeEvent<HTMLTextAreaElement>} event */ event => p.actions.edit(event.target.value) }),
            React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
                React.createElement('button', { type: 'button', disabled: !latest, onClick: () => p.actions.edit(latest) }, t('capture')),
                React.createElement('button', { type: 'button', disabled: !text.trim(), onClick: () => ctx.chat.fill(text) }, t('use'))));
    });
    ctx.commands.register({ id: 'openNotes', label: { zh: '打开工作台便签', en: 'Open Workbench Notes' } }, () => { ctx.dock.open('notes'); });
}
