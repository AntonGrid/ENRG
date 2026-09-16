#!/usr/bin/env bash
# ENRG demo recording → clean MP4 with burned-in subtitles.
# Usage:
#   bash process_recording.sh [input.webm] [output.mp4]
# Defaults: input  = ~/Videos/*.webm (most recent), output = ~/Axis-workspace/ENRG/demo/ENRG_demo.mp4
set -e
cd /home/enrg/Axis-workspace/ENRG/demo

IN="${1:-$(ls -t ~/Videos/*.webm 2>/dev/null | head -1)}"
OUT="${2:-/home/enrg/Axis-workspace/ENRG/demo/ENRG_demo.mp4}"

if [ -z "$IN" ] || [ ! -f "$IN" ]; then
  echo "❌ Входной файл не найден. Укажи: bash process_recording.sh /путь/к/видео.webm"
  echo "   Или положи запись в ~/Videos/ и запусти без аргументов."
  exit 1
fi

echo "Вход:  $IN"
echo "Выход: $OUT"

# Trim 0.8s мёртвого хвоста/начала + burn-in субтитры + универсальный H.264/AAC
ffmpeg -y -v error \
  -i "$IN" \
  -vf "subtitles=subtitles.srt:force_style='FontName=DejaVu Sans,FontSize=15,PrimaryColour=&H00FFFFFF,OutlineColour=&H00101010,Outline=1,MarginV=24'" \
  -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart \
  "$OUT"

echo "✅ Готово: $OUT"
echo "   Превью: xdg-open '$OUT'"
