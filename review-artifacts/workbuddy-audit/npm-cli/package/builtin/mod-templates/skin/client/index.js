import React from 'react';

export const inject = ['slots', 'theme', 'locale'];

const COLOR_TOKENS = [
    'bg-primary', 'bg-secondary', 'bg-tertiary', 'bg-input', 'bg-card', 'bg-user', 'bg-hover', 'bg-code', 'bg-hover-strong', 'bg-chip',
    'border-default', 'border-muted', 'border-input', 'border-field', 'border-field-focus', 'border-card',
    'text-primary', 'text-body', 'text-secondary', 'text-label', 'text-tertiary', 'text-user', 'text-link',
    'accent-brand', 'accent-brand-foreground', 'accent-blue', 'accent-green', 'accent-red', 'accent-yellow', 'accent-orange', 'accent-purple',
    'chat-body', 'chat-muted', 'chat-subtle', 'chat-thinking-line', 'chat-thinking-bg', 'chat-tool-hover',
    'focus-ring', 'disabled-text', 'disabled-bg', 'error-bg', 'warning-bg', 'success-bg', 'info-bg',
    'composer-border', 'composer-menu-active', 'composer-menu-current', 'composer-menu-active-border', 'composer-send', 'composer-send-hover',
    'bg-channel', 'border-channel', 'channel-accent', 'bg-diff-add', 'bg-diff-del', 'scrollbar', 'scrollbar-hover',
    'markdown-code', 'composer-glow', 'bot-avatar-outline', 'bot-avatar-shadow',
    'canvas-grid-minor', 'canvas-grid-major', 'canvas-tile-border', 'canvas-tile-border-selected', 'canvas-tile-header', 'canvas-tile-header-text',
    'canvas-selection-fill', 'canvas-selection-stroke',
    'login-bg', 'login-btn-bg', 'login-btn-text', 'login-text-primary', 'login-text-secondary', 'login-ellipse-border', 'login-ellipse-border2',
];

const PALETTE_DEFAULTS = {
    light: { background: '#f8fafc', secondary: '#eef2f7', card: '#ffffff', input: '#f1f5f9', user: '#e2e8f0', hover: '#e2e8f0', border: '#cbd5e1', text: '#0f172a', body: '#1e293b', muted: '#64748b', accent: '#2563eb', accentForeground: '#ffffff', blue: '#2563eb', green: '#15803d', red: '#b91c1c', yellow: '#a16207', orange: '#c2410c', purple: '#7e22ce' },
    dark: { background: '#0f172a', secondary: '#172033', card: '#1e293b', input: '#253247', user: '#334155', hover: '#334155', border: '#475569', text: '#f8fafc', body: '#e2e8f0', muted: '#94a3b8', accent: '#60a5fa', accentForeground: '#0f172a', blue: '#60a5fa', green: '#4ade80', red: '#f87171', yellow: '#facc15', orange: '#fb923c', purple: '#c084fc' },
};

const defaultColor = (token, mode) => {
    const palette = PALETTE_DEFAULTS[mode];
    if (token === 'bg-primary' || token === 'login-bg') return palette.background;
    if (token === 'bg-secondary' || token === 'bg-tertiary' || token === 'disabled-bg' || token === 'composer-menu-current' || token === 'canvas-tile-header') return palette.secondary;
    if (token === 'bg-card' || token === 'bg-channel' || token === 'canvas-tile-border') return palette.card;
    if (token === 'bg-input' || token === 'bg-code' || token === 'markdown-code') return palette.input;
    if (token === 'bg-user') return palette.user;
    if (token === 'bg-hover' || token === 'bg-hover-strong' || token === 'bg-chip' || token === 'chat-tool-hover') return palette.hover;
    if (token.startsWith('bg-')) return palette.secondary;
    if (token.startsWith('border-') || token === 'canvas-tile-border-selected' || token === 'composer-border') return palette.border;
    if (token === 'text-primary' || token === 'text-body' || token === 'chat-body' || token === 'login-text-primary' || token === 'canvas-tile-header-text') return palette.body;
    if (token === 'text-secondary' || token === 'text-label' || token === 'text-tertiary' || token === 'chat-muted' || token === 'chat-subtle' || token === 'disabled-text' || token === 'login-text-secondary') return palette.muted;
    if (token === 'text-user' || token === 'text-link') return palette.text;
    if (token === 'accent-brand' || token === 'channel-accent' || token === 'composer-send' || token === 'focus-ring' || token === 'composer-menu-active-border' || token === 'canvas-selection-stroke') return palette.accent;
    if (token === 'accent-brand-foreground' || token === 'login-btn-text') return palette.accentForeground;
    if (token === 'accent-blue' || token === 'info-bg') return palette.blue;
    if (token === 'accent-green' || token === 'success-bg') return palette.green;
    if (token === 'accent-red' || token === 'error-bg') return palette.red;
    if (token === 'accent-yellow' || token === 'warning-bg') return palette.yellow;
    if (token === 'accent-orange') return palette.orange;
    if (token === 'accent-purple') return palette.purple;
    if (token.startsWith('login-')) return palette.background;
    return palette.text;
};

const complete = (overrides, mode) => Object.fromEntries(COLOR_TOKENS.map(token => [token, overrides[token] || defaultColor(token, mode)]));
const makeSkin = (name, description, light, dark, tokens, radius, font) => ({
    name, description, light: complete(light, 'light'), dark: complete(dark, 'dark'), tokens, radius, font,
});

const THEMES = {
    engineering: makeSkin('Engineering Dark', 'Deep navy surfaces with teal focus states for long coding sessions.',
        { 'bg-primary': '#f8fafc', 'bg-secondary': '#eef2f7', 'bg-card': '#ffffff', 'text-primary': '#0f172a', 'text-body': '#1e293b', 'accent-brand': '#0f766e', 'accent-brand-foreground': '#ffffff', 'accent-blue': '#2563eb', 'focus-ring': '#14b8a6', 'composer-send': '#0f766e', 'composer-send-hover': '#115e59' },
        { 'bg-primary': '#0b1220', 'bg-secondary': '#111c2e', 'bg-card': '#132137', 'text-primary': '#f8fafc', 'text-body': '#e2e8f0', 'accent-brand': '#5eead4', 'accent-brand-foreground': '#06251f', 'accent-blue': '#60a5fa', 'focus-ring': '#99f6e4', 'composer-send': '#2dd4bf', 'composer-send-hover': '#5eead4' },
        { light: { '--skin-font': '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', '--skin-radius': '10px', '--shadow-composer': '0 8px 24px rgba(15, 23, 42, 0.12)', '--conversation-content-max-width': '960px', '--chat-flow-tool-gap': '8px' }, dark: { '--skin-font': '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', '--skin-radius': '10px', '--shadow-composer': '0 12px 32px rgba(0, 0, 0, 0.28)', '--conversation-content-max-width': '960px', '--chat-flow-tool-gap': '8px' } }, 10, 'system'),
    focus: makeSkin('Focus High Contrast', 'Crisp borders and a compact information density for review sessions.',
        { 'bg-primary': '#ffffff', 'bg-secondary': '#f1f5f9', 'bg-card': '#ffffff', 'text-primary': '#020617', 'text-body': '#0f172a', 'border-default': '#64748b', 'accent-brand': '#1d4ed8', 'accent-brand-foreground': '#ffffff', 'focus-ring': '#1d4ed8', 'composer-send': '#1d4ed8', 'composer-send-hover': '#1e40af' },
        { 'bg-primary': '#020617', 'bg-secondary': '#0f172a', 'bg-card': '#111827', 'text-primary': '#ffffff', 'text-body': '#f8fafc', 'border-default': '#64748b', 'accent-brand': '#93c5fd', 'accent-brand-foreground': '#0f172a', 'focus-ring': '#bfdbfe', 'composer-send': '#60a5fa', 'composer-send-hover': '#93c5fd' },
        { light: { '--skin-font': 'system-ui, sans-serif', '--skin-radius': '6px', '--shadow-composer': '0 4px 12px rgba(15, 23, 42, 0.16)', '--conversation-content-max-width': '900px', '--chat-flow-row-height': '30px' }, dark: { '--skin-font': 'system-ui, sans-serif', '--skin-radius': '6px', '--shadow-composer': '0 8px 20px rgba(0, 0, 0, 0.4)', '--conversation-content-max-width': '900px', '--chat-flow-row-height': '30px' } }, 6, 'mono'),
    soft: makeSkin('Soft Workbench', 'A warm rose workbench that keeps code surfaces calm while making active controls easy to find.',
        { 'bg-primary': '#fffaf5', 'bg-secondary': '#f7eee7', 'bg-card': '#fffdfb', 'bg-user': '#f9e5d9', 'text-primary': '#3b2f2a', 'text-body': '#4b3b34', 'text-secondary': '#765f53', 'accent-brand': '#c2415d', 'accent-brand-foreground': '#fff7f8', 'accent-blue': '#5f7fb7', 'composer-send': '#c2415d', 'composer-send-hover': '#9f304a', 'focus-ring': '#e8798d' },
        { 'bg-primary': '#211b22', 'bg-secondary': '#2c232b', 'bg-card': '#30252e', 'bg-user': '#4a2d37', 'text-primary': '#fff7f8', 'text-body': '#f2dfe3', 'text-secondary': '#cbb3b9', 'accent-brand': '#f3a1b1', 'accent-brand-foreground': '#3a1720', 'accent-blue': '#9ab5e5', 'composer-send': '#e98da1', 'composer-send-hover': '#f3a1b1', 'focus-ring': '#f3a1b1' },
        { light: { '--skin-font': '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', '--skin-radius': '12px', '--shadow-composer': '0 10px 28px rgba(104, 67, 52, 0.14)', '--conversation-content-max-width': '980px', '--conversation-bubble-radius': '14px' }, dark: { '--skin-font': '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', '--skin-radius': '12px', '--shadow-composer': '0 12px 30px rgba(0, 0, 0, 0.3)', '--conversation-content-max-width': '980px', '--conversation-bubble-radius': '14px' } }, 12, 'system'),
};

export function apply(ctx) {
    ctx.locale.register('__PLUGIN_NAME__', { en: { title: 'Appearance Studio', reset: 'Use native appearance' }, zh: { title: '高级外观', reset: '恢复原生外观' } });
    Object.entries(THEMES).forEach(([id, skin]) => ctx.theme.register(id, skin));
    const store = ctx.slots.defineStore({ init: () => ({ selected: null }), persist: 'appearance-selection', actions: { select(draft, id) { draft.selected = id; } } });
    styles.insert('.__PLUGIN_NAME__-skins{display:flex;flex-wrap:wrap;gap:8px;padding:12px;border:1px solid var(--color-border-muted);border-radius:var(--skin-radius);background:var(--color-bg-card)}.__PLUGIN_NAME__-skins h3{flex-basis:100%;margin:0;font-size:14px}.__PLUGIN_NAME__-skins button{border:1px solid var(--color-border-default);border-radius:var(--skin-radius);padding:6px 10px;background:var(--color-bg-input);color:var(--color-text-primary);cursor:pointer}.__PLUGIN_NAME__-skins button[aria-pressed=true]{border-color:var(--color-accent-brand);box-shadow:0 0 0 2px color-mix(in srgb,var(--color-accent-brand) 22%,transparent)}.__PLUGIN_NAME__-skins button:focus-visible{outline:2px solid var(--color-focus-ring);outline-offset:2px}');
    ctx.slots.register({ name: 'settings.after', id: '__PLUGIN_NAME__-appearance', order: 40, label: 'Appearance Studio', store }, function AppearancePicker(props) {
        const selected = props.useStore(state => state.selected);
        React.useEffect(() => { ctx.theme.select(selected || null); }, [selected]);
        const choose = id => { props.actions.select(id); ctx.theme.select(id); };
        return React.createElement('section', { className: '__PLUGIN_NAME__-skins', 'aria-label': 'Appearance Studio' },
            React.createElement('h3', null, ctx.locale.t('__PLUGIN_NAME__', 'title')),
            Object.entries(THEMES).map(([id, skin]) => React.createElement('button', { type: 'button', key: id, 'aria-pressed': selected === id, onClick: () => choose(id) }, skin.name)),
            React.createElement('button', { type: 'button', 'aria-pressed': selected === null, onClick: () => { props.actions.select(null); ctx.theme.select(null); } }, ctx.locale.t('__PLUGIN_NAME__', 'reset')));
    });
}
