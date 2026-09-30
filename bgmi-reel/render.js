// BGMI tournament reel — procedural renderer.
// Usage: node render.js <startFrame> <endFrame> <out.mp4>   (segment render)
//        node render.js --still <t> <out.png>               (single frame preview)
const { createCanvas, GlobalFonts, Path2D } = require('@napi-rs/canvas');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { C, IMPACTS, SHOTS } = require('./cues');

for (const f of fs.readdirSync(path.join(__dirname, 'fonts'))) GlobalFonts.registerFromPath(path.join(__dirname, 'fonts', f));

const W = 1080, H = 1920, FPS = 30;
const COL = {
  ink: '#05070b', navy: '#0a0f18', amber: '#ffb31a', gold: '#ffd166', cyan: '#39e0ff',
  red: '#ff3b3b', green: '#35e08a', white: '#f4f6fa', dim: '#8a93a6',
};

// ---------------------------------------------------------------- utils
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const P = (t, a, b) => clamp((t - a) / (b - a));
const E = {
  outExpo: x => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  outCubic: x => 1 - Math.pow(1 - x, 3),
  outQuart: x => 1 - Math.pow(1 - x, 4),
  inCubic: x => x * x * x,
  inOutCubic: x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  inOutSine: x => -(Math.cos(Math.PI * x) - 1) / 2,
  outBack: (x, s = 1.70158) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2),
  inExpo: x => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
};
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const nz = (t, s = 0) => Math.sin(t * 1.7 + s) * 0.5 + Math.sin(t * 3.1 + s * 2.3) * 0.3 + Math.sin(t * 7.3 + s * 0.7) * 0.2;
const mk = (w, h) => { const c = createCanvas(w, h); return [c, c.getContext('2d')]; };
function rr(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function poly(c, pts) { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); }
// parallelogram (esports bar)
function para(c, x, y, w, h, sk = 0.25) { const s = h * sk; poly(c, [[x + s, y], [x + w + s, y], [x + w - s, y + h], [x - s, y + h]]); }

// ------------------------------------------------------------ text system
function font(size, weight = 700, fam = 'Teko') { return `${weight} ${size}px ${fam}`; }
function text(c, s, x, y, o = {}) {
  const { size = 100, weight = 700, fam = 'Teko', color = COL.white, align = 'center', alpha = 1, ls = 0, glow = 0, glowColor = null, base = 'middle', fillStyle = null } = o;
  if (alpha <= 0.001) return;
  c.save();
  c.globalAlpha *= alpha; c.font = font(size, weight, fam); c.textAlign = align; c.textBaseline = base;
  c.letterSpacing = ls + 'px';
  // Teko sits high in its em box — nudge optical centre down
  const dy = fam === 'Teko' && base === 'middle' ? size * 0.08 : 0;
  if (glow) { c.shadowColor = glowColor || color; c.shadowBlur = glow; }
  c.fillStyle = fillStyle || color; c.fillText(s, x, y + dy);
  c.restore();
}
function measure(c, s, size, weight = 700, fam = 'Teko', ls = 0) { c.save(); c.font = font(size, weight, fam); c.letterSpacing = ls + 'px'; const w = c.measureText(s).width; c.restore(); return w; }
// Slam-in: scale from big with a motion streak, exits by fading.
function slam(c, s, x, y, t, t0, o = {}) {
  if (t < t0) return 0;
  const { dur = 0.22, from = 1.9, t1 = 1e9, outDur = 0.18, streak = true } = o;
  const p = P(t, t0, t0 + dur), e = E.outExpo(p);
  const out = t > t1 ? E.inCubic(P(t, t1, t1 + outDur)) : 0;
  if (out >= 1) return 0;
  const sc = lerp(from, 1, e) * (1 + out * 0.15);
  const a = clamp((t - t0) / 0.04) * (1 - out);
  if (streak && p < 0.6) for (let i = 3; i >= 1; i--) {
    const k = sc * (1 + i * 0.06 * (1 - p));
    c.save(); c.translate(x, y); c.scale(k, k); text(c, s, 0, 0, { ...o, alpha: a * 0.16 * (1 - p), glow: 0 }); c.restore();
  }
  c.save(); c.translate(x, y); c.scale(sc, sc); text(c, s, 0, 0, { ...o, alpha: a * (o.alpha ?? 1) }); c.restore();
  return e * (1 - out);
}
// Masked wipe reveal (left→right), with a leading light bar
function wipe(c, s, x, y, t, t0, o = {}) {
  if (t < t0) return;
  const { dur = 0.32, t1 = 1e9, outDur = 0.15, barColor = COL.amber } = o;
  const w = measure(c, s, o.size || 100, o.weight || 700, o.fam || 'Teko', o.ls || 0) + 40;
  const h = (o.size || 100) * 1.3;
  const p = E.outQuart(P(t, t0, t0 + dur));
  const out = t > t1 ? E.inCubic(P(t, t1, t1 + outDur)) : 0;
  if (out >= 1) return;
  const x0 = o.align === 'left' ? x - 20 : x - w / 2;
  c.save(); c.beginPath(); c.rect(x0 + w * out, y - h / 2, w * (p - out), h); c.clip();
  text(c, s, x, y, o); c.restore();
  if (p < 1) { c.save(); c.fillStyle = barColor; c.globalAlpha = 1 - p; c.fillRect(x0 + w * p - 6, y - h / 2, 10, h); c.restore(); }
}
// Label bar: filled parallelogram with dark text
function labelBar(c, s, x, y, t, t0, o = {}) {
  if (t < t0) return;
  const { size = 54, bg = COL.amber, fg = COL.ink, t1 = 1e9, fam = 'Rajdhani', ls = 6, alpha = 1 } = o;
  const w = measure(c, s, size, 700, fam, ls) + size * 1.5, h = size * 1.35;
  const p = E.outExpo(P(t, t0, t0 + 0.3)), out = t > t1 ? E.inCubic(P(t, t1, t1 + 0.15)) : 0;
  if (out >= 1) return;
  c.save(); c.globalAlpha = alpha * (1 - out);
  c.beginPath(); c.rect(x - w / 2 - 40, y - h, (w + 80) * p, h * 2); c.clip();
  c.fillStyle = bg; para(c, x - w / 2, y - h / 2, w, h, 0.3); c.fill();
  text(c, s, x + ls / 2, y + 2, { size, fam, color: fg, ls });
  c.restore();
}
function brackets(c, x, y, w, h, len, lw, col, a = 1) {
  c.save(); c.globalAlpha *= a; c.strokeStyle = col; c.lineWidth = lw; c.lineCap = 'square';
  const L = len; c.beginPath();
  c.moveTo(x, y + L); c.lineTo(x, y); c.lineTo(x + L, y);
  c.moveTo(x + w - L, y); c.lineTo(x + w, y); c.lineTo(x + w, y + L);
  c.moveTo(x + w, y + h - L); c.lineTo(x + w, y + h); c.lineTo(x + w - L, y + h);
  c.moveTo(x + L, y + h); c.lineTo(x, y + h); c.lineTo(x, y + h - L);
  c.stroke(); c.restore();
}

// ------------------------------------------------------------ soldier art
// Local box 0..400 x 0..600, facing left, aiming rifle. Muzzle at (8,156).
function soldierShape(c) {
  c.lineCap = 'round'; c.lineJoin = 'round';
  const limb = (pts, w) => { c.lineWidth = w; c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke(); };
  limb([[224, 296], [256, 420], [270, 546]], 50);          // rear leg
  limb([[196, 296], [158, 418], [142, 546]], 52);          // front leg
  poly(c, [[108, 536], [170, 534], [176, 572], [104, 574]]); c.fill();  // boots
  poly(c, [[246, 538], [304, 542], [308, 574], [244, 574]]); c.fill();
  poly(c, [[168, 118], [240, 110], [262, 200], [252, 312], [184, 314], [170, 232], [156, 170]]); c.fill(); // torso
  rr(c, 236, 116, 74, 168, 24); c.fill();                  // backpack
  rr(c, 300, 130, 22, 120, 8); c.fill();                   // bedroll
  poly(c, [[154, 150], [182, 136], [186, 256], [158, 250]]); c.fill(); // chest rig
  rr(c, 186, 88, 34, 40, 10); c.fill();                    // neck
  c.beginPath(); c.ellipse(194, 76, 33, 36, 0, 0, Math.PI * 2); c.fill(); // head
  c.beginPath(); c.arc(204, 60, 47, Math.PI * 0.98, Math.PI * 2.02); c.fill(); // helmet dome
  c.beginPath(); c.ellipse(200, 64, 56, 12, 0, 0, Math.PI * 2); c.fill();      // brim
  rr(c, 226, 30, 16, 26, 5); c.fill();                     // helmet mount
  // rifle
  rr(c, 4, 151, 80, 9, 3); c.fill();                       // barrel
  rr(c, 0, 147, 14, 17, 3); c.fill();                      // muzzle brake
  rr(c, 70, 142, 118, 25, 6); c.fill();                    // handguard
  rr(c, 150, 136, 94, 34, 6); c.fill();                    // receiver
  poly(c, [[166, 166], [194, 166], [204, 226], [178, 230]]); c.fill(); // magazine
  poly(c, [[236, 140], [292, 150], [296, 190], [242, 178]]); c.fill(); // stock
  rr(c, 148, 118, 70, 18, 7); c.fill();                    // scope
  rr(c, 136, 114, 20, 26, 5); c.fill(); rr(c, 208, 116, 16, 22, 5); c.fill();
  // arms
  limb([[214, 136], [166, 196], [106, 166]], 32);
  limb([[232, 140], [252, 200], [206, 178]], 32);
  c.beginPath(); c.arc(106, 164, 17, 0, 7); c.fill(); c.beginPath(); c.arc(206, 178, 17, 0, 7); c.fill();
  // antenna
  c.lineWidth = 4; c.beginPath(); c.moveTo(300, 120); c.lineTo(330, 0); c.stroke();
}
const SS = 2.4, SW = Math.ceil(420 * SS), SH = Math.ceil(600 * SS);
function buildSoldier() {
  const [body, b] = mk(SW, SH); b.scale(SS, SS); b.fillStyle = '#07080b'; b.strokeStyle = '#07080b'; soldierShape(b);
  const [rim, r] = mk(SW, SH);
  r.scale(SS, SS); r.fillStyle = '#fff'; r.strokeStyle = '#fff'; soldierShape(r);
  r.setTransform(1, 0, 0, 1, 0, 0); r.globalCompositeOperation = 'destination-out';
  r.drawImage(body, 9, 5); // leaves an edge sliver on the upper-left (lit) side
  const tint = col => { const [cv, x] = mk(SW, SH); x.drawImage(rim, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = col; x.fillRect(0, 0, SW, SH); return cv; };
  return { body, rim: { amber: tint('#ffb45c'), cyan: tint('#7fe9ff'), white: tint('#ffffff'), red: tint('#ff5a4a') } };
}
// Gamer silhouette (head + headset + shoulders + phone) facing right, box 0..500x600
function gamerShape(c) {
  c.beginPath(); c.ellipse(230, 190, 95, 110, 0, 0, 7); c.fill();                 // head
  poly(c, [[60, 600], [90, 390], [180, 300], [290, 300], [390, 380], [440, 600]]); c.fill(); // shoulders
  rr(c, 200, 280, 70, 50, 20); c.fill();                                          // neck
  c.lineWidth = 22; c.beginPath(); c.arc(225, 185, 118, Math.PI * 1.05, Math.PI * 1.95); c.stroke(); // band
  rr(c, 96, 150, 44, 96, 18); c.fill(); rr(c, 312, 150, 40, 96, 18); c.fill();    // cups
  c.lineWidth = 10; c.beginPath(); c.moveTo(332, 230); c.quadraticCurveTo(360, 290, 310, 300); c.stroke(); // mic
  c.lineWidth = 58; c.lineCap = 'round'; c.beginPath(); c.moveTo(330, 440); c.lineTo(430, 520); c.lineTo(470, 430); c.stroke(); // arm
}
function buildGamer() {
  const [cv, g] = mk(520, 620); g.fillStyle = '#07080b'; g.strokeStyle = '#07080b'; gamerShape(g);
  const rim = col => { const [rc, r] = mk(520, 620); r.fillStyle = col; r.strokeStyle = col; gamerShape(r); r.globalCompositeOperation = 'destination-out'; r.drawImage(cv, -10, 6); return rc; };
  cv.rims = { [COL.cyan]: rim('#8af0ff'), [COL.amber]: rim('#ffc46b') }; return cv;
}

// ------------------------------------------------------------ world layers
const LW = 2200;
function ridge(c, seed, y0, amp, col, jag = 1) {
  const R = rng(seed); const ph = [R() * 9, R() * 9, R() * 9];
  c.fillStyle = col; c.beginPath(); c.moveTo(0, H);
  for (let x = 0; x <= LW; x += 8) {
    const y = y0 - amp * (0.55 * Math.sin(x * 0.0021 + ph[0]) + 0.3 * Math.sin(x * 0.0063 + ph[1]) + 0.15 * jag * Math.sin(x * 0.019 + ph[2]));
    c.lineTo(x, y);
  }
  c.lineTo(LW, H); c.closePath(); c.fill();
}
function buildLayers() {
  const [far, f] = mk(LW, H); ridge(f, 3, 1040, 90, '#2a2733'); ridge(f, 5, 1110, 60, '#221f2a');
  const [mid, m] = mk(LW, H); m.fillStyle = '#131219'; m.strokeStyle = '#131219';
  const base = 1165;
  // water tower
  m.lineWidth = 7; [[300, 0], [360, 0]].forEach(([x]) => { m.beginPath(); m.moveTo(x, base); m.lineTo(x + 10, base - 190); m.stroke(); });
  m.beginPath(); m.moveTo(300, base - 60); m.lineTo(370, base - 150); m.moveTo(370, base - 60); m.lineTo(300, base - 150); m.stroke();
  rr(m, 280, base - 260, 110, 80, 18); m.fill(); poly(m, [[280, base - 255], [335, base - 300], [390, base - 255]]); m.fill();
  // warehouse w/ sawtooth roof
  poly(m, [[520, base], [520, base - 120], [580, base - 160], [580, base - 120], [640, base - 160], [640, base - 120], [700, base - 160], [700, base - 120], [760, base - 160], [760, base - 120], [900, base - 120], [900, base]]); m.fill();
  // ruined block with windows (cut out)
  m.fillRect(1000, base - 240, 170, 240); poly(m, [[1000, base - 240], [1060, base - 280], [1110, base - 240]]); m.fill();
  m.globalCompositeOperation = 'destination-out';
  for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 3; xx++) if ((xx + yy) % 3) m.fillRect(1018 + xx * 52, base - 220 + yy * 52, 26, 30);
  m.globalCompositeOperation = 'source-over';
  // radio tower
  m.lineWidth = 5; m.beginPath(); m.moveTo(1400, base); m.lineTo(1440, base - 420); m.lineTo(1480, base);
  for (let i = 1; i < 9; i++) { const y = base - i * 46, dx = 40 * (1 - i * 46 / 420); m.moveTo(1440 - dx, y); m.lineTo(1440 + dx, y - 46); }
  m.stroke();
  // containers & trees
  [[1580, 70], [1660, 110], [1880, 90]].forEach(([x, h], i) => { m.fillRect(x, base - h, 150, h); });
  const R = rng(9);
  for (let i = 0; i < 26; i++) { const x = 40 + R() * 2100, h = 60 + R() * 120; poly(m, [[x - h * 0.3, base + 4], [x, base - h], [x + h * 0.3, base + 4]]); m.fill(); }
  m.fillRect(0, base - 2, LW, H);
  // near ground
  const [near, n] = mk(LW, H); ridge(n, 11, 1330, 70, '#0a0a0e', 2);
  n.fillStyle = '#0a0a0e'; const R2 = rng(4);
  for (let i = 0; i < 90; i++) { const x = R2() * LW, h = 10 + R2() * 34; poly(n, [[x, 1330 + 40], [x + 3, 1330 - h + 40 * R2()], [x + 7, 1330 + 40]]); n.fill(); }
  for (let i = 0; i < 6; i++) { const x = R2() * LW; n.beginPath(); n.ellipse(x, 1370, 60 + R2() * 90, 40 + R2() * 30, 0, 0, 7); n.fill(); }
  return { far, mid, near };
}
// Precomputed particle fields
const DUST = (() => { const R = rng(21); return Array.from({ length: 140 }, () => ({ x: R() * 1400 - 160, y: R() * 1920, s: 1 + R() * 3.2, v: 10 + R() * 40, ph: R() * 9, z: 0.6 + R() * 1.2 })); })();
const EMB = (() => { const R = rng(33); return Array.from({ length: 60 }, () => ({ x: R() * 1300 - 100, y: R() * 1920, s: 1.5 + R() * 2.5, v: 30 + R() * 90, ph: R() * 9 })); })();
const SMOKE = (() => { const R = rng(44); return Array.from({ length: 14 }, () => ({ x: R() * 1500 - 200, y: 950 + R() * 400, r: 160 + R() * 260, v: 8 + R() * 16, a: 0.05 + R() * 0.07 })); })();

let SOL, GAMER, LAY, GRAIN, VIG;
function init() {
  SOL = buildSoldier(); GAMER = buildGamer(); LAY = buildLayers();
  GRAIN = [0, 1, 2, 3].map(k => {
    const [cv, g] = mk(540, 960); const id = g.createImageData(540, 960); const R = rng(100 + k);
    for (let i = 0; i < id.data.length; i += 4) { const v = 128 + (R() - 0.5) * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
    g.putImageData(id, 0, 0); return cv;
  });
  const [v, vg] = mk(W, H); const gr = vg.createRadialGradient(W / 2, H * 0.46, H * 0.25, W / 2, H * 0.5, H * 0.72);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.78)'); vg.fillStyle = gr; vg.fillRect(0, 0, W, H); VIG = v;
}

// ------------------------------------------------------------ battle plate
function shotAge(t) { let best = 99; for (const s of SHOTS) if (t >= s && t - s < best) best = t - s; return best; }
function drawSky(c, warm = 1) {
  const g = c.createLinearGradient(0, 0, 0, H);
  c.fillStyle = '#05070c'; c.fillRect(-4000, -4000, 9000, 4000); c.fillStyle = '#06060a'; c.fillRect(-4000, H, 9000, 4000);
  g.addColorStop(0, '#05070c'); g.addColorStop(0.32, '#0c1320'); g.addColorStop(0.5, '#2a2330');
  g.addColorStop(0.585, warm > 0.5 ? '#9a4a1e' : '#4a2a2a'); g.addColorStop(0.62, '#3a1c14'); g.addColorStop(1, '#06060a');
  c.fillStyle = g; c.fillRect(-4000, 0, 9000, H);
}
// cam: {x,y,z} world point at screen centre; world == default 1080x1920 frame
function drawBattle(c, t, cam, o = {}) {
  const { soldier = true, fire = true, enemies = true, fall = 0, rimCol = 'amber', soldierX = 700, soldierTop = 760, soldierScale = 2.0, skyP = 0.05 } = o;
  const layer = (img, p, dy = 0) => {
    c.save(); c.translate(W / 2, H / 2); c.scale(cam.z, cam.z);
    c.translate(-(W / 2 + (cam.x - W / 2) * p), -(H / 2 + (cam.y - H / 2) * p));
    img(c); c.restore();
  };
  layer(k => drawSky(k), skyP);
  // sun glow
  layer(k => { const g = k.createRadialGradient(330, 1130, 10, 330, 1130, 760); g.addColorStop(0, 'rgba(255,170,90,0.55)'); g.addColorStop(0.25, 'rgba(255,120,50,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0)'); k.fillStyle = g; k.fillRect(-600, 300, 2200, 1500); }, skyP);
  const drift = t * 6;
  layer(k => k.drawImage(LAY.far, -560 - drift * 0.3, 0), 0.12);
  // haze
  layer(k => { const g = k.createLinearGradient(0, 1000, 0, 1260); g.addColorStop(0, 'rgba(160,90,60,0)'); g.addColorStop(0.5, 'rgba(170,95,65,0.28)'); g.addColorStop(1, 'rgba(40,25,25,0)'); k.fillStyle = g; k.fillRect(-800, 1000, 2800, 260); }, 0.2);
  layer(k => k.drawImage(LAY.mid, -560 - drift * 0.6, 0), 0.3);
  // distant enemies on the ridge + their fire
  if (enemies) layer(k => {
    [[210, 1150, 0.13], [420, 1160, 0.1], [120, 1172, 0.09]].forEach(([x, y, s], i) => {
      k.save(); k.translate(x, y - 600 * s); k.scale(-s / SS, s / SS); k.translate(-400 * SS, 0);
      k.globalAlpha = 0.9; k.drawImage(SOL.body, 0, 0); k.drawImage(SOL.rim.red, 0, 0); k.restore();
      const blink = (Math.sin(t * 23 + i * 4) > 0.93) && fire;
      if (blink) { k.fillStyle = 'rgba(255,200,120,0.9)'; k.beginPath(); k.arc(x + 390 * s / 1 * 0 + 8 + 380 * s, y - 600 * s + 156 * s, 6, 0, 7); k.fill(); }
    });
  }, 0.3);
  // smoke
  layer(k => { SMOKE.forEach(s => { const x = s.x + t * s.v; const g = k.createRadialGradient(x, s.y, 0, x, s.y, s.r); g.addColorStop(0, `rgba(120,100,95,${s.a})`); g.addColorStop(1, 'rgba(0,0,0,0)'); k.fillStyle = g; k.fillRect(x - s.r, s.y - s.r, s.r * 2, s.r * 2); }); }, 0.45);
  layer(k => k.drawImage(LAY.near, -560 - drift, 0), 0.7);
  // fall-away (isolation): darken everything behind the hero
  if (fall > 0) { c.fillStyle = `rgba(3,4,8,${0.92 * fall})`; c.fillRect(0, 0, W, H); }
  const age = fire ? shotAge(t) : 99;
  const flash = age < 0.07 ? 1 - age / 0.07 : 0;
  // enemy tracers (incoming, red) — ambient danger
  if (enemies && fire && fall < 0.5) layer(k => {
    for (let i = 0; i < 3; i++) { const ph = ((t * 1.6 + i * 0.37) % 1); if (ph > 0.25) continue; const q = ph / 0.25;
      const x0 = 150 + i * 80, y0 = 1120, x1 = 1200, y1 = 900 + i * 90; const hx = lerp(x0, x1, q), hy = lerp(y0, y1, q);
      const g = k.createLinearGradient(hx - 160, hy + 30, hx, hy); g.addColorStop(0, 'rgba(255,70,50,0)'); g.addColorStop(1, 'rgba(255,120,90,0.8)');
      k.strokeStyle = g; k.lineWidth = 3; k.beginPath(); k.moveTo(hx - 160, hy + (y0 - y1) / (x1 - x0) * 160); k.lineTo(hx, hy); k.stroke(); }
  }, 0.85);
  if (soldier) layer(k => {
    const s = soldierScale / SS, x0 = soldierX - 200 * soldierScale, y0 = soldierTop;
    const bob = Math.sin(t * 2.2) * 3;
    const recoil = age < 0.12 ? (1 - age / 0.12) * 14 : 0;
    k.save(); k.translate(x0 + recoil, y0 + bob); k.scale(s, s);
    k.drawImage(SOL.body, 0, 0);
    k.globalAlpha = 0.85; k.drawImage(SOL.rim[rimCol], 0, 0);
    if (flash) { k.globalAlpha = flash; k.drawImage(SOL.rim.white, 0, 0); }
    k.restore();
    // muzzle flash + tracer
    const mx = x0 + recoil + 8 * soldierScale, my = y0 + bob + 156 * soldierScale;
    if (flash > 0) {
      k.save(); k.globalCompositeOperation = 'lighter';
      const g = k.createRadialGradient(mx, my, 0, mx, my, 620); g.addColorStop(0, `rgba(255,190,110,${0.45 * flash})`); g.addColorStop(1, 'rgba(0,0,0,0)'); k.fillStyle = g; k.fillRect(mx - 620, my - 620, 1240, 1240);
      k.translate(mx - 20, my); const R = rng(Math.floor(t * 30));
      for (let i = 0; i < 6; i++) { k.save(); k.rotate(Math.PI + (R() - 0.5) * 1.3); const L = (70 + R() * 150) * flash;
        k.fillStyle = `rgba(255,${200 + R() * 55 | 0},150,${flash})`; poly(k, [[0, -9], [L, 0], [0, 9]]); k.fill(); k.restore(); }
      k.fillStyle = `rgba(255,250,235,${flash})`; k.beginPath(); k.arc(0, 0, 26 * flash + 8, 0, 7); k.fill();
      k.restore();
    }
    if (age < 0.16) { const q = age / 0.16; const hx = lerp(mx - 40, mx - 1100, q), hy = lerp(my, my + 60, q);
      const g = k.createLinearGradient(hx + 260, hy - 14, hx, hy); g.addColorStop(0, 'rgba(255,200,120,0)'); g.addColorStop(1, 'rgba(255,230,170,0.95)');
      k.save(); k.globalCompositeOperation = 'lighter'; k.strokeStyle = g; k.lineWidth = 4; k.beginPath(); k.moveTo(hx + 260, hy - 14); k.lineTo(hx, hy); k.stroke(); k.restore(); }
  }, 1);
  // foreground dust/embers
  c.save(); c.globalCompositeOperation = 'lighter';
  EMB.forEach(e => { const y = ((e.y - t * e.v) % H + H) % H, x = e.x + Math.sin(t + e.ph) * 30 - (cam.x - W / 2) * 1.2;
    c.fillStyle = `rgba(255,${140 + (e.ph * 10 % 60) | 0},70,${0.35 + 0.35 * Math.sin(t * 3 + e.ph)})`; c.beginPath(); c.arc(x, y, e.s, 0, 7); c.fill(); });
  c.restore();
}

// ------------------------------------------------------------ stage plate (broadcast)
function drawStage(c, t, accent = COL.amber, o = {}) {
  const { beams = 1, grid = 1, dark = 0, converge = 0 } = o;
  const g = c.createRadialGradient(W / 2, 700, 50, W / 2, 900, 1300);
  g.addColorStop(0, '#141a26'); g.addColorStop(0.55, '#090c13'); g.addColorStop(1, '#040509');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  // perspective floor grid
  if (grid) {
    const hy = 1320, vx = W / 2; c.save(); c.globalAlpha = 0.5 * grid;
    const fl = c.createLinearGradient(0, hy, 0, H); fl.addColorStop(0, 'rgba(0,0,0,0)'); fl.addColorStop(1, accent);
    c.strokeStyle = fl; c.lineWidth = 2;
    for (let i = -14; i <= 14; i++) { c.beginPath(); c.moveTo(vx + i * 12, hy); c.lineTo(vx + i * 170, H); c.stroke(); }
    for (let k = 0; k < 14; k++) { const q = ((k + (t * 0.9) % 1) / 14); const y = hy + Math.pow(q, 2.2) * (H - hy); c.globalAlpha = 0.5 * grid * q; c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.restore();
    const hz = c.createLinearGradient(0, hy - 120, 0, hy + 60); hz.addColorStop(0, 'rgba(0,0,0,0)'); hz.addColorStop(0.7, accent + '33'); hz.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = hz; c.fillRect(0, hy - 120, W, 180);
  }
  // volumetric beams
  if (beams) {
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const sx = 90 + i * 225 + nz(t * 0.3, i) * 40, ang = lerp((i - 2) * 0.16 + nz(t * 0.25, i + 3) * 0.08, 0, converge);
      const ex = sx + Math.sin(ang) * 1900 - lerp(0, sx - W / 2, converge) , w0 = 26, w1 = 260;
      const bg = c.createLinearGradient(sx, 0, sx, 1600); bg.addColorStop(0, accent + '40'); bg.addColorStop(1, 'rgba(0,0,0,0)');
      c.globalAlpha = 0.55 * beams; c.fillStyle = bg; poly(c, [[sx - w0, -20], [sx + w0, -20], [ex + w1, 1700], [ex - w1, 1700]]); c.fill();
    }
    c.restore();
  }
  // floating particles
  c.save(); c.globalCompositeOperation = 'lighter';
  DUST.forEach(d => { const y = ((d.y - t * d.v * 0.8) % H + H) % H, x = d.x + Math.sin(t * 0.6 + d.ph) * 20;
    c.fillStyle = accent; c.globalAlpha = 0.18 + 0.2 * Math.sin(t * 2 + d.ph); c.beginPath(); c.arc(x, y, d.s * 0.8, 0, 7); c.fill(); });
  c.restore();
  if (dark) { c.fillStyle = `rgba(2,3,6,${dark})`; c.fillRect(0, 0, W, H); }
}
function hexPattern(c, t, col, a) {
  c.save(); c.globalAlpha = a; c.strokeStyle = col; c.lineWidth = 1.5; const r = 46, hw = r * Math.sqrt(3);
  for (let row = 0; row < 30; row++) for (let q = 0; q < 10; q++) { const x = q * hw + (row % 2) * hw / 2, y = row * r * 1.5;
    const pulse = 0.3 + 0.7 * Math.max(0, Math.sin(t * 1.5 - (x + y) * 0.004));
    c.globalAlpha = a * pulse; c.beginPath(); for (let k = 0; k < 6; k++) { const an = Math.PI / 3 * k + Math.PI / 6; c.lineTo(x + r * Math.cos(an), y + r * Math.sin(an)); } c.closePath(); c.stroke(); }
  c.restore();
}

// ------------------------------------------------------------ scenes
const S = {};
// S1 HOOK ------------------------------------------------------
S.hook = (c, t) => {
  const z = 1.34 - 0.2 * E.outExpo(P(t, 0, 0.5)) + 0.04 * P(t, 0.5, 2.3);
  drawBattle(c, t, { x: 560 + t * 8, y: 900, z });
  // impact frame at "READY": 2-frame negative/contrast hit
  const hy = 420;
  slam(c, 'BGMI', W / 2, hy, t, C.bgmi, { size: 340, glow: 30, glowColor: 'rgba(255,170,40,0.55)', t1: C.ready - 0.02, outDur: 0.1 });
  slam(c, 'PLAYERS', W / 2, hy + 230, t, C.players, { size: 200, ls: 10, t1: C.ready - 0.02, outDur: 0.1 });
  if (t >= C.ready) {
    text(c, 'BGMI PLAYERS', W / 2, 300, { size: 90, fam: 'Rajdhani', ls: 14, color: COL.amber, alpha: P(t, C.ready + 0.05, C.ready + 0.2) });
    slam(c, 'READY', W / 2, 500, t, C.ready, { size: 330, from: 2.4, glow: 26, glowColor: 'rgba(255,255,255,0.35)' });
    slam(c, 'HO JAO?', W / 2, 720, t, C.hojao, { size: 230, color: COL.amber, glow: 34, glowColor: 'rgba(255,170,30,0.6)' });
  }
};
// S2 EVENT REVEAL ----------------------------------------------
function dateBlock(c, t, x, y, sc, a = 1) {
  c.save(); c.translate(x, y); c.scale(sc, sc); c.globalAlpha *= a;
  slam(c, '27', 0, -40, t, C.d27, { size: 520, glow: 40, glowColor: 'rgba(255,180,40,0.5)', from: 2.2 });
  slam(c, 'SEPTEMBER', 0, 250, t, C.sept, { size: 190, color: COL.amber, ls: 12, from: 1.5 });
  c.restore();
}
S.event = (c, t) => {
  const tt = t - C.kyunki;
  // battlefield pulls back & darkens into a broadcast look
  const cz = 1.1 - 0.12 * E.outCubic(P(t, C.kyunki, C.match));
  drawBattle(c, t, { x: 520, y: 760 - 140 * E.inOutSine(P(t, C.kyunki, C.match)), z: cz }, { fire: false, soldier: true });
  c.fillStyle = `rgba(4,6,10,${0.55 + 0.2 * P(t, C.kyunki, C.kyunki + 0.4)})`; c.fillRect(0, 0, W, H);
  hexPattern(c, t, COL.amber, 0.06);
  // broadcast frame
  const fp = E.outExpo(P(t, C.kyunki, C.kyunki + 0.5));
  brackets(c, 70, 250, 940, 1180, 70 * fp, 5, COL.amber, fp);
  text(c, 'SAVE THE DATE', W / 2, 330, { size: 46, fam: 'Rajdhani', ls: 16, color: COL.dim, alpha: P(t, C.kyunki + 0.1, C.kyunki + 0.4) });
  dateBlock(c, t, W / 2, 700, 1);
  // FIRST BGMI TOURNAMENT
  labelBar(c, 'OUR FIRST', W / 2, 1090, t, C.first, { size: 50 });
  wipe(c, 'BGMI TOURNAMENT', W / 2, 1230, t, C.tourn, { size: 124, dur: 0.4, glow: 18, glowColor: 'rgba(255,255,255,0.3)' });
};
// S3 TIME -------------------------------------------------------
function rollDigits(c, str, x, y, t, t0, dur, o) {
  // slot-machine roll for digits in str; non-digits static
  const size = o.size; c.save(); c.font = font(size, 700, 'Teko'); c.letterSpacing = '0px';
  const widths = [...str].map(ch => c.measureText(ch).width + 6); const total = widths.reduce((a, b) => a + b, 0);
  let cx = x - total / 2;
  [...str].forEach((ch, i) => {
    const w = widths[i];
    if (/\d/.test(ch)) {
      const d = +ch, lag = i * 0.08, p = E.outCubic(P(t, t0 + lag, t0 + lag + dur));
      const spins = 2 + i, pos = (d + 10 * spins) * p; const lh = size * 0.95;
      c.save(); c.beginPath(); c.rect(cx - 4, y - lh * 0.55, w + 8, lh * 1.1); c.clip();
      for (let k = Math.floor(pos) - 1; k <= Math.floor(pos) + 1; k++) {
        const off = (k - pos) * lh; text(c, String(((k % 10) + 10) % 10), cx + w / 2, y + off, { ...o, alpha: (o.alpha ?? 1) * (1 - Math.abs(off) / lh * 0.8) });
      }
      c.restore();
    } else text(c, ch, cx + w / 2, y, o);
    cx += w;
  });
  c.restore();
  return cx;
}
S.time = (c, t) => {
  drawStage(c, t, COL.amber, { beams: 0.7 });
  hexPattern(c, t, COL.amber, 0.05);
  const mp = E.inOutCubic(P(t, C.match, C.match + 0.5));
  // date block migrates up & shrinks
  dateBlock(c, t, W / 2, lerp(700, 470, mp), lerp(1, 0.55, mp));
  // divider
  const dp = E.outExpo(P(t, C.start - 0.1, C.start + 0.4));
  c.fillStyle = COL.amber; c.fillRect(W / 2 - 330 * dp, 700, 660 * dp, 4);
  labelBar(c, 'MATCH STARTS', W / 2, 800, t, C.start, { size: 50, bg: COL.white });
  // clock ring
  if (t > C.shaam) {
    const rp = E.outCubic(P(t, C.shaam, C.baje));
    c.save(); c.translate(W / 2, 1080); c.strokeStyle = 'rgba(255,179,26,0.25)'; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, 330, 0, 7); c.stroke();
    c.strokeStyle = COL.amber; c.lineWidth = 8; c.lineCap = 'round'; c.beginPath(); c.arc(0, 0, 330, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (6.5 / 12) * rp); c.stroke();
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; c.fillStyle = i <= 6 * rp ? COL.amber : '#394050'; c.fillRect(Math.cos(a) * 300 - 3, Math.sin(a) * 300 - 3, 6, 6); }
    c.restore();
    const re = rollDigits(c, '06:30', W / 2 - 70, 1060, t, C.time630, 0.55, { size: 290, color: COL.white, glow: 20, glowColor: 'rgba(255,255,255,0.25)' });
    slam(c, 'PM', re + 75, 1110, t, C.baje, { size: 150, color: COL.amber, from: 1.6 });
    text(c, 'SHAAM', W / 2, 1270, { size: 44, fam: 'Rajdhani', ls: 18, color: COL.dim, alpha: P(t, C.shaam, C.shaam + 0.3) });
  }
};
// S4 SOLO -------------------------------------------------------
const MARKERS = [[140, 1080], [950, 1040], [110, 1400], [970, 1330], [260, 1640], [840, 1660]];
S.solo = (c, t) => {
  const fall = E.inOutCubic(P(t, C.khas, C.solo - 0.1));
  const push = E.inOutSine(P(t, C.cut4, C.entry));
  drawBattle(c, t, { x: 540, y: 1000, z: 1 + 0.18 * push }, { fire: false, enemies: true, fall, rimCol: 'cyan', soldierX: 540, soldierTop: 980, soldierScale: 1.45 });
  // spotlight on the lone player
  if (fall > 0) {
    c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = fall;
    const g = c.createLinearGradient(0, 0, 0, 1800); g.addColorStop(0, 'rgba(120,220,255,0.18)'); g.addColorStop(1, 'rgba(120,220,255,0)');
    c.fillStyle = g; poly(c, [[470, 0], [610, 0], [860, 1820], [220, 1820]]); c.fill();
    const fl = c.createRadialGradient(W / 2, 1790, 10, W / 2, 1790, 360); fl.addColorStop(0, 'rgba(120,220,255,0.3)'); fl.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = fl; c.save(); c.scale(1, 0.25); c.fillRect(0, 1790 * 4 - 400 * 4 / 4 - 700, W, 2000); c.restore();
    c.restore();
  }
  // "SABSE KHAS BAAT" — quiet curiosity beat
  text(c, 'SABSE KHAS BAAT...', W / 2, 520, { size: 64, fam: 'Rajdhani', ls: 14, color: COL.dim, alpha: P(t, C.khas, C.khas + 0.3) * (1 - P(t, C.solo - 0.25, C.solo - 0.05)) });
  // hostile markers close in
  MARKERS.forEach(([mx, my], i) => {
    const a = P(t, C.yeh + i * 0.08, C.yeh + i * 0.08 + 0.15); if (!a) return;
    const k = E.inOutSine(P(t, C.yeh, C.entry)) * 0.18; const x = lerp(mx, 540, k), y = lerp(my, 1300, k);
    c.save(); c.globalAlpha = a * (0.75 + 0.25 * Math.sin(t * 8 + i)); c.translate(x, y); c.rotate(Math.PI / 4);
    c.strokeStyle = COL.red; c.lineWidth = 4; c.strokeRect(-18, -18, 36, 36); c.fillStyle = 'rgba(255,59,59,0.35)'; c.fillRect(-9, -9, 18, 18); c.restore();
    text(c, 'HOSTILE', x, y + 44, { size: 26, fam: 'Rajdhani', ls: 6, color: COL.red, alpha: a * 0.8 });
  });
  // SOLO
  const up = E.inOutCubic(P(t, C.skill - 0.2, C.skill + 0.2));
  slam(c, 'SOLO', W / 2, lerp(560, 420, up), t, C.solo, { size: lerp(480, 330, up), from: 2.6, glow: 40, glowColor: 'rgba(57,224,255,0.45)' });
  labelBar(c, 'MATCH', W / 2, lerp(790, 590, up), t, C.matchS, { size: 56, bg: COL.cyan, ls: 20 });
  wipe(c, 'YOUR SKILL', W / 2, 740, t, C.skill, { size: 150, barColor: COL.cyan });
  slam(c, 'DECIDES.', W / 2, 890, t, C.depend, { size: 170, color: COL.amber, from: 1.4, glow: 26, glowColor: 'rgba(255,170,30,0.5)' });
  // reticle lock on the hero
  if (t > C.skill - 0.1) {
    const lp = E.outBack(P(t, C.skill - 0.1, C.skill + 0.25));
    const bw = lerp(760, 380, lp), bh = lerp(1100, 860, lp), z = 1 + 0.18 * push;
    const cx = W / 2, cy = 1000 + (1400 - 1000) * z;
    brackets(c, cx - bw / 2, cy - bh / 2, bw, bh, 50, 5, t > C.skill + 0.25 ? COL.amber : COL.cyan, 0.9);
    if (t > C.skill + 0.25) text(c, 'LOCKED', cx + bw / 2 - 10, cy - bh / 2 - 26, { size: 30, fam: 'Rajdhani', ls: 8, align: 'right', color: COL.amber });
  }
};
// S5 MONEY ------------------------------------------------------
const COINS = (() => { const R = rng(77); return Array.from({ length: 150 }, () => ({ a: R() * Math.PI * 2, v: 400 + R() * 1500, s: 3 + R() * 7, spin: R() * 9, g: 300 + R() * 500 })); })();
S.money = (c, t) => {
  const tension = E.inCubic(P(t, C.pause, C.r500));
  const post = t >= C.r500;
  drawStage(c, t, COL.gold, { beams: post ? 1.2 : 0.8 - 0.3 * tension, dark: tension * 0.5, converge: post ? 0.4 : tension });
  hexPattern(c, t, COL.gold, post ? 0.07 : 0.04);
  const ep = E.inOutCubic(P(t, C.winning - 0.1, C.winning + 0.5));
  // ENTRY FEE / ₹50 (restrained)
  labelBar(c, 'ENTRY FEE', W / 2, lerp(620, 380, ep), t, C.entry, { size: 52, bg: COL.white });
  if (t >= C.r50) {
    const a = E.outCubic(P(t, C.r50, C.r50 + 0.35));
    c.save(); c.translate(W / 2, lerp(900, 520, ep) + (1 - a) * 40); const sc = lerp(1, 0.5, ep); c.scale(sc, sc);
    text(c, '₹50', 0, 0, { size: 380, alpha: a, color: COL.white }); c.restore();
  }
  labelBar(c, 'WINNING AMOUNT', W / 2, 1320, t, C.winning, { size: 52 });
  // tension: chevrons pointing down, pulsing faster
  if (t > C.winning + 0.3) {
    const k = P(t, C.winning + 0.3, C.winning + 0.6) * (post ? 0 : 1);
    for (let i = 0; i < 3; i++) { const ph = (t * (2 + tension * 5) - i * 0.25) % 1;
      c.save(); c.globalAlpha = k * (1 - ph) * 0.9; c.strokeStyle = COL.gold; c.lineWidth = 8; c.beginPath();
      const y = 680 + i * 50; c.moveTo(W / 2 - 50, y); c.lineTo(W / 2, y + 36); c.lineTo(W / 2 + 50, y); c.stroke(); c.restore(); }
  }
  if (!post && tension > 0) { // gathering energy
    c.save(); c.globalCompositeOperation = 'lighter';
    const g = c.createRadialGradient(W / 2, 960, 0, W / 2, 960, 500 * (1 - tension * 0.6)); g.addColorStop(0, `rgba(255,200,80,${0.5 * tension})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 300, W, 1300); c.restore();
  }
  if (post) {
    const tp = t - C.r500;
    // shockwave
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 2; k++) { const q = clamp((tp - k * 0.08) / 0.7); if (q <= 0 || q >= 1) continue;
      c.strokeStyle = `rgba(255,210,110,${(1 - q) * 0.8})`; c.lineWidth = 30 * (1 - q) + 2; c.beginPath(); c.arc(W / 2, 960, 60 + q * 1100, 0, 7); c.stroke(); }
    // coin/particle burst
    COINS.forEach(p => { const d = p.v * (1 - Math.exp(-tp * 3)) / 3; const x = W / 2 + Math.cos(p.a) * d, y = 960 + Math.sin(p.a) * d + p.g * tp * tp * 0.5;
      const a = clamp(1 - tp / 1.3); if (a <= 0) return; c.fillStyle = `rgba(255,${190 + (p.spin * 7 | 0)},90,${a})`;
      c.save(); c.translate(x, y); c.rotate(p.spin + tp * 6); c.fillRect(-p.s, -p.s * 0.4, p.s * 2, p.s * 0.8); c.restore(); });
    c.restore();
    const gold = c.createLinearGradient(0, 780, 0, 1140); gold.addColorStop(0, '#fff3c4'); gold.addColorStop(0.45, '#ffd166'); gold.addColorStop(1, '#ff9f1a');
    slam(c, '₹500', W / 2, 960, t, C.r500, { size: 470, from: 2.8, dur: 0.3, fillStyle: gold, glow: 60, glowColor: 'rgba(255,170,40,0.75)', streak: true });
    text(c, 'WIN', W / 2, 745, { size: 90, fam: 'Rajdhani', ls: 30, color: COL.gold, alpha: P(t, C.r500 + 0.15, C.r500 + 0.4) });
    // down-arrow relation ₹50 → ₹500
    const ap = E.outExpo(P(t, C.r500 + 0.2, C.r500 + 0.6));
    c.save(); c.globalAlpha = ap; c.strokeStyle = COL.white; c.lineWidth = 6; c.beginPath(); c.moveTo(W / 2 - 34, 620); c.lineTo(W / 2, 654); c.lineTo(W / 2 + 34, 620); c.stroke(); c.restore();
  }
};
// S6 FOMO (scope) ----------------------------------------------
S.fomo = (c, t) => {
  const pan = E.inOutSine(P(t, C.agar, C.miss));
  // underlying world, then scope mask
  const tx = lerp(-40, -560, pan), ty = lerp(1400, 1445, pan);
  const sway = { x: nz(t * 0.8, 1) * 12, y: nz(t * 0.7, 5) * 10 };
  const hit = t >= C.miss;
  const kick = hit ? Math.exp(-(t - C.miss) * 9) * 60 : 0;
  c.fillStyle = '#020305'; c.fillRect(0, 0, W, H);
  const R0 = 450, cx = W / 2, cy = 960;
  c.save(); c.beginPath(); c.arc(cx, cy, R0, 0, 7); c.clip();
  drawBattle(c, t, { x: tx + sway.x, y: ty + sway.y - kick, z: 4.2 }, { fire: false, soldier: false, enemies: true, skyP: 0.3 });
  // lens vignette + tint
  const lv = c.createRadialGradient(cx, cy, R0 * 0.55, cx, cy, R0); lv.addColorStop(0, 'rgba(0,0,0,0)'); lv.addColorStop(1, 'rgba(0,0,0,0.85)'); c.fillStyle = lv; c.fillRect(0, 0, W, H);
  // reticle
  const rc = hit ? COL.amber : '#e8f6ff';
  c.strokeStyle = rc; c.lineWidth = 3; c.beginPath(); c.moveTo(cx - R0, cy); c.lineTo(cx - 40, cy); c.moveTo(cx + 40, cy); c.lineTo(cx + R0, cy); c.moveTo(cx, cy - R0); c.lineTo(cx, cy - 40); c.moveTo(cx, cy + 40); c.lineTo(cx, cy + R0); c.stroke();
  c.lineWidth = 9; c.beginPath(); c.moveTo(cx - R0, cy); c.lineTo(cx - 200, cy); c.moveTo(cx + 200, cy); c.lineTo(cx + R0, cy); c.moveTo(cx, cy + 200); c.lineTo(cx, cy + R0); c.stroke();
  for (let i = 1; i < 5; i++) { c.fillStyle = rc; c.fillRect(cx - 3 + i * 40, cy - 3, 6, 6); c.fillRect(cx - 3 - i * 40, cy - 3, 6, 6); c.fillRect(cx - 3, cy - 3 + i * 40, 6, 6); }
  c.fillStyle = hit ? COL.red : COL.red; c.beginPath(); c.arc(cx, cy, 5, 0, 7); c.fill();
  c.restore();
  // scope ring
  c.save(); c.strokeStyle = '#1a1d24'; c.lineWidth = 34; c.beginPath(); c.arc(cx, cy, R0 + 16, 0, 7); c.stroke();
  c.strokeStyle = 'rgba(57,224,255,0.35)'; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, R0 + 36, 0, 7); c.stroke();
  // range ticks
  for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI * 2 + t * 0.2; c.globalAlpha = 0.4; c.fillStyle = COL.cyan; c.fillRect(cx + Math.cos(a) * (R0 + 50) - 2, cy + Math.sin(a) * (R0 + 50) - 2, i % 5 ? 3 : 6, i % 5 ? 3 : 6); }
  c.restore();
  text(c, `RANGE ${Math.round(lerp(412, 238, pan))}M`, cx - R0 + 10, cy - R0 - 60, { size: 36, fam: 'Rajdhani', ls: 8, color: COL.cyan, align: 'left', alpha: 0.8 });
  // Text: you play BGMI? → DON'T MISS IT
  const qOut = C.miss - 0.08;
  slam(c, 'BGMI KHELTE HO?', W / 2, 330, t, C.bgmiQ - 0.1, { size: 130, t1: qOut, outDur: 0.1, from: 1.3 });
  text(c, 'THIS IS FOR YOU', W / 2, 1560, { size: 70, fam: 'Rajdhani', ls: 16, color: COL.amber, alpha: P(t, C.opp - 0.1, C.opp + 0.2) * (1 - P(t, qOut, qOut + 0.1)) });
  if (hit) {
    // warning stripes flash on the frame edges
    const wf = (Math.floor((t - C.miss) * 8) % 2 === 0 && t - C.miss < 0.6) ? 1 : 0.35;
    c.save(); c.globalAlpha = wf; c.fillStyle = COL.amber;
    for (let i = -2; i < 14; i++) { poly(c, [[i * 90, 0], [i * 90 + 45, 0], [i * 90 + 5, 40], [i * 90 - 40, 40]]); c.fill(); poly(c, [[i * 90, H - 40], [i * 90 + 45, H - 40], [i * 90 + 5, H], [i * 90 - 40, H]]); c.fill(); }
    c.restore();
    slam(c, "DON'T MISS", W / 2, 300, t, C.miss, { size: 220, from: 2.2, glow: 30, glowColor: 'rgba(255,59,59,0.55)' });
    slam(c, 'IT.', W / 2, 1560, t, C.miss + 0.12, { size: 200, color: COL.amber, from: 1.8 });
  }
};
// PHONE --------------------------------------------------------
const PH = { x: 190, y: 400, w: 700, h: 1440, r: 90 };
function phoneFrame(c, dy, fn) {
  c.save(); c.translate(0, dy);
  c.shadowColor = 'rgba(0,0,0,0.7)'; c.shadowBlur = 80; c.fillStyle = '#0b0d11'; rr(c, PH.x, PH.y, PH.w, PH.h, PH.r); c.fill(); c.shadowBlur = 0;
  c.strokeStyle = '#2b313c'; c.lineWidth = 5; rr(c, PH.x, PH.y, PH.w, PH.h, PH.r); c.stroke();
  const sx = PH.x + 18, sy = PH.y + 18, sw = PH.w - 36, sh = PH.h - 36;
  c.save(); rr(c, sx, sy, sw, sh, PH.r - 16); c.clip(); c.fillStyle = '#0f131a'; c.fillRect(sx, sy, sw, sh);
  fn(c, sx, sy, sw, sh);
  c.fillStyle = '#000'; rr(c, W / 2 - 90, sy + 18, 180, 44, 22); c.fill(); // island
  c.restore();
  // glass sheen
  c.save(); rr(c, PH.x, PH.y, PH.w, PH.h, PH.r); c.clip(); const g = c.createLinearGradient(PH.x, PH.y, PH.x + PH.w, PH.y + 600); g.addColorStop(0, 'rgba(255,255,255,0.07)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(PH.x, PH.y, PH.w, PH.h); c.restore();
  c.restore();
}
function calendarScreen(c, t, sx, sy, sw, sh) {
  text(c, '9:41', sx + 70, sy + 42, { size: 30, fam: 'Rajdhani', align: 'left', color: COL.white });
  const zp = E.inOutCubic(P(t, C.s27 - 0.05, C.s27 + 0.35)); // grid → detail
  // month grid
  if (zp < 1) {
    c.save(); c.globalAlpha = 1 - zp;
    text(c, 'SEPTEMBER', sx + 50, sy + 150, { size: 96, align: 'left', color: COL.white, ls: 4 });
    const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'], cw = (sw - 60) / 7, gy = sy + 260;
    days.forEach((d, i) => text(c, d, sx + 30 + cw * (i + 0.5), gy, { size: 30, fam: 'Rajdhani', color: COL.dim }));
    for (let d = 1; d <= 30; d++) { const idx = d + 1, col = idx % 7, row = Math.floor(idx / 7); const x = sx + 30 + cw * (col + 0.5), y = gy + 80 + row * 92;
      if (d === 27) { const pp = E.outBack(P(t, C.abhi + 0.4, C.abhi + 0.7)); c.fillStyle = COL.amber; c.beginPath(); c.arc(x, y, 38 * pp, 0, 7); c.fill(); }
      text(c, String(d), x, y, { size: 40, fam: 'Rajdhani', color: d === 27 ? COL.ink : '#cfd5e2' }); }
    c.restore();
  }
  if (zp > 0) {
    c.save(); c.globalAlpha = zp; const k = lerp(0.6, 1, zp); c.translate(sx + sw / 2, sy + 500); c.scale(k, k); c.translate(-(sx + sw / 2), -(sy + 500));
    text(c, 'SUNDAY', sx + sw / 2, sy + 190, { size: 40, fam: 'Rajdhani', ls: 14, color: COL.dim });
    text(c, '27', sx + sw / 2, sy + 390, { size: 330, color: COL.amber, glow: 30, glowColor: 'rgba(255,179,26,0.4)' });
    text(c, 'SEPTEMBER', sx + sw / 2, sy + 600, { size: 120, color: COL.white, ls: 8 });
    c.restore();
    // event card
    const ep = E.outExpo(P(t, C.s630 - 0.1, C.s630 + 0.3));
    if (ep > 0) { c.save(); c.globalAlpha = ep; c.translate(0, (1 - ep) * 60);
      c.fillStyle = '#18202c'; rr(c, sx + 40, sy + 700, sw - 80, 250, 34); c.fill(); c.fillStyle = COL.amber; rr(c, sx + 40, sy + 700, 14, 250, 7); c.fill();
      // clock icon
      c.strokeStyle = COL.amber; c.lineWidth = 7; c.beginPath(); c.arc(sx + 130, sy + 800, 36, 0, 7); c.stroke(); c.beginPath(); c.moveTo(sx + 130, sy + 800); c.lineTo(sx + 130, sy + 778); c.moveTo(sx + 130, sy + 800); c.lineTo(sx + 146, sy + 812); c.stroke();
      text(c, '6:30 PM', sx + 200, sy + 804, { size: 140, align: 'left', color: COL.white });
      text(c, 'BGMI TOURNAMENT  ·  SOLO', sx + 90, sy + 900, { size: 38, fam: 'Rajdhani', ls: 4, align: 'left', color: COL.dim });
      c.restore(); }
    // reminder toggle row
    const rp = E.outExpo(P(t, C.s630 + 0.4, C.s630 + 0.7));
    if (rp > 0) { c.save(); c.globalAlpha = rp;
      text(c, 'REMINDER', sx + 60, sy + 1040, { size: 56, fam: 'Rajdhani', align: 'left', color: COL.white, ls: 4 });
      const on = E.outBack(P(t, C.reminder, C.reminder + 0.22)); const tx = sx + sw - 190, ty = sy + 1005;
      c.fillStyle = on > 0.5 ? COL.green : '#39414f'; rr(c, tx, ty, 130, 72, 36); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.arc(tx + 36 + 58 * on, ty + 36, 28, 0, 7); c.fill();
      c.restore(); }
  }
  // confirmation banner
  const bp = t < C.reg - 0.1 ? E.outBack(P(t, C.reminder + 0.15, C.reminder + 0.45)) : 1 - P(t, C.reg - 0.1, C.reg);
  if (bp > 0 && t > C.reminder) { c.save(); c.translate(0, lerp(-200, 0, bp));
    c.fillStyle = COL.green; rr(c, sx + 30, sy + 90, sw - 60, 140, 38); c.fill();
    c.strokeStyle = COL.ink; c.lineWidth = 11; c.lineCap = 'round'; c.lineJoin = 'round'; const ck = P(t, C.reminder + 0.3, C.reminder + 0.55);
    c.beginPath(); c.moveTo(sx + 90, sy + 160); c.lineTo(sx + 90 + 24 * clamp(ck * 2), sy + 160 + 24 * clamp(ck * 2)); if (ck > 0.5) c.lineTo(sx + 114 + 46 * (ck - 0.5) * 2, sy + 184 - 50 * (ck - 0.5) * 2); c.stroke();
    text(c, 'REMINDER SET', sx + 170, sy + 162, { size: 72, align: 'left', color: COL.ink });
    c.restore(); }
}
function chatScreen(c, t, sx, sy, sw, sh) {
  text(c, '9:41', sx + 70, sy + 42, { size: 30, fam: 'Rajdhani', align: 'left', color: COL.white });
  // header
  c.fillStyle = '#141923'; c.fillRect(sx, sy + 80, sw, 150);
  c.strokeStyle = COL.white; c.lineWidth = 6; c.lineCap = 'round'; c.beginPath(); c.moveTo(sx + 70, sy + 135); c.lineTo(sx + 50, sy + 155); c.lineTo(sx + 70, sy + 175); c.stroke();
  const ag = c.createLinearGradient(sx + 100, sy + 110, sx + 190, sy + 200); ag.addColorStop(0, COL.amber); ag.addColorStop(1, '#ff5e3a'); c.fillStyle = ag; c.beginPath(); c.arc(sx + 145, sy + 155, 44, 0, 7); c.fill();
  // controller glyph in avatar
  c.fillStyle = COL.ink; rr(c, sx + 117, sy + 142, 56, 28, 14); c.fill();
  text(c, 'TOURNAMENT DMs', sx + 210, sy + 140, { size: 44, fam: 'Rajdhani', align: 'left', color: COL.white });
  text(c, 'Tap to message', sx + 210, sy + 182, { size: 28, fam: 'Rajdhani', weight: 600, align: 'left', color: COL.dim });
  // compose → send
  const msg = 'I WANT TO REGISTER!';
  const typed = Math.floor(msg.length * P(t, C.reg + 0.35, C.dm - 0.15));
  const sent = t >= C.dm;
  // input bar
  c.fillStyle = '#1a202b'; rr(c, sx + 30, sy + sh - 170, sw - 60, 100, 50); c.fill();
  if (!sent) text(c, typed ? msg.slice(0, typed) + (Math.floor(t * 4) % 2 ? '|' : '') : 'Message...', sx + 80, sy + sh - 120, { size: 40, fam: 'Rajdhani', align: 'left', color: typed ? COL.white : COL.dim });
  c.fillStyle = COL.amber; c.beginPath(); c.arc(sx + sw - 90, sy + sh - 120, 36, 0, 7); c.fill();
  c.fillStyle = COL.ink; poly(c, [[sx + sw - 106, sy + sh - 138], [sx + sw - 70, sy + sh - 120], [sx + sw - 106, sy + sh - 102], [sx + sw - 98, sy + sh - 120]]); c.fill();
  if (sent) {
    const sp = E.outBack(P(t, C.dm, C.dm + 0.35));
    const by = lerp(sy + sh - 170, sy + 330, sp);
    c.save(); c.globalAlpha = clamp(sp * 2); const bw = 560;
    const bg = c.createLinearGradient(sx + sw - 40 - bw, by, sx + sw - 40, by + 120); bg.addColorStop(0, COL.amber); bg.addColorStop(1, '#ff7a1a');
    c.fillStyle = bg; rr(c, sx + sw - 40 - bw, by, bw, 120, 44); c.fill();
    text(c, msg, sx + sw - 40 - bw / 2, by + 62, { size: 60, color: COL.ink });
    c.restore();
    text(c, 'Sent', sx + sw - 50, sy + 480, { size: 28, fam: 'Rajdhani', align: 'right', color: COL.dim, alpha: P(t, C.dm + 0.3, C.dm + 0.5) });
    // typing dots from them
    if (t > C.dm + 0.45) { const dp = E.outBack(P(t, C.dm + 0.45, C.dm + 0.65)); c.save(); c.globalAlpha = dp; c.fillStyle = '#222a37'; rr(c, sx + 40, sy + 540, 170, 90, 45); c.fill();
      for (let i = 0; i < 3; i++) { c.fillStyle = COL.white; c.globalAlpha = dp * (0.4 + 0.6 * Math.max(0, Math.sin(t * 9 - i))); c.beginPath(); c.arc(sx + 90 + i * 36, sy + 585, 11, 0, 7); c.fill(); } c.restore(); }
  }
}
S.phone = (c, t) => {
  drawStage(c, t, COL.cyan, { beams: 0.6, grid: 0.7 });
  const inP = E.outExpo(P(t, C.abhi - 0.05, C.abhi + 0.45));
  const outP = E.inCubic(P(t, C.hum - 0.05, C.hum + 0.25));
  const dy = (1 - inP) * 1500 + outP * 1600;
  // title above phone
  slam(c, 'SET A REMINDER', W / 2, 250, t, C.abhi + 0.05, { size: 120, t1: C.reg - 0.1, outDur: 0.12, from: 1.3 });
  slam(c, 'DM TO REGISTER', W / 2, 250, t, C.reg, { size: 130, color: COL.amber, from: 1.4, glow: 24, glowColor: 'rgba(255,179,26,0.5)' });
  const sw = E.inOutCubic(P(t, C.reg - 0.05, C.reg + 0.35)); // screen swipe
  phoneFrame(c, dy, (k, sx, sy, sW, sH) => {
    k.save(); k.translate(-sw * sW, 0); calendarScreen(k, t, sx, sy, sW, sH); k.restore();
    if (sw > 0) { k.save(); k.translate((1 - sw) * sW, 0); k.fillStyle = '#0f131a'; k.fillRect(sx, sy, sW, sH); chatScreen(k, t, sx, sy, sW, sH); k.restore(); }
  });
};
// S9 STEPS -----------------------------------------------------
function icon(c, kind, x, y, s, col) {
  c.save(); c.translate(x, y); c.scale(s, s); c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 7; c.lineJoin = 'round'; c.lineCap = 'round';
  if (kind === 'dm') { rr(c, -40, -34, 80, 58, 16); c.stroke(); poly(c, [[-18, 22], [-26, 42], [2, 24]]); c.fill(); for (let i = -1; i <= 1; i++) { c.beginPath(); c.arc(i * 20, -5, 5, 0, 7); c.fill(); } }
  if (kind === 'doc') { poly(c, [[-30, -42], [14, -42], [32, -24], [32, 42], [-30, 42]]); c.stroke(); for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(-16, -12 + i * 20); c.lineTo(18, -12 + i * 20); c.stroke(); } }
  if (kind === 'check') { c.beginPath(); c.arc(0, 0, 40, 0, 7); c.stroke(); c.beginPath(); c.moveTo(-18, 0); c.lineTo(-4, 15); c.lineTo(20, -14); c.stroke(); }
  if (kind === 'follow') { c.beginPath(); c.arc(-8, -16, 16, 0, 7); c.stroke(); c.beginPath(); c.arc(-8, 38, 34, Math.PI * 1.15, Math.PI * 1.85); c.stroke(); c.beginPath(); c.moveTo(30, -10); c.lineTo(30, 18); c.moveTo(16, 4); c.lineTo(44, 4); c.stroke(); }
  if (kind === 'share') { poly(c, [[-38, 0], [38, -32], [14, 38], [4, 8]]); c.stroke(); c.beginPath(); c.moveTo(4, 8); c.lineTo(38, -32); c.stroke(); }
  c.restore();
}
S.steps = (c, t) => {
  drawStage(c, t, COL.cyan, { beams: 0.5, grid: 0.6 });
  text(c, 'HOW TO JOIN', W / 2, 330, { size: 54, fam: 'Rajdhani', ls: 20, color: COL.dim, alpha: P(t, C.hum, C.hum + 0.3) });
  const steps = [['01', 'DM US', 'dm', C.hum + 0.1], ['02', 'GET RULES + REGULATIONS', 'doc', C.rules], ['03', 'REGISTER', 'check', C.send]];
  const y0 = 560, gap = 330;
  // spine line
  const sp = E.inOutCubic(P(t, C.hum + 0.1, C.send + 0.1));
  c.save(); c.strokeStyle = 'rgba(57,224,255,0.4)'; c.lineWidth = 4; c.setLineDash([14, 12]); c.lineDashOffset = -t * 60; c.beginPath(); c.moveTo(190, y0); c.lineTo(190, y0 + gap * 2 * sp); c.stroke(); c.restore();
  steps.forEach(([n, label, ic, t0], i) => {
    const y = y0 + i * gap; const p = E.outExpo(P(t, t0, t0 + 0.4)); if (p <= 0) return;
    const active = (i === 2) ? t > t0 : (i === 0 ? t < C.rules : t < C.send);
    c.save(); c.globalAlpha = p; c.translate((1 - p) * 120, 0);
    c.fillStyle = active ? 'rgba(57,224,255,0.14)' : 'rgba(255,255,255,0.04)'; para(c, 110, y - 120, 870, 240, 0.12); c.fill();
    c.strokeStyle = active ? COL.cyan : 'rgba(255,255,255,0.15)'; c.lineWidth = 3; para(c, 110, y - 120, 870, 240, 0.12); c.stroke();
    c.fillStyle = COL.ink; c.beginPath(); c.arc(190, y, 62, 0, 7); c.fill(); c.strokeStyle = active ? COL.cyan : '#4a5363'; c.lineWidth = 4; c.stroke();
    icon(c, ic, 190, y, 0.95, i === 2 ? COL.green : COL.cyan);
    text(c, n, 290, y - 58, { size: 40, fam: 'Rajdhani', ls: 8, align: 'left', color: COL.dim });
    const long = label.length > 12; text(c, label, 290, y + 18, { size: long ? 64 : 130, align: 'left', color: i === 2 ? COL.green : COL.white });
    c.restore();
  });
};
// S10/S11 FRIEND SPLIT ------------------------------------------
function gamerPanel(c, t, x, flip, glow, glowA) {
  c.save(); c.translate(x, 1560); if (flip) c.scale(-1, 1);
  // screen glow on face
  const g = c.createRadialGradient(150, -250, 0, 150, -250, 520); g.addColorStop(0, glow + Math.round(glowA * 120).toString(16).padStart(2, '0')); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.fillRect(-500, -900, 1200, 1200);
  c.drawImage(GAMER, -330, -700); c.globalAlpha = 0.9; c.drawImage(GAMER.rims[glow], -330, -700); c.globalAlpha = 1;
  // phone in hands
  c.save(); c.translate(135, -175); c.rotate(-0.5); c.fillStyle = '#0b0d11'; rr(c, -24, -60, 48, 120, 10); c.fill(); c.fillStyle = glow; c.globalAlpha = 0.6 + 0.4 * glowA; rr(c, -18, -52, 36, 104, 6); c.fill(); c.restore();
  // rim light
  c.restore();
}
S.friends = (c, t) => {
  // diagonal split: left cyan (YOU), right amber (FRIEND)
  const inP = E.outExpo(P(t, C.haan - 0.05, C.haan + 0.5));
  const vs = t >= C.kyunki2;
  const tight = E.outExpo(P(t, C.kyunki2, C.kyunki2 + 0.35));
  c.fillStyle = '#05070b'; c.fillRect(0, 0, W, H);
  const split = (side, col) => {
    c.save(); c.beginPath();
    const off = (1 - inP) * 600 * (side ? 1 : -1), gap = 14 * tight;
    if (!side) poly(c, [[-10 + off, 0], [600 - gap + off, 0], [480 - gap + off, H], [-10 + off, H]]);
    else poly(c, [[600 + gap + off, 0], [W + 10 + off, 0], [W + 10 + off, H], [480 + gap + off, H]]);
    c.clip();
    const g = c.createLinearGradient(side ? W : 0, 0, W / 2, H); g.addColorStop(0, col + '33'); g.addColorStop(1, '#07090e'); c.fillStyle = g; c.fillRect(0, 0, W, H);
    hexPattern(c, t + side, col, 0.06);
    const notif = side ? E.outBack(P(t, C.share + 0.3, C.share + 0.55)) : 0;
    gamerPanel(c, t, side ? 830 + off : 250 + off, !!side, col, 0.6 + 0.4 * notif);
    c.restore();
  };
  split(0, COL.cyan); split(1, COL.amber);
  // divider glow
  c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = `rgba(255,255,255,${0.35 * inP})`; c.lineWidth = 3; c.beginPath(); c.moveTo(600, 0); c.lineTo(480, H); c.stroke(); c.restore();
  // share: paper plane flies from YOU to FRIEND
  if (t > C.share - 0.1 && t < C.kyunki2 + 0.1) {
    const q = E.inOutCubic(P(t, C.share - 0.1, C.share + 0.35));
    const x = lerp(300, 820, q), y = lerp(1180, 1120, q) - Math.sin(q * Math.PI) * 220;
    c.save(); c.globalAlpha = 1 - P(t, C.share + 0.35, C.share + 0.5);
    c.strokeStyle = 'rgba(255,255,255,0.5)'; c.setLineDash([10, 12]); c.lineWidth = 4; c.beginPath();
    for (let k = 0; k <= 20; k++) { const qq = q * k / 20; c.lineTo(lerp(300, 820, qq), lerp(1180, 1120, qq) - Math.sin(qq * Math.PI) * 220); } c.stroke();
    c.setLineDash([]); icon(c, 'share', x, y, 1.3, COL.white); c.restore();
  }
  if (!vs) {
    const o = { t1: C.kyunki2 - 0.08, outDur: 0.1 };
    slam(c, 'SEND THIS', W / 2, 330, t, C.haan + 0.25, { size: 190, from: 1.5, ...o });
    slam(c, 'TO YOUR BGMI FRIEND', W / 2, 500, t, C.bgmiF - 0.15, { size: 110, color: COL.amber, from: 1.4, ...o });
    labelBar(c, 'SHARE THIS REEL', W / 2, 640, t, C.reel, { size: 46, bg: COL.white, ...o });
  } else {
    text(c, 'YOU', 250, 1450, { size: 120, color: COL.cyan, alpha: tight });
    text(c, 'YOUR FRIEND', 840, 1450, { size: 84, color: COL.amber, alpha: tight });
    slam(c, 'VS', W / 2 - 20, 900, t, C.kyunki2, { size: 260, from: 3, glow: 40, glowColor: 'rgba(255,255,255,0.5)' });
    slam(c, "WHO'S TAKING", W / 2, 300, t, C.kyunki2 + 0.1, { size: 150, from: 1.4 });
    slam(c, 'THE ₹500?', W / 2, 460, t, C.kyunki2 + 0.3, { size: 170, color: COL.gold, from: 1.4, glow: 24, glowColor: 'rgba(255,190,60,0.5)' });
    // reticle bounces YOU ↔ FRIEND then locks on FRIEND
    if (t > C.next) {
      const hops = [[C.next, 250], [C.next + 0.3, 830], [C.next + 0.55, 250], [C.dost, 830]];
      let tx = 250; for (const [ht, hx] of hops) if (t >= ht) tx = hx;
      let px = 250; for (let i = 1; i < hops.length; i++) if (t >= hops[i][0]) { const q = E.outExpo(P(t, hops[i][0], hops[i][0] + 0.12)); px = lerp(hops[i - 1][1], hops[i][1], q); }
      const locked = t >= C.dost + 0.1;
      const bw = locked ? 330 : 380; brackets(c, px - bw / 2, 830, bw, 560, 44, 6, locked ? COL.amber : COL.white, 0.95);
      if (locked) labelBar(c, 'NEXT WINNER?', 830, 790, t, C.dost + 0.1, { size: 40 });
    }
    // engagement prompt (secondary, brief)
    const ep = P(t, C.dost + 0.2, C.dost + 0.4) * (1 - P(t, C.hum2 - 0.1, C.hum2));
    if (ep > 0) { c.save(); c.globalAlpha = ep; c.fillStyle = 'rgba(255,255,255,0.1)'; rr(c, 150, 1560, 660, 84, 42); c.fill(); c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = 2; rr(c, 150, 1560, 660, 84, 42); c.stroke(); c.restore();
      text(c, "TAG THE FRIEND YOU'D BEAT", 480, 1603, { size: 40, fam: 'Rajdhani', ls: 4, alpha: ep }); }
  }
};
// S12 NETWORK ---------------------------------------------------
const NODES = (() => { const R = rng(55); return Array.from({ length: 46 }, () => ({ a: R() * Math.PI * 2, d: 160 + R() * 900, s: 3 + R() * 5, dl: R() * 0.8 })); })();
S.network = (c, t) => {
  drawStage(c, t, COL.cyan, { beams: 0.5, grid: 0.5 });
  const cx = W / 2, cy = 900, ex = E.outCubic(P(t, C.hum2, C.host + 0.6));
  // expanding ecosystem graph
  c.save();
  NODES.forEach((n, i) => { const k = clamp(ex * 1.4 - n.dl * 0.5); if (k <= 0) return; const x = cx + Math.cos(n.a) * n.d * k, y = cy + Math.sin(n.a) * n.d * k * 1.2;
    c.strokeStyle = `rgba(57,224,255,${0.12 * k})`; c.lineWidth = 1.5; c.beginPath(); c.moveTo(cx, cy); c.lineTo(x, y); c.stroke();
    const nb = NODES[(i + 7) % NODES.length]; const kb = clamp(ex * 1.4 - nb.dl * 0.5); c.beginPath(); c.moveTo(x, y); c.lineTo(cx + Math.cos(nb.a) * nb.d * kb, cy + Math.sin(nb.a) * nb.d * kb * 1.2); c.stroke();
    c.fillStyle = `rgba(57,224,255,${0.7 * k})`; c.beginPath(); c.arc(x, y, n.s, 0, 7); c.fill(); });
  c.restore();
  text(c, 'WE HOST TOURNAMENTS FOR', W / 2, 320, { size: 52, fam: 'Rajdhani', ls: 10, color: COL.dim, alpha: P(t, C.hum2, C.hum2 + 0.3) });
  const tiles = [['BGMI', C.bgmiN, COL.amber, 530], ['FREE FIRE', C.ff, COL.cyan, 760], ['+ MORE GAMES', C.more, COL.white, 990]];
  tiles.forEach(([name, t0, col, y], i) => {
    const p = E.outExpo(P(t, t0 - 0.05, t0 + 0.35)); if (p <= 0) return;
    const w = 700, h = 170, x = W / 2 - w / 2 + (1 - p) * (i % 2 ? -700 : 700);
    c.save(); c.globalAlpha = p;
    c.fillStyle = 'rgba(8,11,17,0.85)'; para(c, x, y - h / 2, w, h, 0.15); c.fill();
    c.strokeStyle = col; c.lineWidth = i === 2 ? 3 : 5; if (i === 2) c.setLineDash([16, 12]); para(c, x, y - h / 2, w, h, 0.15); c.stroke(); c.setLineDash([]);
    c.fillStyle = col; para(c, x, y - h / 2, 18, h, 0.15); c.fill();
    text(c, name, x + w / 2 + 10, y, { size: i === 2 ? 110 : 140, color: i === 2 ? COL.white : col });
    c.restore();
  });
  wipe(c, 'FOLLOW FOR MORE TOURNAMENTS', W / 2, 1230, t, C.host, { size: 74, color: COL.white, barColor: COL.cyan });
  text(c, 'Independent community tournaments · not affiliated with or endorsed by any game publisher', W / 2, 1370, { size: 24, fam: 'Rajdhani', weight: 600, color: '#6b7385', alpha: P(t, C.host, C.host + 0.4) });
};
// S13 CTA -------------------------------------------------------
S.cta = (c, t) => {
  drawStage(c, t, COL.amber, { beams: 0.8 + 0.4 * P(t, C.part, C.part + 0.2), grid: 0.8 });
  hexPattern(c, t, COL.amber, 0.05);
  const up = E.inOutCubic(P(t, C.follow - 0.2, C.follow + 0.2));
  slam(c, "DON'T BE LATE", W / 2, lerp(700, 330, up), t, C.late, { size: lerp(180, 90, up), color: lerp(0, 1, up) > 0.5 ? COL.dim : COL.white, from: 1.6 });
  const row = (label, ic, y, t0) => { const p = E.outExpo(P(t, t0, t0 + 0.35)); if (p <= 0) return;
    const dim = t > C.part + 0.2 ? 0.55 : 1;
    c.save(); c.globalAlpha = p * dim; c.translate((1 - p) * -200, 0);
    c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 3; para(c, 190, y - 80, 700, 160, 0.15); c.stroke();
    icon(c, ic, 300, y, 1.1, COL.white); text(c, label, 390, y + 4, { size: 150, align: 'left' }); c.restore(); };
  row('FOLLOW', 'follow', 560, C.follow);
  row('SHARE', 'share', 760, C.shareC);
  // dominant CTA
  const p = E.outBack(P(t, C.part, C.part + 0.35), 1.4);
  if (p > 0) {
    const press = t > C.dmC ? 1 - 0.06 * Math.sin(clamp((t - C.dmC) / 0.25) * Math.PI) : 1;
    const pulse = 1 + 0.02 * Math.sin((t - C.part) * 6);
    c.save(); c.translate(W / 2, 1060); c.scale(p * press * pulse, p * press * pulse);
    c.shadowColor = 'rgba(255,179,26,0.7)'; c.shadowBlur = 70; const g = c.createLinearGradient(0, -150, 0, 150); g.addColorStop(0, '#ffc93d'); g.addColorStop(1, '#ff8a00');
    c.fillStyle = g; para(c, -440, -150, 880, 300, 0.12); c.fill(); c.shadowBlur = 0;
    icon(c, 'dm', -330, -30, 1.5, COL.ink);
    text(c, 'DM', -190, -40, { size: 190, align: 'left', color: COL.ink });
    text(c, 'TO PARTICIPATE', 0, 80, { size: 110, color: COL.ink });
    c.restore();
    // ripple on "DM" press
    if (t > C.dmC) { const q = clamp((t - C.dmC) / 0.6); c.save(); c.strokeStyle = `rgba(255,200,80,${1 - q})`; c.lineWidth = 5; para(c, W / 2 - 440 - q * 60, 1060 - 150 - q * 40, 880 + q * 120, 300 + q * 80, 0.12); c.stroke(); c.restore(); }
  }
};
// S14 PAYOFF ----------------------------------------------------
S.payoff = (c, t) => {
  // camera eases back to the hook's opening state so the loop is seamless
  const back = E.inOutCubic(P(t, 48.1, C.end));
  const z = lerp(1.22 + 0.06 * P(t, C.see, 48.1), 1.34, back);
  drawBattle(c, t, { x: lerp(620, 560, back), y: lerp(880, 900, back), z });
  const t1 = 48.25;
  labelBar(c, '27 SEPTEMBER  ·  6:30 PM', W / 2, 300, t, C.see - 0.05, { size: 50, t1 });
  slam(c, 'SEE YOU', W / 2, 520, t, C.see, { size: 280, from: 2, glow: 26, glowColor: 'rgba(255,255,255,0.3)', t1, outDur: 0.2 });
  slam(c, 'IN THE MATCH', W / 2, 720, t, C.inthe, { size: 165, color: COL.amber, from: 1.6, glow: 30, glowColor: 'rgba(255,170,30,0.55)', t1, outDur: 0.2 });
};

// ------------------------------------------------------------ timeline + post
const TL = [
  [0, C.kyunki, S.hook], [C.kyunki, C.match, S.event], [C.match, C.cut4, S.time], [C.cut4, C.entry, S.solo],
  [C.entry, C.agar, S.money], [C.agar, C.abhi, S.fomo], [C.abhi, C.hum, S.phone], [C.hum, C.haan, S.steps],
  [C.haan, C.hum2, S.friends], [C.hum2, C.late, S.network], [C.late, C.see, S.cta], [C.see, 99, S.payoff],
];
// transitions at scene boundaries: type per boundary time
const TRANS = {
  [C.kyunki]: 'whip', [C.match]: 'hud', [C.cut4]: 'black', [C.entry]: 'zoom', [C.agar]: 'whip',
  [C.abhi]: 'none', [C.hum]: 'hud', [C.haan]: 'whip', [C.hum2]: 'zoom', [C.late]: 'hud', [C.see]: 'flash',
};
function sceneAt(t) { for (const s of TL) if (t >= s[0] && t < s[1]) return s; return TL[TL.length - 1]; }
function shake(t) {
  let x = 0, y = 0, r = 0;
  for (const [ti, s] of IMPACTS) { const d = t - ti; if (d < 0 || d > 0.5) continue; const a = s * Math.exp(-d * 11) * 22; x += a * nz(t * 40, ti); y += a * nz(t * 43, ti + 3); r += a * 0.0012 * nz(t * 37, ti + 5); }
  if (t > C.pause && t < C.r500) { const a = 5 * P(t, C.pause, C.r500); x += a * nz(t * 60, 1); y += a * nz(t * 57, 2); }
  return { x, y, r };
}
let BUF, BC, TMP, TC;
function frame(ctx, t) {
  const [, , fn] = sceneAt(t);
  BC.save(); BC.setTransform(1, 0, 0, 1, 0, 0); BC.globalAlpha = 1; BC.globalCompositeOperation = 'source-over'; BC.fillStyle = '#000'; BC.fillRect(0, 0, W, H);
  const sh = shake(t); BC.translate(W / 2 + sh.x, H / 2 + sh.y); BC.rotate(sh.r); BC.scale(1.03, 1.03); BC.translate(-W / 2, -H / 2);
  fn(BC, t); BC.restore();
  // --- transitions
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  let drawn = false;
  for (const [bt, kind] of Object.entries(TRANS)) {
    const T = +bt, d = t - T;
    if (kind === 'whip' && Math.abs(d) < 0.12) {
      const q = d / 0.12; const off = -Math.sign(q || 1) * (1 - Math.abs(q)) * 0 + (d < 0 ? -1 : 1) * Math.pow(1 - Math.abs(q), 2) * 420 * (d < 0 ? 1 : -1);
      const blur = (1 - Math.abs(q)) * 160; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      const n = 8; for (let i = 0; i < n; i++) { ctx.globalAlpha = 1 / (i + 1); ctx.drawImage(BUF, off + (i / (n - 1) - 0.5) * blur, 0); }
      ctx.globalAlpha = 1; drawn = true;
    }
    if (kind === 'zoom' && Math.abs(d) < 0.14) {
      const q = Math.abs(d) / 0.14; const k = 1 + (1 - q) * 0.35; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 6; i++) { const s = k * (1 + i * 0.03 * (1 - q)); ctx.globalAlpha = 1 / (i + 1); ctx.drawImage(BUF, W / 2 - W * s / 2, H / 2 - H * s / 2, W * s, H * s); }
      ctx.globalAlpha = 1; drawn = true;
    }
  }
  if (!drawn) ctx.drawImage(BUF, 0, 0);
  for (const [bt, kind] of Object.entries(TRANS)) {
    const T = +bt, d = t - T;
    if (kind === 'hud' && d > -0.18 && d < 0.1) { // angled bar sweeps across
      const q = (d + 0.18) / 0.28; const x = lerp(-600, W + 600, E.inOutCubic(q));
      ctx.save(); ctx.fillStyle = COL.amber; poly(ctx, [[x - 120, 0], [x + 120, 0], [x - 160, H], [x - 400, H]]); ctx.fill();
      ctx.fillStyle = COL.ink; poly(ctx, [[x - 260, 0], [x - 130, 0], [x - 410, H], [x - 540, H]]); ctx.fill(); ctx.restore();
    }
    if (kind === 'black' && d > -0.04 && d < 0.1) { ctx.fillStyle = `rgba(0,0,0,${d < 0 ? 1 : 1 - d / 0.1})`; ctx.fillRect(0, 0, W, H); }
    if ((kind === 'flash') && d >= 0 && d < 0.12) { ctx.fillStyle = `rgba(255,240,220,${1 - d / 0.12})`; ctx.fillRect(0, 0, W, H); }
  }
  // impact flashes / impact frames
  const flashAt = [[C.ready, 0.9, 'inv'], [C.solo, 0.8, 'glitch'], [C.r500, 1, 'white'], [C.miss, 0.6, 'white'], [47.84, 0.9, 'inv'], [C.part, 0.35, 'white'], [C.bgmi, 0.5, 'white'], [C.d27, 0.35, 'white']];
  for (const [ft, s, kind] of flashAt) {
    const d = t - ft; if (d < 0 || d > 0.2) continue;
    if (kind === 'inv' && d < 2 / FPS) { ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over'; }
    else if (kind === 'glitch' && d < 5 / FPS) {
      TC.clearRect(0, 0, W, H); TC.drawImage(ctx.canvas, 0, 0); const R = rng(Math.floor(t * FPS));
      for (let i = 0; i < 14; i++) { const y = R() * H, h = 20 + R() * 120, dx = (R() - 0.5) * 140; ctx.drawImage(TMP, 0, y, W, h, dx, y, W, h); }
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35; ctx.drawImage(TMP, 14, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    } else { ctx.fillStyle = `rgba(255,248,235,${s * Math.pow(1 - d / 0.2, 2)})`; ctx.fillRect(0, 0, W, H); }
  }
  // grade: gentle teal-shadow / warm-highlight split + vignette + grain
  ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = 'rgba(20,60,80,0.25)'; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(VIG, 0, 0);
  ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.07; ctx.drawImage(GRAIN[Math.floor(t * FPS) % 4], 0, 0, W, H);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

// ------------------------------------------------------------ main
async function main() {
  init();
  [BUF, BC] = mk(W, H); [TMP, TC] = mk(W, H);
  const [cv, ctx] = mk(W, H);
  const a = process.argv.slice(2);
  if (a[0] === '--still') {
    for (let i = 1; i < a.length; i += 2) { frame(ctx, +a[i]); fs.writeFileSync(a[i + 1], cv.encodeSync('png')); }
    return;
  }
  const f0 = +a[0], f1 = +a[1], out = a[2];
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let f = f0; f < f1; f++) {
    frame(ctx, f / FPS);
    if (!ff.stdin.write(cv.data())) await new Promise(r => ff.stdin.once('drain', r));
    if (f % 60 === 0) process.stderr.write(`[${f0}-${f1}] ${f}\n`);
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r));
}
main();
