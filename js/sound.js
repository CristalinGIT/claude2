// Синтезированные звуки (WebAudio) — никаких файлов, работает офлайн.
let ctx = null;
let master = null;
let noiseBuf = null;

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function noise(dur, freq, vol, q = 1) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur);
}

function tone(type, f0, f1, dur, vol) {
  const o = ctx.createOscillator();
  o.type = type;
  const g = ctx.createGain();
  const t = ctx.currentTime;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur);
}

export const sfx = {
  shot(near) { if (!ctx) return; noise(0.12, 2200, near ? 0.5 : 0.25); tone('square', 320, 90, 0.08, near ? 0.12 : 0.05); },
  bounce() { if (!ctx) return; tone('sine', 1400, 700, 0.07, 0.08); },
  hit() { if (!ctx) return; tone('square', 220, 70, 0.15, 0.18); noise(0.1, 1200, 0.3); },
  boom() { if (!ctx) return; noise(0.7, 500, 0.9, 0.7); tone('sine', 120, 30, 0.6, 0.5); },
  clash() { if (!ctx) return; tone('triangle', 900, 1800, 0.08, 0.12); },
  spawn() { if (!ctx) return; tone('sine', 300, 900, 0.18, 0.08); },
};
