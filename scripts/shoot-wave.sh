#!/bin/bash
# Extract every card a wave produced and shoot it at 320/440/720 in both themes.
#
# One harness per (card, theme) on a random high port: the harness binds one card at start-up, and
# the theme is read from THEME at that moment too, so a single long-lived server cannot cover the
# grid. Ports are randomised because the previous runner reused one and a lingering process from
# the last wave served the last wave's card under this wave's filename — a screenshot that looks
# fine and belongs to nothing.
set -u
W=$(printf "w%03d" "$1")
REPO=$(cd "$(dirname "$0")/.." && pwd)
ROOT=${WAVE_ROOT:-/tmp/genui-loop}
DIR=$ROOT/waves/$W
CARDS=$ROOT/cards/$W; SHOTS=$ROOT/shots/$W
mkdir -p "$CARDS" "$SHOTS"

for f in "$DIR"/*.txt; do
  [ -e "$f" ] || continue
  tag=$(basename "$f" .txt)
  reply=$(grep -o 'reply=[^ ]*' "$f" | head -1 | cut -d= -f2)
  [ -n "$reply" ] && [ -f "$reply" ] || continue
  python3 "$REPO/scripts/extract-fences.py" "$reply" "$CARDS" "$tag" >/dev/null 2>&1
  # A canvas is a FILE, not a fence: counting fences alone misses it entirely, which this project
  # has recorded twice as a wrong conclusion.
  ws=$(grep -o '/var/folders[^ ]*' "$f" | head -1)
  if [ -n "$ws" ]; then
    for c in "$ws"/.dsh/ui4a/canvases/*.ui4a.tsx; do
      [ -e "$c" ] && cp "$c" "$CARDS/$tag-canvas-$(basename "$c")"
    done
  fi
done

n=$(ls "$CARDS"/*.tsx 2>/dev/null | wc -l | tr -d ' ')
echo "$W: $n cards extracted"
[ "$n" -eq 0 ] && exit 0

for card in "$CARDS"/*.tsx; do
  # `.ui4a.tsx` means `basename .tsx` leaves `.ui4a` on the stem — harmless in a filename, fatal
  # when it is reassembled into a path. Strip the whole suffix chain, and pass $card through
  # untouched to the harness.
  base=$(basename "$card"); base=${base%.tsx}; base=${base%.ui4a}
  for theme in light dark; do
    port=$(( 30000 + RANDOM % 20000 ))
    THEME=$theme nohup bun "$REPO/scripts/surface-harness.ts" "$port" "$card" >$ROOT/h.log 2>&1 &
    hp=$!
    # `-f` is not optional: without it curl exits 0 on a refused connection too, so `&& break`
    # fires on the first attempt, the shot runs against nothing, and the wave reports 0 screenshots
    # with no error anywhere. Cost an hour of looking at the wrong half of the pipeline.
    up=0
    for _ in $(seq 60); do curl -sf -o /dev/null "http://127.0.0.1:$port/surface.js" && { up=1; break; }; sleep 0.25; done
    [ "$up" = 1 ] || { echo "  harness never came up on $port for $base ($theme)"; kill $hp 2>/dev/null; continue; }
    bun "$REPO/scripts/shot-card.mjs" "$port" "$SHOTS/$base.$theme" 2>&1 | grep -E "OVERFLOW|CRUSHED|pageerror|WARN" | sed "s|^|  $base.$theme |" | tee -a "$SHOTS/defects.log"
    kill $hp 2>/dev/null
  done
done
echo "$W: $(ls "$SHOTS"/*.png 2>/dev/null | wc -l | tr -d ' ') screenshots"
