#!/usr/bin/env bash
# Master: brickwall limiter → two-pass EBU R128 loudnorm (-12 LUFS, -1 dBTP) → mux with picture.
set -e
cd "$(dirname "$0")"
PRE="alimiter=limit=0.6:attack=2:release=60:level=disabled"
J=$(ffmpeg -hide_banner -i build/mix_raw.wav -af "$PRE,loudnorm=I=-12:TP=-1:LRA=7:print_format=json" -f null - 2>&1 | sed -n '/^{/,/^}/p')
g(){ echo "$J" | python3 -c "import json,sys;print(json.load(sys.stdin)['$1'])"; }
ffmpeg -y -loglevel error -i build/mix_raw.wav -af "$PRE,loudnorm=I=-12:TP=-1:LRA=7:measured_I=$(g input_i):measured_TP=$(g input_tp):measured_LRA=$(g input_lra):measured_thresh=$(g input_thresh):offset=$(g target_offset):linear=true,aresample=48000" -c:a pcm_s16le build/mix_master.wav
ffmpeg -y -loglevel error -i build/video.mp4 -i build/mix_master.wav -map 0:v -map 1:a \
  -c:v libx264 -preset slow -crf 17 -profile:v high -pix_fmt yuv420p -movflags +faststart \
  -vf "eq=contrast=1.03:saturation=1.05" -c:a aac -b:a 256k -shortest ../BGMI_Tournament_Reel_1080x1920.mp4
echo mastered
