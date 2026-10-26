import React from 'react';

export const inject = ['slots', 'chat', 'locale', 'layout'];
/** @param {import('@tencent-ai/codebuddy-code/mods/client').ModContext<['slots','chat','locale','layout']>} ctx */
export function apply(ctx) {
    const namespace = '__PLUGIN_NAME__';
    ctx.locale.register(namespace, { en: { notes: 'Notes', capture: 'Capture answer', use: 'Fill Chat', details: 'Open workspace' },
        zh: { notes: '便签', capture: '摘录回答', use: '填入聊天', details: '打开工作台' } });
    styles.insert('.__PLUGIN_NAME__-notes{font:inherit;color:var(--color-text-primary)}.__PLUGIN_NAME__-notes button,.__PLUGIN_NAME__-notes textarea{font:inherit;border:1px solid var(--color-border-default);border-radius:var(--skin-radius,6px)}.__PLUGIN_NAME__-notes button{padding:6px 10px;background:var(--color-bg-card);color:inherit;cursor:pointer}.__PLUGIN_NAME__-notes button:hover:not(:disabled){background:var(--color-bg-hover)}.__PLUGIN_NAME__-notes button:disabled{opacity:.45;cursor:default}.__PLUGIN_NAME__-notes :is(button,textarea):focus-visible{outline:2px solid var(--color-focus-ring);outline-offset:2px}');
    const store = ctx.slots.defineStore({ init: () => ({ text: '' }), persist: 'notes',
        actions: { edit(draft, /** @type {string} */ text) { draft.text = text; } } });
    ctx.slots.register({ name: 'chat.view', id: namespace + '-notes', label: () => ctx.locale.t(namespace, 'notes'), store }, function Notes(p) {
        const t = ctx.locale.useT(namespace), text = p.useStore(state => state.text);
        const latest = p.useChat(state => state.messages.filter(message => message.role === 'assistant' && !message.streaming).at(-1)?.content ?? '');
        return React.createElement('section', { className: namespace + '-notes', style: { display: 'flex', flexDirection: 'column', gap: 12, padding: 16, minWidth: 0, flex: 1 } },
            React.createElement('textarea', { 'aria-label': t('notes'), value: text,
                onChange: /** @param {React.ChangeEvent<HTMLTextAreaElement>} event */ event => p.actions.edit(event.target.value), style: { minHeight: 180, flex: 1, width: '100%', resize: 'vertical',
                    color: 'var(--color-text-primary)', background: 'var(--color-bg-input)', border: '1px solid var(--color-border-default)', padding: 12 } }),
            React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
                React.createElement('button', { type: 'button', disabled: !latest, onClick: () => p.actions.edit(latest) }, t('capture')),
                React.createElement('button', { type: 'button', disabled: !text.trim(), onClick: () => ctx.chat.fill(text) }, t('use')),
                React.createElement('button', { type: 'button', onClick: () => ctx.layout.setWorkspaceOpen(true) }, t('details'))));
    });
}
