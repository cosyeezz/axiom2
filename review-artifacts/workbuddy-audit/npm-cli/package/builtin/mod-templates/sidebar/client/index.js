import React from 'react';

export const inject = ['slots', 'locale'];
/** @param {import('@tencent-ai/codebuddy-code/mods/client').ModContext<['slots','locale']>} ctx */
export function apply(ctx) {
    const namespace = '__PLUGIN_NAME__';
    ctx.locale.register(namespace, { zh: { tasks: '任务中心', summarize: '总结当前会话', ready: '随时待命', running: '正在处理' },
        en: { tasks: 'Tasks', summarize: 'Summarize conversation', ready: 'Ready', running: 'Working' } });
    ctx.slots.register({ name: 'app.brand.name' }, () => 'CBC Studio');
    ctx.slots.register({ name: 'app.brand.mark' }, p => React.createElement('img', {
        src: p.defaultSource, alt: '', width: p.size, height: p.size, style: { objectFit: 'contain' },
    }));
    ctx.slots.register({ name: 'app.sidebar.item', key: 'tasks' }, p => {
        const t = ctx.locale.useT(namespace);
        return React.createElement('button', { type: 'button', className: 'dashboard-rail-btn' + (p.expanded ? ' expanded' : '') + (p.item.active ? ' active' : ''),
            'aria-label': t('tasks'), 'aria-current': p.item.active ? 'page' : undefined, title: t('tasks'), onClick: p.activate },
        React.createElement('span', { 'aria-hidden': true, style: { width: 20, height: 20, fontSize: 16, lineHeight: '20px' } }, '+'),
        p.expanded && React.createElement('span', { className: 'dashboard-rail-btn-label' }, t('tasks')));
    });
    ctx.slots.register({ name: 'app.sidebar.after', id: namespace + '-summary' }, p => {
        const t = ctx.locale.useT(namespace);
        const hasConversation = p.useChat(state => state.messages.some(message => message.role === 'assistant' && !message.streaming));
        return React.createElement('button', { type: 'button', className: 'dashboard-rail-btn' + (p.expanded ? ' expanded' : ''),
            'aria-label': t('summarize'), title: t('summarize'), disabled: !hasConversation,
            onClick: () => { p.chat.fill(t('summarize')); p.openAgents(); } },
        React.createElement('span', { 'aria-hidden': true, style: { width: 20, height: 20, fontSize: 16, lineHeight: '20px' } }, '='),
        p.expanded && React.createElement('span', { className: 'dashboard-rail-btn-label' }, t('summarize')));
    });
    ctx.slots.register({ name: 'app.sidebar.footer', id: namespace + '-status' }, p => {
        const t = ctx.locale.useT(namespace);
        const running = p.useRuntime(state => state.running);
        return React.createElement('div', { role: 'status', title: t(running ? 'running' : 'ready'),
            style: { display: 'flex', alignItems: 'center', justifyContent: p.expanded ? 'flex-start' : 'center', gap: 8,
                fontSize: 12, color: 'var(--color-text-secondary)', padding: '6px 8px' } },
        React.createElement('span', { 'aria-hidden': true, style: { width: 6, height: 6, flexShrink: 0, borderRadius: '50%',
            background: running ? 'var(--color-accent-blue)' : 'var(--color-accent-green)' } }),
        p.expanded && React.createElement('span', null, t(running ? 'running' : 'ready')));
    });
}
