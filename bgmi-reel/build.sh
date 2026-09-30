#!/usr/bin/env bash
# Full render: 4 parallel segment workers → concat → mux with mixed audio.
set -e
cd "$(dirname "$0")"
N=1467; K=4; STEP=$(( (N + K - 1) / K ))
node cues.js
for i in $(seq 0 $((K-1))); do
  a=$((i*STEP)); b=$(( (i+1)*STEP )); [ $b -gt $N ] && b=$N
  node render.js $a $b build/seg$i.mp4 2> build/seg$i.log &
done
wait
: > build/list.txt; for i in $(seq 0 $((K-1))); do echo "file 'seg$i.mp4'" >> build/list.txt; done
ffmpeg -y -loglevel error -f concat -safe 0 -i build/list.txt -c copy build/video.mp4
echo "video done"
