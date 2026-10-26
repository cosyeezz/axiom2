// CodeBuddy mascot as 14x16 pixel art, derived from the brand mark: teal block head, two ears,
// white visor and two vertical eyes. Frames are composed from parts so states stay consistent.

export const PALETTE = Object.freeze({
    K: '#06261f', G: '#00bc90', D: '#00876a', L: '#6ff5cf', W: '#f2fffb', E: '#00bc90', R: '#ff4d6d', Y: '#ffd166', S: '#9fb3ad',
});
export const SPRITE_W = 14;
export const SPRITE_H = 16;

const HEAD = [
    '.KKK......KKK.',
    '.KLK......KLK.',
    '.KGKKKKKKKKGK.',
    'KKGLLGGGGGGGKK',
    'KDGWWWWWWWWGDK',
    'KDGWWWWWWWWGDK',
    'KDGWWWWWWWWGDK',
    'KDGWWWWWWWWGDK',
    'KDGWWWWWWWWGDK',
    '.KGGGGGGGGGGK.',
    '.KDDDDDDDDDDK.',
];
const EYES = {
    normal: [[5, 4], [6, 4], [7, 4], [5, 9], [6, 9], [7, 9]],
    blink: [[7, 4], [7, 5], [7, 8], [7, 9]],
    angry: [[5, 4], [6, 5], [7, 5], [5, 9], [6, 8], [7, 8]],
    hurt: [[5, 4], [7, 4], [6, 5], [5, 6], [7, 6], [5, 8], [7, 8], [6, 9], [5, 10], [7, 10]],
    happy: [[6, 4], [5, 5], [6, 6], [6, 7], [5, 8], [6, 9]],
};
const BODY = ['..KKGGGGGGKK..', '..KGGLLGGGGK..', '..KDGGGGGGDK..'];
const LEGS = {
    stand: ['..KKK....KKK..', '..KKK....KKK..'],
    runA: ['.KKK......KK..', '.KK.......KKK.'],
    runB: ['...KK....KKK..', '..KKK.....KK..'],
    jump: ['...KKK..KKK...', '..............'],
    pound: ['..KK......KK..', '.KK........KK.'],
};

/** @returns {string[]} 16 rows of palette keys */
export function frame({ eyes = 'normal', legs = 'stand' } = {}) {
    const rows = HEAD.map(row => row.split(''));
    for (const [y, x] of EYES[eyes] ?? EYES.normal) { rows[y][x] = eyes === 'hurt' ? 'R' : 'E'; }
    return [...rows.map(row => row.join('')), ...BODY, ...(LEGS[legs] ?? LEGS.stand)];
}

/** Chooses the art for a simulated player state. */
export function poseFor(player, hurtUntil = 0) {
    const t = player.time;
    if (hurtUntil > t) { return { eyes: 'hurt', legs: 'jump' }; }
    if (player.pound) { return { eyes: 'angry', legs: 'pound' }; }
    if (player.attack) { return { eyes: 'angry', legs: player.grounded ? 'stand' : 'jump' }; }
    if (!player.grounded) { return { eyes: 'normal', legs: 'jump' }; }
    if (Math.abs(player.vx) > 40) { return { eyes: 'normal', legs: Math.floor(t * 12) % 2 ? 'runA' : 'runB' }; }
    return { eyes: t % 3.2 > 3.05 ? 'blink' : 'normal', legs: 'stand' };
}

const cache = new Map();
/** Rasterizes a frame once per (pose, scale, facing) into an offscreen canvas with crisp pixels. */
export function rasterize(documentRef, pose, scale, facing) {
    const key = `${pose.eyes}:${pose.legs}:${scale}:${facing}`;
    if (cache.has(key)) { return cache.get(key); }
    const canvas = documentRef.createElement('canvas');
    canvas.width = SPRITE_W * scale; canvas.height = SPRITE_H * scale;
    const g = canvas.getContext('2d');
    frame(pose).forEach((row, y) => [...row].forEach((cell, x) => {
        if (cell === '.') { return; }
        g.fillStyle = PALETTE[cell];
        const column = facing < 0 ? SPRITE_W - 1 - x : x;
        g.fillRect(column * scale, y * scale, scale, scale);
    }));
    cache.set(key, canvas);
    return canvas;
}
