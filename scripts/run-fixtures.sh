#!/usr/bin/env bash
# Run every prompt in the "Must" tables of test/eval-fixtures.md N times and print a grid.
# Only those tables: the later sections quote tool names and commands in backticks too.
set -u
runs=${1:-3}
seed=${2:-}
prompts=$(awk '
  /^## (Must stay prose|Must produce UI|Correctness)/ { on=1; next }
  /^## / { on=0 }
  on && /^\| `/ { line=$0; sub(/^\| `/, "", line); sub(/`.*/, "", line); print line }
' test/eval-fixtures.md)

# Run every prompt concurrently — serially this takes longer than a tool timeout.
tmp=$(mktemp -d)
i=0
while IFS= read -r p; do
  [ -z "$p" ] && continue
  i=$((i + 1))
  (
    out=""
    for _ in $(seq 1 "$runs"); do
      r=$(./scripts/eval.sh "$p" $seed 2>&1)
      case "$r" in
        crash*) out="$out C" ;;
        *) f=$(printf %s "$r" | grep -o 'fence=[0-9]*' | cut -d= -f2)
           c=$(printf %s "$r" | grep -o 'canvas=[0-9]*' | cut -d= -f2)
           if [ "${c:-0}" != "0" ]; then out="$out K"; else out="$out $f"; fi ;;
      esac
    done
    printf '%-46s %s\n' "$(printf %s "$p" | cut -c1-44)" "$out" > "$tmp/$(printf %02d "$i")"
  ) &
done <<< "$prompts"
wait
cat "$tmp"/* 2>/dev/null
rm -rf "$tmp"
