// Canvas-only juice: every primitive snaps to the pixel grid so the page reads as one pixel-art world.

const snap = (value, px) => Math.round(value / px) * px;
const rand = (min, max) => min + Math.random() * (max - min);

export class Effects {
    constructor(px = 3) {
        this.px = px; this.particles = []; this.texts = []; this.slashes = []; this.rings = []; this.flash = 0; this.flashColor = '#ffffff';
    }
    /** Hit sparks: bright, fast, short-lived. */
    sparks(x, y, facing, color = '#fff6c2', count = 14) {
        for (let i = 0; i < count; i++) {
            const angle = (facing > 0 ? 0 : Math.PI) + rand(-0.9, 0.9);
            const speed = rand(260, 720);
            this.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 120, life: rand(0.12, 0.3), age: 0,
                size: this.px * (Math.random() < 0.3 ? 2 : 1), color: Math.random() < 0.5 ? color : '#ffffff', gravity: 900, bounce: false });
        }
    }
    /** Shatter an element's rectangle into chunky debris tinted with its own colors. */
    shatter(rect, colors, intensity = 1) {
        const area = (rect.right - rect.left) * (rect.bottom - rect.top);
        const count = Math.min(90, Math.max(18, Math.round(Math.sqrt(area) * 0.9 * intensity)));
        const cx = (rect.left + rect.right) / 2;
        for (let i = 0; i < count; i++) {
            const x = rand(rect.left, rect.right); const y = rand(rect.top, rect.bottom);
            const away = Math.sign(x - cx) || (Math.random() < 0.5 ? -1 : 1);
            this.particles.push({ x, y, vx: away * rand(80, 520), vy: rand(-760, -160), life: rand(0.9, 1.8), age: 0,
                size: this.px * Math.ceil(rand(1, 3.4)), color: colors[i % colors.length], gravity: 2200, bounce: true, spin: rand(-12, 12) });
        }
        this.ring((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2, Math.min(220, Math.max(60, Math.sqrt(area))), '#ffffff');
    }
    dust(x, y, count = 10, color = '#c8f7ea') {
        for (let i = 0; i < count; i++) {
            const side = i % 2 ? 1 : -1;
            this.particles.push({ x, y, vx: side * rand(60, 320), vy: rand(-180, -30), life: rand(0.25, 0.5), age: 0,
                size: this.px, color, gravity: 500, bounce: false });
        }
    }
    slash(x, y, facing, kind) { this.slashes.push({ x, y, facing, kind, age: 0, life: kind === 'uppercut' ? 0.2 : 0.14 }); }
    ring(x, y, radius, color = '#6ff5cf') { this.rings.push({ x, y, radius, color, age: 0, life: 0.32 }); }
    /** A keyed label replaces the previous one for the same target, so combo counters never stack on top of each other. */
    text(x, y, value, color = '#ffd166', size = 18, key) {
        if (key) { this.texts = this.texts.filter(text => text.key !== key); }
        // Unkeyed labels step up out of each other's way.
        const crowd = this.texts.filter(text => Math.abs(text.x - x) < 120 && Math.abs(text.y - y) < 28).length;
        this.texts.push({ x, y: y - crowd * 30, value, color, size, age: 0, life: 0.9, vy: -90, key });
    }
    screenFlash(strength = 0.6, color = '#ffffff') { this.flash = Math.max(this.flash, strength); this.flashColor = color; }

    update(dt, floor) {
        for (const p of this.particles) {
            p.age += dt; p.vy += p.gravity * dt; p.x += p.vx * dt; p.y += p.vy * dt;
            if (p.bounce && p.y + p.size >= floor) { p.y = floor - p.size; p.vy *= -0.38; p.vx *= 0.7; if (Math.abs(p.vy) < 60) { p.vy = 0; } }
        }
        this.particles = this.particles.filter(p => p.age < p.life);
        for (const t of this.texts) { t.age += dt; t.y += t.vy * dt; t.vy *= 0.92; }
        this.texts = this.texts.filter(t => t.age < t.life);
        for (const list of [this.slashes, this.rings]) { for (const item of list) { item.age += dt; } }
        this.slashes = this.slashes.filter(s => s.age < s.life);
        this.rings = this.rings.filter(r => r.age < r.life);
        this.flash = Math.max(0, this.flash - dt * 4);
    }

    draw(g, width, height) {
        const px = this.px;
        for (const ring of this.rings) {
            const k = ring.age / ring.life; const radius = ring.radius * (0.2 + 0.8 * easeOut(k));
            g.globalAlpha = 1 - k; g.fillStyle = ring.color;
            const steps = Math.max(24, Math.round(radius / 2));
            for (let i = 0; i < steps; i++) {
                const a = (i / steps) * Math.PI * 2;
                g.fillRect(snap(ring.x + Math.cos(a) * radius, px), snap(ring.y + Math.sin(a) * radius * 0.85, px), px * 2, px * 2);
            }
        }
        for (const slash of this.slashes) { drawSlash(g, slash, px); }
        for (const p of this.particles) {
            g.globalAlpha = Math.min(1, (p.life - p.age) / 0.25);
            g.fillStyle = p.color; g.fillRect(snap(p.x, px), snap(p.y, px), p.size, p.size);
        }
        g.globalAlpha = 1;
        for (const t of this.texts) {
            const k = t.age / t.life; const scale = k < 0.12 ? 1 + (0.12 - k) * 6 : 1;
            g.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
            g.font = `900 ${Math.round(t.size * scale)}px ui-monospace, 'SF Mono', Menlo, monospace`;
            g.textAlign = 'center'; g.lineWidth = 5; g.strokeStyle = '#06261f';
            g.strokeText(t.value, snap(t.x, px), snap(t.y, px)); g.fillStyle = t.color; g.fillText(t.value, snap(t.x, px), snap(t.y, px));
        }
        g.globalAlpha = 1;
        if (this.flash > 0) { g.globalAlpha = this.flash * 0.35; g.fillStyle = this.flashColor; g.fillRect(0, 0, width, height); g.globalAlpha = 1; }
    }
}

function drawSlash(g, slash, px) {
    const k = slash.age / slash.life;
    const up = slash.kind === 'uppercut';
    const radius = (up ? 58 : 50) + k * 14;
    const span = up ? [-2.6, -0.5] : [-1.15, 1.15];
    const base = slash.facing > 0 ? 0 : Math.PI;
    g.globalAlpha = 1 - k * 0.8;
    for (let i = 0; i <= 26; i++) {
        const u = i / 26;
        const angle = up ? span[0] + (span[1] - span[0]) * u : base + slash.facing * (span[0] + (span[1] - span[0]) * u);
        const thickness = Math.sin(u * Math.PI) * (up ? 18 : 14) * (1 - k * 0.5);
        for (let d = 0; d < thickness; d += px) {
            const r = radius - d;
            g.fillStyle = d < px * 2 ? '#ffffff' : d < px * 4 ? '#b8fff0' : '#00bc90';
            g.fillRect(snap(slash.x + Math.cos(angle) * r * (up ? slash.facing : 1), px), snap(slash.y + Math.sin(angle) * r, px), px, px);
        }
    }
    g.globalAlpha = 1;
}
function easeOut(t) { return 1 - (1 - t) ** 3; }
