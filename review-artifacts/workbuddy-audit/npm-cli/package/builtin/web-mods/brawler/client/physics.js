// Pure simulation core: no DOM access, so movement, landing and combat rules are unit-testable.

export const TUNING = Object.freeze({
    gravity: 2600, runSpeed: 400, accel: 4400, friction: 3600, jump: 1200, airJump: 1080, airJumps: 2, maxFall: 1500,
    dashSpeed: 1050, dashTime: 0.16, dashCooldown: 0.45, coyote: 0.09, jumpBuffer: 0.12,
    width: 56, height: 64, poundSpeed: 1800, leapCooldown: 0.5, leapTime: 0.55,
});
export const ATTACK_CHAIN = Object.freeze([
    { name: 'slash', duration: 0.2, active: [0.04, 0.13], reach: 84, height: 60, damage: 1, knock: 0.6 },
    { name: 'slash2', duration: 0.22, active: [0.04, 0.14], reach: 92, height: 66, damage: 1, knock: 0.8 },
    { name: 'uppercut', duration: 0.32, active: [0.05, 0.18], reach: 76, height: 100, damage: 2, knock: 1.4, lift: 820 },
]);
export const COMBO_WINDOW = 1.25;

export function createPlayer(x, y) {
    return { x, y, vx: 0, vy: 0, facing: 1, grounded: false, airJumps: TUNING.airJumps, coyote: 0, buffer: 0, dash: 0, dashCooldown: 0,
        attack: null, attackIndex: 0, attackQueued: false, pound: false, dropUntil: 0, landed: 0, time: 0, standingOn: null,
        leap: 0, leapCooldown: 0, landedOn: null, headHit: null, shoved: null };
}

/**
 * Ballistic velocity that lands on a point after `time` seconds under gravity: the homing leap toward a page block.
 */
export function leapVelocity(from, to, time = TUNING.leapTime) {
    return { vx: (to.x - from.x) / time, vy: (to.y - from.y) / time - 0.5 * TUNING.gravity * time };
}

/**
 * Platforms are one-way tops of page blocks: `{ id, left, right, top, bottom? }` in viewport pixels.
 * Reports contacts for feedback: `landedOn` (id, on the landing frame), `headHit` (id of a block whose underside the
 * head crossed while rising) and `shoved` (id of a block the dash ran into at body height).
 */
export function stepPlayer(player, input, platforms, dt, bounds) {
    const p = { ...player, time: player.time + dt, landed: 0, landedOn: null, headHit: null, shoved: null, leapt: false };
    p.dashCooldown = Math.max(0, p.dashCooldown - dt);
    p.leapCooldown = Math.max(0, (p.leapCooldown ?? 0) - dt);
    p.leap = Math.max(0, (p.leap ?? 0) - dt);
    p.coyote = p.grounded ? TUNING.coyote : Math.max(0, p.coyote - dt);
    p.buffer = input.jumpPressed ? TUNING.jumpBuffer : Math.max(0, p.buffer - dt);
    if (input.dropPressed && p.grounded && p.standingOn) { p.dropUntil = p.time + 0.22; p.grounded = false; }

    if (input.dashPressed && p.dashCooldown === 0 && !p.pound) {
        p.dash = TUNING.dashTime; p.dashCooldown = TUNING.dashCooldown; p.vy = Math.min(p.vy, 0);
    }
    if (input.leapTo && p.leapCooldown === 0 && !p.pound) {
        const velocity = leapVelocity({ x: p.x + TUNING.width / 2, y: p.y + TUNING.height }, input.leapTo);
        p.vx = velocity.vx; p.vy = velocity.vy; p.leap = TUNING.leapTime; p.leapCooldown = TUNING.leapCooldown;
        p.grounded = false; p.dash = 0; p.attack = null; p.facing = Math.sign(velocity.vx) || p.facing; p.leapt = true;
        p.dropUntil = 0;
    }
    const axis = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (axis && !(p.leap > 0)) { p.facing = axis; }
    if (p.leap > 0) {
        p.vy = Math.min(TUNING.maxFall * 2, p.vy + TUNING.gravity * dt);
    } else if (p.dash > 0) {
        p.dash = Math.max(0, p.dash - dt); p.vx = p.facing * TUNING.dashSpeed; p.vy = 0;
    } else {
        const target = axis * TUNING.runSpeed * (p.attack && p.grounded ? 0.35 : 1);
        const rate = axis ? TUNING.accel : TUNING.friction;
        p.vx = approach(p.vx, target, rate * dt);
        p.vy = Math.min(TUNING.maxFall, p.vy + TUNING.gravity * dt);
    }
    if (p.buffer > 0 && (p.grounded || p.coyote > 0)) {
        p.vy = -TUNING.jump; p.grounded = false; p.coyote = 0; p.buffer = 0; p.jumped = 'ground';
    } else if (input.jumpPressed && !p.grounded && p.airJumps > 0) {
        p.vy = -TUNING.airJump; p.airJumps -= 1; p.buffer = 0; p.jumped = 'air';
    } else { p.jumped = null; }
    if (input.poundPressed && !p.grounded && !p.pound) { p.pound = true; p.vx = 0; p.vy = TUNING.poundSpeed; p.attack = null; }

    const previousBottom = p.y + TUNING.height;
    const previousTop = p.y;
    p.x = clamp(p.x + p.vx * dt, bounds.left, bounds.right - TUNING.width);
    p.y += p.vy * dt;
    const bottom = p.y + TUNING.height;
    p.grounded = false; p.standingOn = null;
    if (bottom >= bounds.bottom) {
        p.y = bounds.bottom - TUNING.height; p.landed = p.vy; p.vy = 0; p.grounded = true; p.standingOn = 'floor';
    } else if (p.vy >= 0 && p.time >= p.dropUntil) {
        // Blocks move (they spring back after every hit), so keep standing on the same block while it is underfoot.
        const still = player.grounded && player.standingOn !== 'floor'
            && platforms.find(platform => platform.id === player.standingOn && p.x + TUNING.width - 8 > platform.left && p.x + 8 < platform.right
                && Math.abs(bottom - platform.top) < 28);
        const landing = still || findLanding(platforms, p.x + 8, p.x + TUNING.width - 8, previousBottom, bottom);
        if (landing) {
            p.y = landing.top - TUNING.height; p.landed = p.vy; p.vy = 0; p.grounded = true; p.standingOn = landing.id;
            if (player.standingOn !== landing.id || !player.grounded) { p.landedOn = landing.id; }
            p.leap = 0;
        }
    }
    if (p.vy < 0) {
        const head = findCeiling(platforms, p.x + 10, p.x + TUNING.width - 10, previousTop, p.y);
        // One-way blocks: rising through one bumps it (feedback) but never slows the jump.
        if (head) { p.headHit = head.id; }
    }
    if (p.dash > 0 && !player.shovedThisDash) {
        const front = p.facing > 0 ? p.x + TUNING.width : p.x;
        const hit = platforms.find(platform => platform.bottom !== undefined && front > platform.left && front < platform.right
            && p.y + TUNING.height * 0.7 > platform.top && p.y + TUNING.height * 0.3 < platform.bottom);
        if (hit) { p.shoved = hit.id; p.shovedThisDash = true; }
    }
    if (!(p.dash > 0)) { p.shovedThisDash = false; }
    if (p.y < bounds.top) { p.y = bounds.top; p.vy = Math.max(p.vy, 0); p.headHit = p.headHit ?? 'ceiling'; }
    if (p.grounded) { p.airJumps = TUNING.airJumps; if (p.pound) { p.pound = false; p.poundImpact = true; } else { p.poundImpact = false; } }
    else { p.poundImpact = false; }
    return stepAttack(p, input, dt);
}

function stepAttack(p, input, dt) {
    if (input.attackPressed && !p.pound) {
        if (!p.attack) { p.attack = { index: 0, t: 0, hits: new Set() }; }
        else { p.attackQueued = true; }
    }
    if (!p.attack) { return p; }
    const move = ATTACK_CHAIN[p.attack.index];
    const t = p.attack.t + dt;
    if (move.lift && t >= move.active[0] && p.attack.t < move.active[0]) { p.vy = -move.lift; p.grounded = false; }
    if (t < move.duration) { p.attack = { ...p.attack, t }; return p; }
    if (p.attackQueued && p.attack.index < ATTACK_CHAIN.length - 1) {
        p.attack = { index: p.attack.index + 1, t: 0, hits: new Set() }; p.attackQueued = false; return p;
    }
    p.attack = null; p.attackQueued = false;
    return p;
}

/** A block's underside crossed by the head while rising (platforms without `bottom` are ignored). */
export function findCeiling(platforms, left, right, previousTop, top) {
    let best = null;
    for (const platform of platforms) {
        if (platform.bottom === undefined || right <= platform.left || left >= platform.right) { continue; }
        if (previousTop >= platform.bottom - 1 && top <= platform.bottom && (!best || platform.bottom > best.bottom)) { best = platform; }
    }
    return best;
}

export function findLanding(platforms, left, right, previousBottom, bottom) {
    let best = null;
    for (const platform of platforms) {
        if (right <= platform.left || left >= platform.right) { continue; }
        if (previousBottom <= platform.top + 6 && bottom >= platform.top && (!best || platform.top < best.top)) { best = platform; }
    }
    return best;
}

/** Active hitbox of the current attack frame, or null outside its active window. */
export function attackHitbox(p) {
    if (p.poundImpact) { return { left: p.x - 70, right: p.x + TUNING.width + 70, top: p.y + TUNING.height - 12, bottom: p.y + TUNING.height + 34, damage: 3, kind: 'pound' }; }
    if (!p.attack) { return null; }
    const move = ATTACK_CHAIN[p.attack.index];
    if (p.attack.t < move.active[0] || p.attack.t > move.active[1]) { return null; }
    const centerY = p.y + TUNING.height / 2 - (move.name === 'uppercut' ? 24 : 0);
    const front = p.facing > 0 ? p.x + TUNING.width - 6 : p.x + 6 - move.reach;
    return { left: front, right: front + move.reach, top: centerY - move.height / 2, bottom: centerY + move.height / 2, damage: move.damage, kind: move.name };
}

/** Targets are `{ id, left, right, top, bottom, area }`; hit the most specific two so a slash feels precise. */
export function pickTargets(hitbox, targets, already = new Set(), limit = 2) {
    if (!hitbox) { return []; }
    return targets.filter(target => !already.has(target.id) && target.right > hitbox.left && target.left < hitbox.right
        && target.bottom > hitbox.top && target.top < hitbox.bottom)
        .sort((a, b) => a.area - b.area).slice(0, limit);
}

/** HP grows gently with element size so tiny icons pop in one hit and panels need a combo. */
export function hpFor(area) { return area < 2_500 ? 1 : area < 12_000 ? 2 : area < 60_000 ? 3 : area < 200_000 ? 4 : 6; }

export function scoreHit(combo, broke) { return (broke ? 100 : 10) * Math.max(1, Math.min(combo, 50)); }
export function nextCombo(combo, lastHitAt, now) { return now - lastHitAt <= COMBO_WINDOW ? combo + 1 : 1; }

function approach(value, target, delta) { return value < target ? Math.min(target, value + delta) : Math.max(target, value - delta); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
