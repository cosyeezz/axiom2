// 8-bit sounds synthesized with WebAudio: no assets, created lazily after the long-press user gesture.
export class Chiptune {
    constructor(win) { this.win = win; this.ctx = null; this.muted = false; this.noise = null; }
    ensure() {
        if (this.ctx || this.muted) { return this.ctx; }
        const Context = this.win.AudioContext || this.win.webkitAudioContext;
        if (!Context) { return null; }
        this.ctx = new Context();
        const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.5, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) { data[i] = Math.random() * 2 - 1; }
        this.noise = buffer;
        this.master = this.ctx.createGain(); this.master.gain.value = 0.22; this.master.connect(this.ctx.destination);
        return this.ctx;
    }
    toggle() { this.muted = !this.muted; if (this.master) { this.master.gain.value = this.muted ? 0 : 0.22; } return this.muted; }
    tone(type, from, to, duration, volume = 0.6, delay = 0) {
        const ctx = this.ensure(); if (!ctx || this.muted) { return; }
        const at = ctx.currentTime + delay;
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = type; osc.frequency.setValueAtTime(from, at); osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + duration);
        gain.gain.setValueAtTime(volume, at); gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
        osc.connect(gain); gain.connect(this.master); osc.start(at); osc.stop(at + duration + 0.02);
    }
    burst(duration, volume, cutoff, delay = 0) {
        const ctx = this.ensure(); if (!ctx || this.muted) { return; }
        const at = ctx.currentTime + delay;
        const source = ctx.createBufferSource(); source.buffer = this.noise;
        const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.setValueAtTime(cutoff, at);
        filter.frequency.exponentialRampToValueAtTime(120, at + duration);
        const gain = ctx.createGain(); gain.gain.setValueAtTime(volume, at); gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
        source.connect(filter); filter.connect(gain); gain.connect(this.master); source.start(at); source.stop(at + duration + 0.02);
    }
    summon() { [523, 659, 784, 1047].forEach((f, i) => this.tone('square', f, f * 1.01, 0.09, 0.35, i * 0.07)); }
    jump(air) { this.tone('square', air ? 520 : 360, air ? 1100 : 820, 0.12, 0.3); }
    dash() { this.burst(0.14, 0.4, 5000); this.tone('sawtooth', 900, 200, 0.12, 0.15); }
    swing() { this.burst(0.07, 0.25, 9000); }
    hit(power = 1) { this.burst(0.09, 0.9, 3200); this.tone('square', 180 * power, 60, 0.12, 0.55); }
    crush() { this.burst(0.45, 1, 2400); this.tone('sawtooth', 220, 40, 0.4, 0.5); this.tone('square', 880, 1760, 0.08, 0.25, 0.05); }
    land() { this.burst(0.06, 0.25, 900); }
    pound() { this.burst(0.5, 1, 1600); this.tone('sine', 120, 30, 0.45, 0.9); }
    combo(n) { const f = 660 + Math.min(n, 20) * 45; this.tone('square', f, f * 1.5, 0.08, 0.2); }
    close() { this.ctx?.close().catch(() => undefined); this.ctx = null; }
}
