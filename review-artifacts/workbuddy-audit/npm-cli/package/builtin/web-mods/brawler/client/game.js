import { Chiptune } from './audio.js';
import { Effects } from './effects.js';
import { attackHitbox, createPlayer, nextCombo, pickTargets, scoreHit, stepPlayer, TUNING } from './physics.js';
import { poseFor, rasterize } from './sprites.js';
import { World } from './world.js';

const PX = 4;                     // sprite pixel size: 14×16 art at 4px ≈ the 56×64 hitbox
const KEYS = {
    left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], jump: ['Space', 'ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'],
    attack: ['KeyJ', 'KeyX', 'KeyZ'], dash: ['KeyK', 'ShiftLeft', 'ShiftRight'], leap: ['KeyL', 'Tab'],
};
const GAME_KEYS = new Set([...Object.values(KEYS).flat(), 'KeyR', 'KeyM', 'Escape']);
const editable = element => !!element && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName));

/**
 * One summoned run. The level is the real page: blocks give way on every contact (land squash, head bump,
 * dash shove) and crack, chip and shatter under hits, with hit-stop, scene shake and slow motion for weight.
 */
export class Game {
    constructor(win, canvas, { spawn, breach, onExit, onHud }) {
        this.win = win; this.canvas = canvas; this.g = canvas.getContext('2d');
        this.world = new World(win); this.fx = new Effects(PX); this.audio = new Chiptune(win);
        this.onExit = onExit; this.onHud = onHud;
        this.player = createPlayer(spawn.x - TUNING.width / 2, spawn.y);
        // Burst out of the logo: thrown up and toward the conversation.
        this.player.vx = 520; this.player.vy = -980; this.player.leap = 0.5;
        this.held = new Set(); this.pressed = new Set(); this.mouseLeap = null;
        this.combo = 0; this.lastHitAt = -9; this.score = 0; this.best = 0;
        this.freeze = 0; this.slow = 0; this.shake = 0; this.shakeDir = { x: 0, y: 0 }; this.zoom = 0; this.hurtUntil = 0;
        this.scanAt = 0; this.clock = 0; this.running = true; this.squash = 0;
        this.onKeyDown = event => this.key(event, true); this.onKeyUp = event => this.key(event, false);
        this.onResize = () => this.resize();
        // Click anywhere on the page (outside inputs): the mascot leaps there. Total freedom of movement.
        this.onPointer = event => {
            if (event.button !== 0 || editable(event.target) || event.target.closest?.('[data-brawler-ui]')) { return; }
            event.preventDefault(); event.stopPropagation();
            const block = this.world.targets.filter(target => event.clientX >= target.left && event.clientX <= target.right
                && event.clientY >= target.top - 30 && event.clientY <= target.bottom).sort((a, b) => a.area - b.area)[0];
            this.mouseLeap = block ? { x: Math.min(Math.max(event.clientX, block.left + 30), block.right - 30), y: block.top } : { x: event.clientX, y: event.clientY };
        };
        win.addEventListener('keydown', this.onKeyDown, true); win.addEventListener('keyup', this.onKeyUp, true);
        win.addEventListener('pointerdown', this.onPointer, true);
        win.addEventListener('resize', this.onResize);
        if (editable(win.document.activeElement)) { win.document.activeElement.blur(); }
        this.resize(); this.world.scan();
        this.breachFx(breach ?? { x: spawn.x, y: spawn.y });
        this.last = win.performance.now();
        this.frame = win.requestAnimationFrame(now => this.tick(now));
        this.hud();
    }
    /** The logo cracks and the mascot breaks through the page surface. */
    breachFx(at) {
        this.fx.shatter({ left: at.x - 26, right: at.x + 26, top: at.y - 22, bottom: at.y + 18 }, ['#00bc90', '#6ff5cf', '#06261f', '#ffffff'], 1.4);
        this.fx.ring(at.x, at.y, 140, '#6ff5cf'); this.fx.ring(at.x, at.y, 70, '#ffffff');
        this.fx.sparks(at.x, at.y, 1, '#6ff5cf', 26); this.fx.sparks(at.x, at.y, -1, '#ffffff', 14);
        this.fx.text(at.x + 90, at.y + 60, 'BREAK OUT!', '#6ff5cf', 30);
        this.fx.screenFlash(0.7, '#6ff5cf'); this.freeze = 0.12; this.kick(18, 1, 0.6); this.zoom = 0.04;
        this.audio.summon(); this.audio.crush();
        for (const target of this.world.targets) {
            const cx = (target.left + target.right) / 2, cy = (target.top + target.bottom) / 2;
            const d = Math.hypot(cx - at.x, cy - at.y);
            if (d < 520) { this.world.nudge(target, { vx: (cx - at.x) / d * 700 * (1 - d / 520), vy: (cy - at.y) / d * 500 * (1 - d / 520), spin: 6 }); }
        }
    }
    key(event, down) {
        if (!GAME_KEYS.has(event.code) || editable(event.target)) { return; }
        event.preventDefault(); event.stopPropagation();
        if (down && !event.repeat) {
            this.pressed.add(event.code);
            if (event.code === 'Escape') { this.onExit(); return; }
            if (event.code === 'KeyR') { this.world.restore(); this.fx.text(this.player.x + 28, this.player.y - 16, 'RESTORED', '#6ff5cf'); this.world.scan(); this.audio.summon(); this.hud(); }
            if (event.code === 'KeyM') { const muted = this.audio.toggle(); this.fx.text(this.player.x + 28, this.player.y - 16, muted ? 'MUTE' : 'SOUND ON', '#ffffff', 14); }
        }
        if (down) { this.held.add(event.code); } else { this.held.delete(event.code); }
    }
    any(name, set = this.held) { return KEYS[name].some(code => set.has(code)); }
    resize() {
        const ratio = this.win.devicePixelRatio || 1;
        this.width = this.win.innerWidth; this.height = this.win.innerHeight;
        this.canvas.width = Math.round(this.width * ratio); this.canvas.height = Math.round(this.height * ratio);
        this.canvas.style.width = `${this.width}px`; this.canvas.style.height = `${this.height}px`;
        this.g.setTransform(ratio, 0, 0, ratio, 0, 0); this.g.imageSmoothingEnabled = false;
        this.ratio = ratio;
    }
    /** Directional camera kick: the whole app recoils away from the impact, then springs back. */
    kick(amount, dx = 0, dy = 1) { this.shake = Math.max(this.shake, amount); const n = Math.hypot(dx, dy) || 1; this.shakeDir = { x: dx / n, y: dy / n }; }

    /** Nearest block top in the facing direction (else anywhere): what L / Tab leaps to, so the chat is always reachable. */
    leapTarget() {
        const p = this.player; const cx = p.x + TUNING.width / 2, feet = p.y + TUNING.height;
        const candidates = this.world.platforms.filter(platform => platform.id !== p.standingOn && platform.right - platform.left >= 60
            && platform.top > 60 && platform.top < this.height - 30);
        const score = platform => {
            const tx = Math.min(Math.max(cx + p.facing * 220, platform.left + 30), platform.right - 30);
            const ahead = Math.sign(tx - cx) === p.facing ? 0 : 900;
            return Math.hypot(tx - cx, (platform.top - feet) * 1.3) + ahead + (platform.kind === 'message' || platform.kind === 'composer' ? -160 : 0);
        };
        const best = candidates.sort((a, b) => score(a) - score(b))[0];
        if (!best) { return null; }
        return { x: Math.min(Math.max(cx + p.facing * 220, best.left + 30), best.right - 30), y: best.top };
    }
    tick(now) {
        if (!this.running) { return; }
        const real = Math.min(0.05, (now - this.last) / 1000); this.last = now;
        this.clock += real;
        if (this.clock >= this.scanAt) { this.world.scan(); this.scanAt = this.clock + 0.3; }
        this.shake = Math.max(0, this.shake - real * 70); this.zoom = Math.max(0, this.zoom - real * 0.25);
        const scale = this.slow > 0 ? 0.25 : 1; this.slow = Math.max(0, this.slow - real);
        if (this.freeze > 0) { this.freeze -= real; } else { this.simulate(real * scale); }
        this.fx.update(real * scale, this.height);
        this.world.animate(this.clock, real * scale);
        this.render();
        this.pressed.clear();
        this.frame = this.win.requestAnimationFrame(next => this.tick(next));
    }
    simulate(dt) {
        const down = this.any('down');
        const leapKey = this.any('leap', this.pressed);
        const input = {
            left: this.any('left'), right: this.any('right'), jumpPressed: this.any('jump', this.pressed),
            attackPressed: this.any('attack', this.pressed), dashPressed: this.any('dash', this.pressed),
            poundPressed: down && this.any('down', this.pressed) && !this.player.grounded,
            dropPressed: down && this.any('down', this.pressed) && this.player.grounded,
            leapTo: this.mouseLeap ?? (leapKey ? this.leapTarget() : null),
        };
        this.mouseLeap = null;
        const before = this.player;
        // Keep clear of the native status bar so the mascot never hides behind chrome.
        const bounds = { left: 0, right: this.width, top: 58, bottom: this.height };
        const platforms = this.world.targets.map(({ id, left, right, top, bottom }) => ({ id, left, right, top, bottom }))
            .filter(platform => platform.right - platform.left >= 28 && platform.top > 4);
        const p = stepPlayer(before, input, platforms, dt, bounds);
        this.player = p;
        const cx = p.x + TUNING.width / 2, feet = p.y + TUNING.height;
        if (p.leapt) { this.audio.dash(); this.fx.dust(cx, feet, 12, '#ffffff'); this.fx.ring(cx, feet, 50, '#6ff5cf'); }
        if (p.jumped) {
            this.audio.jump(p.jumped === 'air'); this.fx.dust(cx, feet, p.jumped === 'air' ? 8 : 12);
            // Jumping pushes the block underfoot down: the page reacts to the push-off.
            const under = before.standingOn && this.world.target(before.standingOn);
            if (under) { this.world.nudge(under, { vy: 260, squash: 2.4 }); }
        }
        if (p.dash > 0 && !(before.dash > 0)) { this.audio.dash(); this.fx.dust(cx, feet - 8, 10, '#ffffff'); }
        // ── collisions: every contact moves the page ──
        if (p.landedOn) {
            const block = this.world.target(p.landedOn);
            const force = Math.min(1.6, Math.max(0.35, before.vy / 900));
            if (block) { this.world.nudge(block, { vy: 520 * force, squash: 4.5 * force, spin: (cx - (block.left + block.right) / 2) / 90 * force }); }
            this.squash = 0.35 * force; this.audio.land(); this.fx.dust(cx, feet, Math.round(10 + 10 * force));
            if (force > 1) { this.kick(5 * force, 0, 1); }
        } else if (p.landed > 700) { this.squash = 0.3; this.audio.land(); this.fx.dust(cx, feet, 10); }
        if (p.headHit) {
            const block = p.headHit === 'ceiling' ? null : this.world.target(p.headHit);
            if (block) { this.world.nudge(block, { vy: -620, squash: -3, spin: p.facing * 4 }); this.fx.sparks(cx, p.y, 0, '#ffffff', 8); }
            this.audio.hit(0.6); this.kick(5, 0, -1);
        }
        if (p.shoved) {
            const block = this.world.target(p.shoved);
            if (block) { this.world.nudge(block, { vx: p.facing * 1100, spin: p.facing * 7 }); this.fx.sparks(p.facing > 0 ? p.x + TUNING.width : p.x, p.y + 30, p.facing, '#ffffff', 10); }
            this.audio.hit(0.8); this.freeze = Math.max(this.freeze, 0.03); this.kick(7, p.facing, 0);
        }
        if (p.poundImpact) { this.impact(); }
        if (p.attack && (!before.attack || before.attack.index !== p.attack.index)) {
            this.audio.swing();
            this.fx.slash(cx + p.facing * 8, p.y + TUNING.height / 2, p.facing, ['slash', 'slash2', 'uppercut'][p.attack.index]);
            // Lunge into the swing so hits connect from slightly further away.
            this.player = { ...this.player, vx: this.player.vx + p.facing * 180 };
        }
        const box = attackHitbox(this.player);
        if (box && box.kind !== 'pound') {
            const struck = pickTargets(box, this.world.targets, this.player.attack.hits);
            // Standing on a block: the swing also stomps it, so you can smash the message you are standing on.
            const under = this.player.grounded && this.player.standingOn !== 'floor' && this.world.target(this.player.standingOn);
            if (under && !this.player.attack.hits.has(under.id) && !struck.includes(under)) { struck.push(under); }
            for (const target of struck) {
                this.player.attack.hits.add(target.id); this.hit(target, box.damage, this.player.facing, box.kind, target === under);
            }
        }
    }
    impact() {
        const p = this.player; const x = p.x + TUNING.width / 2; const y = p.y + TUNING.height;
        this.audio.pound(); this.fx.ring(x, y, 190, '#ffd166'); this.fx.ring(x, y, 110, '#ffffff'); this.fx.dust(x, y, 30, '#ffd166');
        this.kick(22, 0, 1); this.zoom = 0.03;
        const box = attackHitbox(p);
        for (const target of pickTargets(box, this.world.targets, new Set(), 4)) { this.hit(target, box.damage, Math.sign((target.left + target.right) / 2 - x) || 1, 'pound'); }
        // Shockwave: everything nearby jumps.
        for (const target of this.world.targets) {
            const cx = (target.left + target.right) / 2; const d = Math.abs(cx - x) + Math.max(0, target.top - y) * 0.5;
            if (d < 420 && Math.abs(target.top - y) < 300) { this.world.nudge(target, { vy: -380 * (1 - d / 420), squash: -2 * (1 - d / 420) }); }
        }
    }
    hit(target, damage, facing, kind, stomp = false) {
        const power = kind === 'uppercut' ? 1.5 : kind === 'pound' ? 1.8 : 1;
        const p = this.player;
        const contactX = stomp ? p.x + TUNING.width / 2 + facing * 14 : facing > 0 ? Math.max(target.left, p.x + TUNING.width) : Math.min(target.right, p.x);
        const contactY = stomp ? target.top + 4 : Math.max(target.top + 6, Math.min(target.bottom - 6, p.y + TUNING.height / 2));
        const result = this.world.damage(target, damage, facing, this.clock, power, { x: contactX, y: contactY });
        if (stomp && !result.broke) { this.world.nudge(target, { vy: 700 * power, squash: 4 * power }); }
        this.combo = nextCombo(this.combo, this.lastHitAt, this.clock); this.lastHitAt = this.clock;
        this.best = Math.max(this.best, this.combo); this.score += scoreHit(this.combo, result.broke);
        const cx = (target.left + target.right) / 2;
        this.fx.sparks(contactX, contactY, facing, result.colors[0], 18);
        this.fx.ring(contactX, contactY, 38 * power, '#ffffff');
        // Neighbours feel it too: the hit shoves blocks right next to the target.
        for (const other of this.world.targets) {
            if (other === target) { continue; }
            const gap = Math.max(other.left - target.right, target.left - other.right, other.top - target.bottom, target.top - other.bottom);
            if (gap < 24) { this.world.nudge(other, { vx: facing * 240 * power, vy: -80 * power, spin: facing * 2 }); }
        }
        if (this.combo >= 3) { this.audio.combo(this.combo); }
        if (result.broke) {
            const big = target.area > 40_000;
            this.audio.crush(); this.fx.shatter(target, result.colors, big ? 1.6 : 1.1);
            this.freeze = big ? 0.16 : 0.1; this.kick(big ? 26 : 14, facing, 0.4); this.zoom = big ? 0.05 : 0.02;
            this.fx.text(cx, target.top - 8, this.combo >= 5 ? `K.O. ×${this.combo}` : 'K.O.', '#ff4d6d', big ? 40 : 30, `t${target.id}`); this.fx.screenFlash(big ? 0.6 : 0.4);
            if (big) { this.slow = 0.35; }
            this.scanAt = 0;
        } else {
            this.audio.hit(power); this.freeze = 0.06 * power; this.kick(8 * power, facing, 0.2);
            this.fx.text(cx, target.top - 6, this.combo > 1 ? `${this.combo} HIT` : `-${damage}`, '#ffd166', this.combo > 4 ? 26 : 18, `t${target.id}`);
        }
        this.hud();
    }
    hud() { this.onHud({ combo: this.clock - this.lastHitAt <= 1.25 ? this.combo : 0, score: this.score, best: this.best, broken: this.world.brokenCount }); }
    render() {
        const g = this.g;
        g.clearRect(0, 0, this.width, this.height);
        const wobble = this.shake ? this.shake * (0.6 + 0.4 * Math.sin(this.clock * 90)) : 0;
        const sx = Math.round(this.shakeDir.x * wobble + (Math.random() - 0.5) * this.shake * 0.4);
        const sy = Math.round(this.shakeDir.y * wobble + (Math.random() - 0.5) * this.shake * 0.4);
        // The real app moves with the camera kick and punches in on big impacts.
        const app = this.win.document.querySelector('[data-mod-surface="app"]');
        if (app) {
            app.style.transformOrigin = `${this.player.x + TUNING.width / 2}px ${this.player.y + TUNING.height / 2}px`;
            app.style.transform = sx || sy || this.zoom ? `translate(${sx}px, ${sy}px) scale(${(1 + this.zoom).toFixed(3)})` : '';
        }
        g.save(); g.translate(sx, sy);
        for (const crack of this.world.cracks()) { drawCracks(g, crack); }
        const p = this.player;
        this.squash = Math.max(0, this.squash - 0.04);
        const stretch = !p.grounded && Math.abs(p.vy) > 700 ? 0.12 : 0;
        const sprite = rasterize(this.win.document, poseFor(p, this.hurtUntil), PX, p.facing);
        const sw = sprite.width * (1 + this.squash * 0.6 - stretch * 0.5), sh = sprite.height * (1 - this.squash + stretch);
        const left = Math.round(p.x + TUNING.width / 2 - sw / 2), top = Math.round(p.y + TUNING.height - sh);
        g.globalAlpha = 0.3; g.fillStyle = '#000'; g.fillRect(Math.round(p.x + 8), Math.round(p.y + TUNING.height - 2), TUNING.width - 16, 4); g.globalAlpha = 1;
        if (p.dash > 0 || p.leap > 0) {
            for (let i = 1; i <= 3; i++) { g.globalAlpha = 0.28 / i; g.drawImage(sprite, Math.round(left - p.vx * 0.012 * i), Math.round(top - p.vy * 0.012 * i), sw, sh); }
            g.globalAlpha = 1;
        }
        g.drawImage(sprite, left, top, sw, sh);
        this.fx.draw(g, this.width, this.height);
        g.restore();
        if (this.clock - this.lastHitAt > 1.25 && this.combo) { this.combo = 0; this.hud(); }
    }
    dispose() {
        this.running = false; this.win.cancelAnimationFrame(this.frame);
        this.win.removeEventListener('keydown', this.onKeyDown, true); this.win.removeEventListener('keyup', this.onKeyUp, true);
        this.win.removeEventListener('pointerdown', this.onPointer, true);
        this.win.removeEventListener('resize', this.onResize);
        const app = this.win.document.querySelector('[data-mod-surface="app"]'); if (app) { app.style.transform = ''; app.style.transformOrigin = ''; }
        this.world.restore(); this.audio.close();
    }
}

/** Jagged fracture lines radiating from each real impact point; they follow the block as it springs around. */
function drawCracks(g, { target, ratio, dx = 0, dy = 0, hits }) {
    const severity = 1 - ratio; const w = target.right - target.left; const h = target.bottom - target.top;
    const points = hits.length ? hits : [{ x: w / 2, y: h / 2, seed: 1 }];
    const rnd = (a, b) => { const v = Math.sin(target.id * 12.9898 + a * 78.233 + b * 37.719) * 43758.5453; return v - Math.floor(v); };
    g.save(); g.translate(target.left + dx, target.top + dy);
    g.beginPath(); g.rect(0, 0, w, h); g.clip();
    g.lineJoin = 'miter'; g.lineCap = 'square';
    for (const point of points) {
        const rays = 3 + Math.round(severity * 3);
        const reach = Math.min(Math.max(w, h) * 0.4, 28 + severity * 110);
        for (let r = 0; r < rays; r++) {
            let angle = (r / rays) * Math.PI * 2 + rnd(point.seed, r) * 0.8; let x = point.x, y = point.y;
            const path = [[x, y]];
            const steps = 3 + Math.round(severity * 3);
            for (let s = 0; s < steps; s++) {
                const len = reach / steps * (0.6 + rnd(r, s + point.seed) * 0.8);
                angle += (rnd(s, r * 3 + point.seed) - 0.5) * 0.9; x += Math.cos(angle) * len; y += Math.sin(angle) * len * 0.8;
                path.push([x, y]);
            }
            for (const [width, color, ox, oy] of [[2.4, 'rgba(255,255,255,0.7)', 1, 1], [1.4, `rgba(6,20,18,${(0.45 + severity * 0.4).toFixed(2)})`, 0, 0]]) {
                g.beginPath(); g.moveTo(path[0][0] + ox, path[0][1] + oy);
                for (const [px, py] of path.slice(1)) { g.lineTo(px + ox, py + oy); }
                g.lineWidth = width; g.strokeStyle = color; g.stroke();
            }
        }
        // Crushed spot at the impact point.
        g.fillStyle = 'rgba(6,20,18,0.4)'; g.beginPath(); g.arc(point.x, point.y, 3 + severity * 4, 0, Math.PI * 2); g.fill();
    }
    g.restore();
}
