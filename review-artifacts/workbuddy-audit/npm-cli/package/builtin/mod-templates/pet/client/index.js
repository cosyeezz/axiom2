import React from 'react';

export const inject = ['slots', 'runtime', 'sessions'];

export function apply(ctx) {
    const statusText = state => {
        if (!state) return 'Waiting';
        if (state.connection !== 'connected' || state.binding === 'error') return 'Disconnected';
        if (state.pendingApproval) return 'Needs approval';
        const job = state.job;
        if (job && (job.state === 'failed' || job.status === 'failed')) return 'Failed';
        if (job && (job.state === 'done' || job.status === 'done')) return 'Complete';
        if (job && (job.state === 'stopped' || job.status === 'stopped')) return 'Paused';
        if (state.running && state.phase && /tool|command|terminal/i.test(state.phase)) return 'Using a tool';
        if (state.running) return 'Working';
        if (state.readOnly) return 'Waiting';
        return 'Ready';
    };
    const Pet = props => {
        const runtime = props.useRuntime(state => state);
        const [jobs, setJobs] = React.useState([]);
        const [error, setError] = React.useState('');
        const refresh = React.useCallback(() => {
            ctx.sessions.list({ all: true, limit: 8 }).then(page => setJobs(page.items || [])).catch(reason => setError(String(reason)));
        }, []);
        React.useEffect(() => { refresh(); return ctx.sessions.subscribe(() => refresh()); }, [refresh]);
        const current = jobs.find(job => job.sessionId === runtime.sessionId) || runtime.job;
        const label = statusText({ ...runtime, job: current });
        const open = () => runtime.sessionId ? ctx.sessions.open(runtime.sessionId, current && current.cwd).catch(reason => setError(String(reason))) : undefined;
        const resume = () => current && (current.state === 'failed' || current.state === 'stopped')
            ? ctx.sessions.resume({ jobId: current.id }).then(refresh).catch(reason => setError(String(reason))) : undefined;
        const tone = label === 'Failed' ? '#ef4444' : label === 'Needs approval' ? '#f59e0b' : label === 'Complete' ? '#22c55e' : '#60a5fa';
        return React.createElement('div', { className: 'workbench-pet', title: error || label },
            React.createElement('button', { type: 'button', 'aria-label': 'Open Workbench Pet status', onClick: open, className: 'workbench-pet__button' },
                React.createElement('span', { className: 'workbench-pet__orb', style: { '--pet-tone': tone } }, '●'),
                React.createElement('span', { className: 'workbench-pet__label' }, label)),
            current && (current.state === 'failed' || current.state === 'stopped')
                ? React.createElement('button', { type: 'button', className: 'workbench-pet__retry', onClick: resume }, 'Resume') : null,
            error ? React.createElement('span', { role: 'status', className: 'workbench-pet__error' }, 'Status unavailable') : null);
    };
    const Details = () => {
        const runtime = ctx.runtime.useRuntime(state => state);
        const [jobs, setJobs] = React.useState([]);
        React.useEffect(() => { const refresh = () => ctx.sessions.list({ all: true, limit: 5 }).then(page => setJobs(page.items || [])).catch(() => undefined); refresh(); return ctx.sessions.subscribe(refresh); }, []);
        return React.createElement('section', { className: 'workbench-pet-settings', 'aria-label': 'Workbench Pet details' },
            React.createElement('h3', null, 'Workbench Pet'), React.createElement('p', { role: 'status' }, statusText(runtime)),
            React.createElement('div', null, jobs.length ? jobs.map(job => React.createElement('button', { type: 'button', key: job.id, onClick: () => ctx.sessions.open(job.sessionId, job.cwd) }, job.name || job.intent || job.id))
                : React.createElement('span', null, 'No recent tasks')));
    };
    styles.insert('.workbench-pet{display:inline-flex;align-items:center;gap:4px;margin:0 4px;font:inherit}.workbench-pet__button,.workbench-pet__retry,.workbench-pet-settings button{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--color-border-muted);border-radius:999px;background:var(--color-bg-card);color:var(--color-text-primary);padding:3px 8px;cursor:pointer}.workbench-pet__button:hover,.workbench-pet__retry:hover,.workbench-pet-settings button:hover{border-color:var(--color-accent-brand)}.workbench-pet__orb{color:var(--pet-tone);font-size:11px;line-height:1}.workbench-pet__label{white-space:nowrap}.workbench-pet__retry{color:var(--color-accent-brand);font-size:11px}.workbench-pet__error{font-size:11px;color:var(--color-text-secondary)}.workbench-pet-settings{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--color-border-muted);border-radius:10px;background:var(--color-bg-card)}.workbench-pet-settings h3,.workbench-pet-settings p{margin:0}.workbench-pet-settings div{display:flex;flex-wrap:wrap;gap:6px}.workbench-pet-settings button{border-radius:6px;font-size:12px}@media (prefers-reduced-motion:reduce){.workbench-pet *{transition:none!important;animation:none!important}}');
    ctx.slots.register({ name: 'app.toolbar', id: 'workbench-pet', order: 30, label: 'Workbench Pet' }, Pet);
    ctx.slots.register({ name: 'settings.after', id: 'workbench-pet-settings', order: 30, label: 'Workbench Pet' }, Details);
}
