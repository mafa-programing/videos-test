# BGMI Tournament Reel: source project

`../BGMI_Tournament_Reel_1080x1920.mp4` is the finished Reel: 1080×1920, 30 fps, 48.9 s, H.264 + AAC 256k, −11.9 LUFS.
`../BGMI_Reel_cover.jpg` is the suggested cover frame (₹50 → ₹500 reveal).

## Pipeline
| Step | Tool | File |
|---|---|---|
| Word-level timing of the voiceover | sherpa-onnx zipformer (token timestamps) | → `cues.js` |
| Master timeline and cue sheet (visual + SFX + music arrangement) | — | `cues.js` |
| Procedural visuals (silhouette battle plates, scope, broadcast graphics, phone UI, motion system, transitions, grade, grain) | Node + @napi-rs/canvas (Skia) | `render.js` |
| Synthesised SFX + 120 BPM hybrid bed, sidechain-ducked under the VO | Python / numpy / scipy | `sfx.py` |
| Limiter → two-pass EBU R128 loudnorm (−12 LUFS / −1 dBTP) → mux | FFmpeg | `master.sh` |

Rebuild: `npm i && node cues.js && ./build.sh && python3 sfx.py voiceover.mp3 && ./master.sh`
Preview single frames: `node render.js --still 17.8 out.png`

## Swapping in real gameplay
Each gameplay moment is its own plate function in `render.js` (`drawBattle`, `S.fomo` scope, `S.solo`).
To use real BGMI clips, cut them in Resolve/HyperFrames under the same cue times from `cues.js`
and use the graphics layer as an overlay. Music and SFX stems are written to `build/stem_*.wav`.

## Edit decision list (seconds are VO-aligned)
0.00 Hook: mid-firefight, BGMI (0.04) → PLAYERS (0.92) → negative impact frame + READY (1.44) → HO JAO? (1.80)
2.30 Whip → broadcast frame: 27 (2.62) · SEPTEMBER (3.04) · OUR FIRST (4.48) · BGMI TOURNAMENT (4.68)
6.16 HUD wipe → date migrates up; MATCH STARTS (6.76); slot-roll 06:30 (7.56) · PM (8.60)
9.22 Black breath → "SABSE KHAS BAAT…"; world falls away, spotlight, hostiles close in; riser → SOLO + glitch (10.92) · MATCH (11.52) · YOUR SKILL + reticle lock (12.60) · DECIDES. (12.96)
13.92 Zoom → ENTRY FEE · ₹50 restrained (14.48) · WINNING AMOUNT (16.00) · 0.75 s tension/riser in the VO pause · ₹500 detonation (17.60)
18.76 Whip → sniper scope hunts: BGMI KHELTE HO? (19.52) · THIS IS FOR YOU (20.8) · DON'T MISS … IT. + sniper shot (21.32)
22.36 Phone: calendar → 27 (23.24) → 6:30 PM (24.12) → toggle + REMINDER SET (25.36)
26.08 Swipe to DM: DM TO REGISTER, typed message sent (27.36)
28.12 HUD wipe → 3-step: DM US → RULES + REGULATIONS (29.04) → REGISTER (30.40)
31.64 Whip → split screen: SEND THIS TO YOUR BGMI FRIEND · share plane flies across (34.84)
35.36 VS slam: WHO'S TAKING THE ₹500? · reticle hops YOU ↔ FRIEND, locks NEXT WINNER? (36.88) · "TAG THE FRIEND YOU'D BEAT"
37.68 Zoom → ecosystem: BGMI (38.0) · FREE FIRE (39.12) · + MORE GAMES (39.64) · FOLLOW FOR MORE TOURNAMENTS (40.44) + non-affiliation line
41.92 HUD wipe → DON'T BE LATE · FOLLOW (43.2) · SHARE (44.2) · DM TO PARTICIPATE slam (44.96), press (46.28)
47.00 Flash → back to the opening plate: SEE YOU IN THE MATCH · final shot (47.84) · camera settles to frame-0 framing for a seamless loop
