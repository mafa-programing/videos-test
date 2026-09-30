// Master timeline. Every time below (seconds) was taken from word-level
// alignment of the supplied voiceover (sherpa-onnx zipformer token stamps),
// so each visual/sound event lands on the syllable it illustrates.
const C = {
  // S1 hook — "BGMI players, ready ho jao!"
  bgmi: 0.04, players: 0.92, ready: 1.44, hojao: 1.80,
  // S2 event — "Kyunki 27 September ko ... first BGMI tournament"
  kyunki: 2.30, d27: 2.62, sept: 3.04, first: 4.48, tourn: 4.68,
  // S3 time — "Aur match start hoga shaam 6:30 baje"
  match: 6.16, start: 6.76, shaam: 7.36, time630: 7.56, tees: 8.12, baje: 8.60,
  // S4 differentiator — "Sabse khas baat — solo match ... skills par depend"
  cut4: 9.22, khas: 9.32, yeh: 10.40, solo: 10.92, matchS: 11.52, skill: 12.60, depend: 12.96,
  // S5 money — "Entry fee ... ₹50 ... winning amount ... ₹500"
  entry: 13.92, r50: 14.48, winning: 16.00, pause: 16.85, r500: 17.60,
  // S6 FOMO — "To agar tum BGMI khelte ho, yeh opportunity miss mat karna"
  agar: 18.76, bgmiQ: 19.52, opp: 20.80, miss: 21.32,
  // S7 calendar — "Abhi calendar mein 27 September, 6:30 PM ka reminder laga lo"
  abhi: 22.36, s27: 23.24, s630: 24.12, reminder: 25.36,
  // S8 DM — "aur registration ke liye humen DM karo"
  reg: 26.08, dm: 27.36,
  // S9 rules — "Hum tumhe ... rules aur regulations send kar denge"
  hum: 28.12, rules: 29.04, send: 30.40,
  // S10 share — "Aur haan, apne BGMI wale doston ko yeh reel zaroor share karna"
  haan: 31.64, bgmiF: 32.80, reel: 34.36, share: 34.84,
  // S11 friend — "kyunki ho sakta hai next winner tumhara hi dost ho"
  kyunki2: 35.36, next: 36.12, dost: 36.88,
  // S12 ecosystem — "Hum BGMI, Free Fire aur bhi kaafi games ke tournaments host..."
  hum2: 37.68, bgmiN: 38.00, ff: 39.12, more: 39.64, host: 40.44,
  // S13 CTA — "To late mat karo, follow karo, reel share karo, ... DM karo"
  late: 41.92, follow: 43.20, shareC: 44.20, part: 44.96, dmC: 46.28,
  // S14 payoff — "See you in the match!"
  see: 47.00, inthe: 47.40, matchEnd: 47.64, end: 48.90,
};

// Camera-shake / impact accents: [time, strength]
const IMPACTS = [
  [C.bgmi, 0.7], [C.players, 0.45], [C.ready, 1.0], [C.hojao, 0.5],
  [C.d27, 0.55], [C.sept, 0.35], [C.tourn, 0.45], [C.baje, 0.3],
  [C.solo, 1.1], [C.depend, 0.4], [C.r50, 0.2], [C.r500, 1.4],
  [C.miss, 0.8], [C.dm, 0.2], [C.kyunki2, 0.6], [C.dost, 0.4],
  [C.bgmiN, 0.3], [C.late, 0.4], [C.part, 0.8], [C.see, 0.6], [47.84, 1.1],
];

// Gunfire (muzzle flash + tracer) timestamps in the gameplay plates
const SHOTS = [0.0, 0.09, 0.18, 0.27, 0.92, 1.44, 1.98, 2.06, 2.14, 47.0, 47.1, 47.2, 47.84];

// Sound-design cue sheet consumed by sfx.py
const SFX = [
  { t: 0.0, k: 'burst', g: 0.55 }, { t: C.bgmi, k: 'impact', g: 0.7 },
  { t: C.players, k: 'shot', g: 0.35 }, { t: C.players, k: 'hit', g: 0.45 },
  { t: C.ready - 0.25, k: 'rev', g: 0.4 }, { t: C.ready, k: 'impact', g: 1.0 },
  { t: C.hojao, k: 'hit', g: 0.5 }, { t: 1.98, k: 'burst', g: 0.35 },
  { t: C.kyunki - 0.12, k: 'whoosh', g: 0.6 },
  { t: C.d27, k: 'impact', g: 0.6 }, { t: C.sept, k: 'hit', g: 0.45 },
  { t: C.first, k: 'tick', g: 0.4 }, { t: C.tourn, k: 'impact', g: 0.55 },
  { t: C.match - 0.1, k: 'swoosh', g: 0.35 }, { t: C.start, k: 'tick', g: 0.35 },
  { t: C.time630, k: 'roll', g: 0.35 }, { t: C.baje, k: 'hit', g: 0.45 },
  { t: C.cut4, k: 'drop', g: 0.5 }, { t: C.yeh, k: 'riser', g: 0.55, d: C.solo - C.yeh },
  { t: C.solo, k: 'impact', g: 1.1 }, { t: C.solo, k: 'glitch', g: 0.45 },
  { t: C.matchS, k: 'tick', g: 0.35 }, { t: C.skill, k: 'lock', g: 0.45 },
  { t: C.depend, k: 'hit', g: 0.5 },
  { t: C.entry - 0.12, k: 'whoosh', g: 0.5 }, { t: C.r50, k: 'coin', g: 0.35 },
  { t: C.winning, k: 'tick', g: 0.35 },
  { t: C.pause - 0.3, k: 'riser', g: 0.75, d: C.r500 - C.pause + 0.3 },
  { t: C.r500, k: 'mega', g: 1.25 }, { t: C.r500 + 0.05, k: 'coinburst', g: 0.45 },
  { t: C.agar - 0.12, k: 'whoosh', g: 0.5 }, { t: C.bgmiQ, k: 'lock', g: 0.3 },
  { t: C.miss, k: 'sniper', g: 0.8 }, { t: C.miss, k: 'impact', g: 0.55 },
  { t: C.abhi - 0.14, k: 'swoosh', g: 0.5 }, { t: C.s27, k: 'tap', g: 0.5 },
  { t: C.s630, k: 'tick', g: 0.4 }, { t: C.reminder, k: 'toggle', g: 0.5 },
  { t: C.reminder + 0.2, k: 'ding', g: 0.5 },
  { t: C.reg, k: 'swoosh', g: 0.4 }, { t: C.dm, k: 'send', g: 0.55 },
  { t: C.hum, k: 'whoosh', g: 0.35 }, { t: C.hum + 0.1, k: 'tick', g: 0.35 },
  { t: C.rules, k: 'tick', g: 0.4 }, { t: C.send, k: 'tick', g: 0.45 }, { t: C.send, k: 'ding', g: 0.3 },
  { t: C.haan - 0.12, k: 'whoosh', g: 0.55 }, { t: C.bgmiF, k: 'hit', g: 0.35 },
  { t: C.share - 0.05, k: 'send', g: 0.55 }, { t: C.share + 0.35, k: 'ding', g: 0.35 },
  { t: C.kyunki2, k: 'impact', g: 0.7 }, { t: C.next, k: 'tick', g: 0.3 },
  { t: C.next + 0.3, k: 'tick', g: 0.3 }, { t: C.next + 0.55, k: 'tick', g: 0.3 },
  { t: C.dost, k: 'lock', g: 0.55 },
  { t: C.hum2 - 0.12, k: 'whoosh', g: 0.5 }, { t: C.bgmiN, k: 'hit', g: 0.45 },
  { t: C.ff, k: 'hit', g: 0.4 }, { t: C.more, k: 'hit', g: 0.35 }, { t: C.host, k: 'tick', g: 0.35 },
  { t: C.late - 0.1, k: 'whoosh', g: 0.5 }, { t: C.late, k: 'hit', g: 0.5 },
  { t: C.follow, k: 'hit', g: 0.5 }, { t: C.shareC, k: 'hit', g: 0.5 },
  { t: C.part, k: 'impact', g: 0.85 }, { t: C.dmC, k: 'tap', g: 0.5 },
  { t: C.see - 0.5, k: 'riser', g: 0.6, d: 0.5 }, { t: C.see, k: 'burst', g: 0.55 }, { t: C.see, k: 'impact', g: 0.6 },
  { t: 47.84, k: 'shot', g: 0.8 }, { t: 47.84, k: 'mega', g: 0.7 },
];

// Music-bed arrangement: [start, end, intensity 0..3]
const BED = [
  [0.0, 2.3, 3], [2.3, 9.22, 1], [9.22, 10.92, 0], [10.92, 13.92, 2], [13.92, 16.85, 1],
  [16.85, 17.6, -1], [17.6, 22.36, 3], [22.36, 31.64, 1], [31.64, 41.92, 2], [41.92, 47.0, 2.5],
  [47.0, 48.9, 3],
];

module.exports = { C, IMPACTS, SHOTS, SFX, BED };
if (require.main === module) require('fs').writeFileSync(__dirname + '/cues.json', JSON.stringify({ C, IMPACTS, SHOTS, SFX, BED }, null, 1));
