import { hpFor } from './physics.js';

// The page is the level. Whole UI blocks (messages, the input box, cards, buttons) are one-way platforms and
// breakable targets. Every effect is presentation-only (inline transform/filter/clip-path/visibility, all restored
// on exit): no element is removed, no handler or business state is touched.

/** Named host surfaces first, so a message or the composer is hit as one block instead of its inner text. */
const BLOCKS = [
    { selector: '[data-mod-surface="composer"]', kind: 'composer', hp: 6 },
    { selector: '[data-mod-surface="assistant-message"]', kind: 'message', hp: 4 },
    { selector: '[data-mod-surface="user-message"]', kind: 'message', hp: 3 },
    { selector: '[data-mod-surface="tool-summary"]', kind: 'card', hp: 2 },
    { selector: '.cw-row, .cw-slot, .cw-cap', kind: 'card' },
    { selector: '[data-mod-surface="sidebar-agents"] button, [data-mod-surface="sidebar-rail"] button', kind: 'button' },
    { selector: 'button, a[href], [role="button"], [role="tab"], img, svg, input, select, h1, h2, h3, pre, table, .rounded-lg, .rounded-xl', kind: 'thing' },
];
const ROOT_ATTR = 'data-brawler';
const MAX_TARGETS = 600;
const SAVED = ['transform', 'transformOrigin', 'filter', 'visibility', 'transition', 'clipPath', 'willChange'];

export class World {
    constructor(win) {
        this.win = win; this.doc = win.document; this.ids = new WeakMap(); this.nextId = 1;
        this.state = new Map(); this.broken = new Set(); this.targets = []; this.platforms = [];
    }
    id(element) { let id = this.ids.get(element); if (!id) { id = this.nextId++; this.ids.set(element, id); } return id; }

    scan() {
        const width = this.win.innerWidth; const height = this.win.innerHeight;
        const claimed = []; const targets = [];
        for (const block of BLOCKS) {
            for (const element of this.doc.querySelectorAll(block.selector)) {
                if (targets.length >= MAX_TARGETS) { break; }
                if (element.closest(`[${ROOT_ATTR}]`) || this.isBroken(element)) { continue; }
                // Inside an already claimed block: the block is the unit, its children are not separate targets.
                if (claimed.some(owner => owner !== element && owner.contains(element))) { continue; }
                const rect = this.restingRect(element);
                const w = rect.width; const h = rect.height;
                if (w < 14 || h < 10 || (block.kind === 'thing' && (w > width * 0.6 || h > height * 0.5))) { continue; }
                if (rect.bottom < 0 || rect.top > height || rect.right < 0 || rect.left > width) { continue; }
                const style = this.win.getComputedStyle(element);
                if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.05) { continue; }
                claimed.push(element);
                targets.push({ id: this.id(element), element, kind: block.kind, maxHp: block.hp,
                    left: rect.left, right: rect.right, top: Math.max(rect.top, 0), bottom: rect.bottom, area: w * h });
            }
        }
        this.targets = targets;
        // Platforms: only tops wide enough to stand on, and only while that top is on screen.
        this.platforms = targets.filter(target => target.right - target.left >= 28 && target.top > 4)
            .map(({ id, left, right, top, kind }) => ({ id, left, right, top, kind }));
        return targets;
    }
    /** Layout box without our own transient offsets, so shaking targets do not jitter the level geometry. */
    restingRect(element) {
        const entry = this.state.get(element);
        const rect = element.getBoundingClientRect();
        if (!entry || (!entry.ox && !entry.oy)) { return rect; }
        return { left: rect.left - entry.ox, right: rect.right - entry.ox, top: rect.top - entry.oy, bottom: rect.bottom - entry.oy,
            width: rect.width, height: rect.height };
    }
    isBroken(element) { for (const broken of this.broken) { if (broken === element || broken.contains(element)) { return true; } } return false; }
    target(id) { return this.targets.find(target => target.id === id); }

    entry(target) {
        const element = target.element;
        let entry = this.state.get(element);
        if (!entry) {
            const max = target.maxHp ?? hpFor(target.area);
            entry = { hp: max, max, original: Object.fromEntries(SAVED.map(key => [key, element.style[key]])),
                dx: 0, dy: 0, vx: 0, vy: 0, sq: 0, vsq: 0, rot: 0, vrot: 0, flashUntil: 0, crack: 0, w: target.right - target.left,
                shakeAt: -1, shakeAmp: 0, shakeDir: 1 };
            this.state.set(element, entry);
            element.style.willChange = 'transform, filter';
            element.style.transition = 'none';
        }
        return entry;
    }

    /** Contact feedback without damage: landing, head bumps, dash shoves. Velocities are px/s; heavy blocks move less. */
    nudge(target, { vx = 0, vy = 0, squash = 0, spin = 0 }) {
        const entry = this.entry(target);
        const mass = Math.min(3, Math.max(0.6, Math.sqrt(target.area) / 160));
        entry.vx += vx / mass; entry.vy += vy / mass; entry.vsq += squash / mass; entry.vrot += spin / mass;
    }

    /** @returns {{ broke: boolean, ratio: number, colors: string[] }} */
    damage(target, amount, facing, now, power = 1, at = null) {
        const entry = this.entry(target);
        // Remember where it was struck (relative to the block) so cracks radiate from real impact points.
        if (at) { entry.hits = [...(entry.hits ?? []), { x: at.x - target.left, y: at.y - target.top, seed: (entry.hits?.length ?? 0) + 1 }].slice(-6); }
        entry.hp = Math.max(0, entry.hp - amount); entry.flashUntil = now + 0.06;
        // Hit shake: a fast decaying vibration along the blow, the fighting-game 'impact tremor'.
        entry.shakeAt = now; entry.shakeAmp = Math.min(14, 6 * power + entry.shakeAmp * 0.5); entry.shakeDir = facing;
        entry.crack = 1 - entry.hp / entry.max;
        this.nudge(target, { vx: facing * 900 * power, vy: -260 * power, squash: 5 * power, spin: facing * 9 * power });
        const colors = this.colors(target.element);
        if (entry.hp > 0) { return { broke: false, ratio: entry.hp / entry.max, colors }; }
        const element = target.element;
        element.style.visibility = 'hidden';
        element.style.transform = entry.original.transform; element.style.filter = entry.original.filter; element.style.clipPath = entry.original.clipPath;
        this.broken.add(element);
        return { broke: true, ratio: 0, colors };
    }

    /** Per-frame springs: every hit or contact decays back to rest with a little overshoot. */
    animate(now, dt) {
        const k = 520, damp = 15;
        for (const [element, entry] of this.state) {
            if (this.broken.has(element)) { continue; }
            entry.vx += (-k * entry.dx - damp * entry.vx) * dt; entry.dx += entry.vx * dt;
            entry.vy += (-k * entry.dy - damp * entry.vy) * dt; entry.dy += entry.vy * dt;
            entry.vsq += (-k * entry.sq - damp * entry.vsq) * dt; entry.sq += entry.vsq * dt;
            entry.vrot += (-k * entry.rot - damp * entry.vrot) * dt; entry.rot += entry.vrot * dt;
            const age = now - entry.shakeAt; const tremor = age >= 0 && age < 0.3 ? entry.shakeAmp * Math.exp(-age * 14) : 0;
            const jx = tremor * Math.sin(age * 160) * entry.shakeDir, jy = tremor * 0.45 * Math.cos(age * 190);
            const dx = clampAbs(entry.dx, 70) + jx, dy = clampAbs(entry.dy, 56) + jy, sq = clampAbs(entry.sq, 0.32), rot = clampAbs(entry.rot, 7) + tremor * 0.12 * Math.sin(age * 130);
            // Big blocks barely tilt; small ones flip around.
            const tilt = rot * Math.min(1, 220 / Math.max(entry.w, 1));
            entry.ox = dx; entry.oy = dy;
            element.style.transformOrigin = '50% 100%';
            element.style.transform = `${entry.original.transform || ''} translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) rotate(${tilt.toFixed(2)}deg) scale(${(1 + sq * 0.5).toFixed(3)}, ${(1 - sq).toFixed(3)})`.trim();
            const crack = entry.crack;
            element.style.filter = entry.flashUntil > now ? 'brightness(2.6) saturate(0) contrast(1.2)'
                : crack > 0 ? `saturate(${(1 - crack * 0.7).toFixed(2)}) contrast(${(1 + crack * 0.3).toFixed(2)}) brightness(${(1 - crack * 0.12).toFixed(2)})` : entry.original.filter;
            // A badly cracked block starts losing its edges: a jagged clip that bites deeper with damage.
            element.style.clipPath = crack > 0.45 ? jagged(this.id(element), crack) : entry.original.clipPath;
        }
    }
    cracks() {
        const result = [];
        for (const target of this.targets) {
            const entry = this.state.get(target.element);
            if (entry && entry.hp > 0 && entry.hp < entry.max) { result.push({ target, ratio: entry.hp / entry.max, dx: entry.ox ?? 0, dy: entry.oy ?? 0, hits: entry.hits ?? [] }); }
        }
        return result;
    }
    colors(element) {
        const style = this.win.getComputedStyle(element);
        const colors = [style.backgroundColor, style.color, style.borderTopColor].filter(color => color && !/rgba\(0, 0, 0, 0\)|transparent/.test(color));
        return colors.length ? [...colors, '#ffffff'] : ['#00bc90', '#6ff5cf', '#ffffff'];
    }
    get brokenCount() { return this.broken.size; }
    restore() {
        for (const [element, entry] of this.state) { for (const key of SAVED) { element.style[key] = entry.original[key]; } }
        this.state.clear(); this.broken.clear();
    }
}

function clampAbs(value, max) { return Math.max(-max, Math.min(max, value)); }
/** Deterministic per-element jagged polygon: chips bite deeper into the edges as damage grows. */
function jagged(seed, crack) {
    const depth = (crack - 0.45) * 22; const points = [];
    const rnd = i => { const x = Math.sin(seed * 97.13 + i * 13.7) * 43758.5453; return x - Math.floor(x); };
    for (let i = 0; i <= 10; i++) { points.push(`${i * 10}% ${(rnd(i) * depth).toFixed(1)}%`); }
    for (let i = 0; i <= 6; i++) { points.push(`${(100 - rnd(i + 20) * depth * 0.6).toFixed(1)}% ${(i * 16.6).toFixed(1)}%`); }
    for (let i = 10; i >= 0; i--) { points.push(`${i * 10}% ${(100 - rnd(i + 40) * depth).toFixed(1)}%`); }
    for (let i = 6; i >= 0; i--) { points.push(`${(rnd(i + 60) * depth * 0.6).toFixed(1)}% ${(i * 16.6).toFixed(1)}%`); }
    return `polygon(${points.join(', ')})`;
}
export { ROOT_ATTR };
