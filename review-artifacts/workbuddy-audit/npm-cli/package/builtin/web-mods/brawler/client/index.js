import React from 'react';

import { Game } from './game.js';
import { ROOT_ATTR } from './world.js';

const h = React.createElement;
const HOLD_MS = 650;

const CSS = `
.cbb-mark { position:relative; display:inline-grid; place-items:center; touch-action:none; -webkit-user-select:none; user-select:none; }
.cbb-mark img { display:block; transition:transform .12s; }
.cbb-mark[data-charging] img { transform:scale(.86); animation:cbb-buzz .07s steps(2) infinite; filter:drop-shadow(0 0 6px #6ff5cf); }
.cbb-mark[data-charging] .cbb-crack { opacity:1; }
.cbb-crack { position:absolute; inset:-4px; pointer-events:none; opacity:0; transition:opacity .1s; image-rendering:pixelated; }
.cbb-crack path { fill:none; stroke:#06261f; stroke-width:2; stroke-linecap:square; stroke-dasharray:60; stroke-dashoffset:60; }
.cbb-mark[data-charging] .cbb-crack path { stroke-dashoffset:0; transition:stroke-dashoffset ${HOLD_MS}ms steps(6); }
.cbb-mark[data-burst] img { visibility:hidden; }
.cbb-ring { position:absolute; inset:-6px; pointer-events:none; opacity:0; }
.cbb-mark[data-charging] .cbb-ring { opacity:1; }
.cbb-ring circle { fill:none; stroke:#00bc90; stroke-width:3; stroke-linecap:square; stroke-dasharray:113; stroke-dashoffset:113;
  transform:rotate(-90deg); transform-origin:50% 50%; filter:drop-shadow(0 0 4px #6ff5cf); }
.cbb-mark[data-charging] .cbb-ring circle { stroke-dashoffset:0; transition:stroke-dashoffset ${HOLD_MS}ms linear; }
@keyframes cbb-buzz { from { translate:-1px 0; } to { translate:1px 0; } }
.cbb-stage { position:fixed; inset:0; z-index:2147483000; pointer-events:none; }
.cbb-stage canvas { position:absolute; inset:0; image-rendering:pixelated; }
.cbb-hud { position:absolute; left:84px; bottom:78px; display:flex; flex-direction:column; gap:6px; align-items:flex-start; padding:10px 14px;
  font:900 13px/1 ui-monospace, 'SF Mono', Menlo, monospace; letter-spacing:1px; color:#f2fffb; background:#06261fd9;
  border:3px solid #00bc90; box-shadow:0 0 0 3px #06261f, 6px 6px 0 #0008; image-rendering:pixelated; }
.cbb-hud b { color:#6ff5cf; } .cbb-combo { color:#ffd166; min-width:90px; text-align:center; animation:cbb-pop .18s steps(3); }
@keyframes cbb-pop { from { scale:1.6; } to { scale:1; } }
.cbb-help { position:absolute; left:84px; bottom:184px; width:232px; padding:8px 12px; font:700 11px/1.6 ui-monospace, Menlo, monospace;
  color:#c8f7ea; background:#06261fe6; border:2px solid #00876a; animation:cbb-fade 1s 7s forwards; }
@keyframes cbb-fade { to { opacity:0; translate:0 6px; } }
`;

export const inject = ['slots', 'timer'];

export function apply(ctx) {
    styles.insert(CSS);
    let state = { active: false, spawn: null, breach: null, hud: { combo: 0, score: 0, best: 0, broken: 0 } };
    const listeners = new Set();
    const set = patch => { state = { ...state, ...patch }; for (const listener of listeners) { listener(); } };
    const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
    const useStore = selector => React.useSyncExternalStore(subscribe, () => selector(state));

    let burst = false;
    const summon = origin => {
        if (state.active) { return; }
        const brand = document.querySelector('[data-mod-surface="brand"]')?.getBoundingClientRect();
        const anchor = origin ?? brand ?? { left: 24, top: 24, bottom: 64, width: 28, height: 28 };
        const cx = anchor.left + (anchor.width ?? 28) / 2, cy = (anchor.top ?? anchor.bottom - 28) + (anchor.height ?? 28) / 2;
        burst = true;
        set({ active: true, spawn: { x: Math.max(30, cx), y: Math.max(8, cy - 40) }, breach: { x: cx, y: cy } });
    };
    const dismiss = () => { burst = false; set({ active: false, spawn: null, breach: null }); };

    // Keyboard fallback when the sidebar brand is collapsed or on narrow layouts: Ctrl+Shift+B toggles.
    ctx.effect(() => {
        const onKey = event => {
            if (event.ctrlKey && event.shiftKey && event.code === 'KeyB') { event.preventDefault(); state.active ? dismiss() : summon(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });

    function BrandMark({ size, defaultSource }) {
        const [charging, setCharging] = React.useState(false);
        const hold = React.useRef(null);
        const fired = React.useRef(false);
        const cancel = () => { hold.current?.(); hold.current = null; setCharging(false); };
        React.useEffect(() => cancel, []);
        const start = event => {
            if (event.button !== undefined && event.button !== 0) { return; }
            fired.current = false; setCharging(true);
            const rect = event.currentTarget.getBoundingClientRect();
            hold.current = ctx.timer.after(HOLD_MS, () => { hold.current = null; fired.current = true; setCharging(false); summon(rect); });
        };
        // A completed long press is not also a click on the native brand button.
        const swallow = event => { if (fired.current) { event.preventDefault(); event.stopPropagation(); fired.current = false; } };
        const active = useStore(value => value.active);
        return h('span', { className: 'cbb-mark', 'data-charging': charging ? '' : undefined, 'data-burst': active && burst ? '' : undefined, title: '长按唤醒 CodeBuddy',
            onPointerDown: start, onPointerUp: cancel, onPointerLeave: cancel, onPointerCancel: cancel, onClickCapture: swallow,
            onContextMenu: event => { if (charging || fired.current) { event.preventDefault(); } } },
        h('img', { src: defaultSource, width: size, height: size, alt: '', draggable: false }),
        h('svg', { className: 'cbb-ring', viewBox: '0 0 40 40', 'aria-hidden': true }, h('circle', { cx: 20, cy: 20, r: 18 })),
        h('svg', { className: 'cbb-crack', viewBox: '0 0 40 40', 'aria-hidden': true },
            h('path', { d: 'M20 4 L18 12 L23 17 L16 23 L21 30 L19 37' }), h('path', { d: 'M23 17 L31 15 L36 20' }), h('path', { d: 'M16 23 L8 26 L4 24' })));
    }

    function Stage() {
        const active = useStore(value => value.active);
        const spawn = useStore(value => value.spawn);
        const breach = useStore(value => value.breach);
        const hud = useStore(value => value.hud);
        const canvas = React.useRef(null);
        React.useEffect(() => {
            if (!active || !canvas.current) { return undefined; }
            const game = new Game(window, canvas.current, { spawn, breach, onExit: dismiss, onHud: value => set({ hud: value }) });
            return () => game.dispose();
        }, [active]);
        if (!active) { return null; }
        return h('div', { className: 'cbb-stage', [ROOT_ATTR]: '' },
            h('canvas', { ref: canvas }),
            h('div', { className: 'cbb-hud' }, h('span', null, 'CODEBUDDY ', h('b', null, 'BRAWLER')),
                h('span', null, 'SCORE ', h('b', null, String(hud.score).padStart(6, '0'))),
                h('span', { key: hud.combo, className: 'cbb-combo' }, hud.combo > 1 ? `${hud.combo} COMBO!` : ' '),
                h('span', null, 'K.O. ', h('b', null, hud.broken))),
            h('div', { className: 'cbb-help' }, '点击任意元素：跳上去', h('br'), 'J 连击（踩着也能打碎）· K 冲撞', h('br'), 'Space 三段跳 · 空中↓ 下砸', h('br'), 'L 跳到附近消息 · R 复原 · Esc 退出'));
    }

    ctx.slots.register({ name: 'app.brand.mark' }, BrandMark);
    ctx.slots.register({ name: 'app.overlay', id: 'brawler-stage' }, Stage);
}
