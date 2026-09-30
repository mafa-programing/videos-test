"""Synthesised sound design + music bed for the BGMI reel.

Reads cues.json (written by `node cues.js`) and the voiceover, renders every
SFX and a sidechain-ducked music bed procedurally, and writes build/mix.wav.
"""
import json, subprocess, sys
import numpy as np
from scipy import signal

SR = 48000
ROOT = __file__.rsplit('/', 1)[0] or '.'
cues = json.load(open(f'{ROOT}/cues.json'))
VO = sys.argv[1]
DUR = cues['C']['end']
N = int(DUR * SR)
rng = np.random.default_rng(7)

def load(path):
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).copy()

def tl(d): return np.arange(int(d * SR)) / SR
def noise(d): return rng.standard_normal(int(d * SR))
def bp(x, lo, hi, o=2): return signal.sosfilt(signal.butter(o, [lo, hi], 'band', fs=SR, output='sos'), x)
def lp(x, f, o=2): return signal.sosfilt(signal.butter(o, f, 'low', fs=SR, output='sos'), x)
def hp(x, f, o=2): return signal.sosfilt(signal.butter(o, f, 'high', fs=SR, output='sos'), x)
def env(d, a, r):
    t = tl(d); e = np.minimum(1, t / max(a, 1e-4)) * np.exp(-np.maximum(0, t - a) / r); return e
def sweep(f0, f1, d, curve='exp'):
    t = tl(d); f = f0 * (f1 / f0) ** (t / d) if curve == 'exp' else f0 + (f1 - f0) * t / d
    return np.sin(2 * np.pi * np.cumsum(f) / SR)
def st(x, pan=0.0):  # mono → stereo, pan -1..1
    l, r = np.sqrt((1 - pan) / 2), np.sqrt((1 + pan) / 2); return np.stack([x * l * 1.414, x * r * 1.414], 1)
def verb(x, d=1.2, mix=0.25):  # cheap stereo reverb: filtered decaying noise IR
    ir_l = noise(d) * np.exp(-tl(d) / (d / 5)); ir_r = noise(d) * np.exp(-tl(d) / (d / 5))
    ir_l, ir_r = lp(ir_l, 6000), lp(ir_r, 6000)
    ir_l /= np.abs(ir_l).sum() ** 0.5 * 30; ir_r /= np.abs(ir_r).sum() ** 0.5 * 30
    wl = signal.fftconvolve(x, ir_l)[:len(x) + int(d * SR)]; wr = signal.fftconvolve(x, ir_r)[:len(x) + int(d * SR)]
    dry = np.pad(x, (0, len(wl) - len(x)))
    return np.stack([dry + wl * mix * 8, dry + wr * mix * 8], 1)

# ---------------------------------------------------------------- sound kit
def s_impact(g=1, big=False):
    d = 2.2 if big else 1.2
    sub = sweep(120 if big else 110, 34, d) * env(d, 0.004, 0.45 if big else 0.28)
    body = lp(noise(d), 900) * env(d, 0.002, 0.12) * 0.9
    crack = hp(noise(0.05), 2500) * env(0.05, 0.001, 0.012) * 0.8
    x = sub * 1.1 + body; x[:len(crack)] += crack
    return verb(x * g, 1.6 if big else 1.0, 0.22)
def s_hit(g=1):
    d = 0.5; x = sweep(160, 50, d) * env(d, 0.002, 0.09) + lp(noise(d), 1800) * env(d, 0.001, 0.05) * 0.6
    x[:2400] += hp(noise(0.05), 3000)[:2400] * env(0.05, 0.001, 0.01) * 0.5
    return verb(x * g, 0.7, 0.18)
def s_mega(g=1):
    x = s_impact(1.2, big=True)
    d = 2.4; t = tl(d)
    stab = sum(np.sign(np.sin(2 * np.pi * f * t)) * a for f, a in [(55, 1), (82.4, 0.7), (110, 0.6), (164.8, 0.35)])
    stab = lp(stab, 1400) * env(d, 0.005, 0.5) * 0.28
    shimmer = hp(noise(d), 6000) * env(d, 0.01, 0.35) * 0.25
    y = st(stab + shimmer); n = min(len(x), len(y)); x[:n] += y[:n]
    return x * g
def s_whoosh(g=1, d=0.38, bright=1.0):
    t = tl(d); n = noise(d); out = np.zeros_like(n)
    fc = 500 * bright * (6 ** np.sin(np.pi * t / d))
    for i in range(0, len(n), 512):  # time-varying bandpass, block-wise
        f = fc[i]; seg = n[max(0, i - 2048):i + 512]
        out[i:i + 512] = bp(seg, f * 0.6, min(f * 1.6, SR / 2 - 100))[-len(n[i:i + 512]):]
    e = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 1.5
    x = out * e * 1.2 * g
    pan = np.linspace(-0.8, 0.8, len(x))
    return np.stack([x * np.sqrt((1 - pan) / 2) * 1.414, x * np.sqrt((1 + pan) / 2) * 1.414], 1)
def s_rev(g=1):
    d = 0.3; x = lp(noise(d), 3000) * (tl(d) / d) ** 3; return st(x * g * 0.8)
def s_riser(g=1, d=1.0):
    t = tl(d); k = (t / d)
    x = hp(noise(d), 800) * k ** 2 * 0.5 + sweep(180, 900, d) * k ** 2.5 * 0.35 + sweep(90, 450, d) * k ** 2 * 0.25
    x *= np.minimum(1, (d - t) / 0.01 + 0.0)  # hard stop
    return st(x * g)
def s_tick(g=1, f=2400):
    d = 0.06; x = np.sin(2 * np.pi * f * tl(d)) * env(d, 0.0005, 0.012) + hp(noise(d), 4000) * env(d, 0.0003, 0.004) * 0.4
    return st(x * g * 0.8)
def s_tap(g=1): return s_tick(g, 1300)
def s_lock(g=1):
    x = np.zeros((int(0.3 * SR), 2)); a = s_tick(1, 2600); x[:len(a)] += a; x[int(0.06 * SR):int(0.06 * SR) + len(a)] += a
    b = np.sin(2 * np.pi * 1760 * tl(0.12)) * env(0.12, 0.002, 0.05) * 0.6; x[int(0.12 * SR):int(0.12 * SR) + len(b)] += st(b)
    return x * g
def s_toggle(g=1):
    x = s_tick(0.8, 1800); y = st(sweep(200, 90, 0.08) * env(0.08, 0.001, 0.03) * 0.8); n = min(len(x), len(y)); x[:n] += y[:n]; return x * g
def s_ding(g=1):
    d = 0.9; t = tl(d)
    x = sum(np.sin(2 * np.pi * f * t) * a * np.exp(-t / dc) for f, a, dc in [(1318.5, 1, 0.35), (2637, 0.3, 0.15), (3950, 0.12, 0.08)])
    y = np.zeros_like(x); o = int(0.09 * SR)
    y[o:] = sum(np.sin(2 * np.pi * f * t[:-o]) * a * np.exp(-t[:-o] / dc) for f, a, dc in [(1760, 1, 0.45), (3520, 0.3, 0.18)])
    return verb((x + y) * 0.35 * g, 0.8, 0.2)
def s_send(g=1):
    w = s_whoosh(0.7, 0.22, 2.2); b = st(sweep(700, 1600, 0.09) * env(0.09, 0.003, 0.03) * 0.5)
    x = np.zeros((len(w) + len(b), 2)); x[:len(w)] += w; x[int(0.15 * SR):int(0.15 * SR) + len(b)] += b; return x * g
def s_coin(g=1):
    d = 0.5; t = tl(d); x = sum(np.sin(2 * np.pi * f * t) * np.exp(-t / 0.12) * a for f, a in [(2093, 1), (3136, 0.6), (4186, 0.35)])
    return st(x * 0.3 * g)
def s_coinburst(g=1):
    d = 1.2; x = np.zeros((int(d * SR) + SR, 2))
    for _ in range(26):
        o = int(abs(rng.normal(0, 0.25)) * SR); f = rng.uniform(2500, 6000); dd = 0.2; tt = tl(dd)
        p = np.sin(2 * np.pi * f * tt) * np.exp(-tt / 0.04) * rng.uniform(0.1, 0.3); x[o:o + len(p)] += st(p, rng.uniform(-0.8, 0.8))
    return x * g
def s_glitch(g=1):
    d = 0.18; x = noise(d); x = np.round(x * 3) / 3; x = bp(x, 400, 5000)
    gate = (np.sin(2 * np.pi * 40 * tl(d)) > 0).astype(float); return st(x * gate * 0.35 * g)
def s_drop(g=1):
    d = 1.4; x = sweep(70, 30, d) * env(d, 0.01, 0.4) + lp(noise(d), 300) * env(d, 0.005, 0.3) * 0.5; return verb(x * g, 1.2, 0.3)
def s_roll(g=1):
    x = np.zeros((int(0.8 * SR), 2)); tk = s_tick(0.5, 3000)
    for i in range(14): o = int((0.55 * (i / 14) ** 0.7) * SR); x[o:o + len(tk)] += tk
    return x * g
def s_shot(g=1, tail=0.8):
    d = 0.4; body = lp(noise(d), 4000) * env(d, 0.0005, 0.03); thump = sweep(140, 55, d) * env(d, 0.001, 0.05)
    crack = hp(noise(0.02), 3000) * env(0.02, 0.0002, 0.004)
    x = body * 0.8 + thump * 0.8; x[:len(crack)] += crack * 0.7
    return verb(x * g, tail, 0.35)
def s_burst(g=1):
    x = np.zeros((int(1.4 * SR), 2))
    for i, o in enumerate([0, 0.09, 0.18, 0.27]):
        s = s_shot(0.8 - i * 0.05, 0.6); oo = int(o * SR); x[oo:oo + len(s)] += s[:len(x) - oo]
    return x * g
def s_sniper(g=1):
    s = s_shot(1.3, 1.8); e = s * 0.25; x = np.zeros((len(s) + int(0.35 * SR), 2)); x[:len(s)] += s; x[int(0.33 * SR):int(0.33 * SR) + len(e)] += lp(e.T, 2000).T
    return x * g

KIT = {'impact': s_impact, 'hit': s_hit, 'mega': s_mega, 'whoosh': s_whoosh, 'swoosh': lambda g: s_whoosh(g, 0.26, 1.8),
       'rev': s_rev, 'riser': s_riser, 'tick': s_tick, 'tap': s_tap, 'lock': s_lock, 'toggle': s_toggle, 'ding': s_ding, 'send': s_send,
       'coin': s_coin, 'coinburst': s_coinburst, 'glitch': s_glitch, 'drop': s_drop, 'roll': s_roll, 'shot': s_shot,
       'burst': s_burst, 'sniper': s_sniper}

def place(buf, x, t):
    o = int(t * SR)
    if o < 0: x = x[-o:]; o = 0
    n = min(len(x), len(buf) - o)
    if n > 0: buf[o:o + n] += x[:n]

# ---------------------------------------------------------------- music bed
def bed():
    out = np.zeros((N, 2)); t = np.arange(N) / SR
    # intensity envelope (smoothed step function)
    inten = np.zeros(N)
    for a, b, v in cues['BED']: inten[int(a * SR):int(b * SR)] = v
    k = int(0.03 * SR); inten = np.convolve(inten, np.ones(k) / k, 'same')
    on = (inten >= 0).astype(float); on = np.convolve(on, np.ones(k) / k, 'same')
    # drone: A1 + E2, band-limited saw-ish, slow movement
    dr = sum(np.sin(2 * np.pi * f * h * t) / h for f in (55, 82.41) for h in range(1, 7)) * 0.16
    dr = lp(dr, 500) * (0.55 + 0.45 * np.sin(2 * np.pi * 0.11 * t)) * on * (0.5 + 0.2 * np.clip(inten, 0, 3))
    out += st(dr)
    beat = 0.5  # 120 BPM, grid starts on the first gunshot
    kick = sweep(150, 42, 0.35) * env(0.35, 0.002, 0.11)
    bass = lp(np.sign(np.sin(2 * np.pi * 55 * tl(0.22))), 400) * env(0.22, 0.003, 0.07) * 0.35
    hat = hp(noise(0.05), 7000) * env(0.05, 0.0005, 0.012) * 0.25
    clap = bp(noise(0.2), 900, 4000) * env(0.2, 0.001, 0.05) * 0.4
    for i in range(int(DUR / (beat / 4)) + 1):
        tt = i * beat / 4; lv = inten[min(int(tt * SR), N - 1)]
        if lv < 0: continue
        if i % 4 == 0 and lv >= 2: place(out, st(kick * 0.9), tt)
        if i % 2 == 0 and lv >= 1: place(out, st(bass * (0.7 + 0.15 * lv)), tt)
        if lv >= 1 and (i % 2 == 1 or lv >= 2.5): place(out, st(hat * (0.5 + 0.2 * lv), 0.3 if i % 2 else -0.3), tt)
        if i % 8 == 4 and lv >= 2.5: place(out, verb(clap, 0.6, 0.3), tt)
    return out

# ---------------------------------------------------------------- mix
vo = load(VO)[:N]
vo = np.pad(vo, ((0, N - len(vo)), (0, 0)))
m = np.abs(vo).mean(1); a = np.exp(-1 / (0.01 * SR)); r = np.exp(-1 / (0.25 * SR))
envv = signal.lfilter([1 - r], [1, -r], signal.lfilter([1 - a], [1, -a], m))
envv = np.clip(envv / (np.percentile(envv, 95) + 1e-9), 0, 1)

sfx = np.zeros((N + 3 * SR, 2))
for c in cues['SFX']:
    fn = KIT[c['k']]
    x = fn(c['g'], d=c['d']) if c['k'] == 'riser' else fn(c['g'])
    place(sfx, x, c['t'])
sfx = sfx[:N]
music = bed()

duck_bed = 1 - 0.6 * envv
duck_sfx = 1 - 0.3 * envv
mix = vo * 1.0 + music * 0.38 * duck_bed[:, None] + sfx * 0.42 * duck_sfx[:, None]
# 2 frame fade at the very end/start keeps the loop click-free
f = int(0.02 * SR); mix[:f] *= np.linspace(0, 1, f)[:, None]; mix[-f:] *= np.linspace(1, 0, f)[:, None]
pk = np.abs(mix).max()  # left un-normalised (float WAV); master.sh limits + loudnorms
out = f'{ROOT}/build/mix_raw.wav'
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-', out], input=mix.astype(np.float32).tobytes(), check=True)
# stems for local re-mixing
for name, x in [('stem_music', music * 0.38), ('stem_sfx', sfx * 0.42)]:
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-', f'{ROOT}/build/{name}.wav'], input=x.astype(np.float32).tobytes(), check=True)
print('mix written', pk)
