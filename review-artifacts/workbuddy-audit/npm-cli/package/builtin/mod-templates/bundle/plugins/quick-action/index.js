import React from 'react';

export const inject = ['slots', 'chat'];

export function apply(ctx) {
    ctx.slots.register({ name: 'session.header.actions', id: 'workflow-history', label: 'Workflow history' }, props =>
        React.createElement('button', { type: 'button', disabled: !props.openHistory,
            onClick: props.openHistory, 'aria-label': 'Open workflow conversation history' }, 'History'));
    ctx.slots.register({ name: 'session.header.utilities', id: 'workflow-session', label: 'Workflow session' }, props =>
        React.createElement('span', { title: props.sessionId, 'aria-label': 'Workflow conversation' },
            props.switching ? 'Switching' : props.mainChatActive ? 'Main' : 'Agent'));
    ctx.slots.register({ name: 'settings.action', key: 'fileCheckpointingEnabled' }, props =>
        React.createElement('span', { role: 'status', title: `Native ${props.scope} checkpoint setting` },
            props.value ? 'Checkpoints on' : 'Checkpoints off'));
    ctx.slots.register({ name: 'plugins.page', id: 'workflow-guide', label: 'Workflow guide' }, props =>
        React.createElement('p', { role: 'status' },
            `Workflow: ${props.enabledCount} of ${props.installedCount} installed plugins enabled. Use native controls below to manage them.`));
    ctx.slots.register({ name: 'chat.composer.before', id: 'review-draft', label: 'Review' }, () =>
        React.createElement('button', {
            type: 'button',
            onClick: () => ctx.chat.fill('Review the current changes and report concrete risks and missing tests.'),
        }, 'Review changes'));
}
