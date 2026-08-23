#!/bin/zsh
# Does a prompt that SHOULD produce a card produce one?
#
# The nine trigger rules are the only ones with nothing behind them — a screen asks whether a card
# is wrong, and these ask whether there should have been a card at all. The only way to answer is
# to run the prompt and count fences.
#
# Not part of `bun run check`: each case is a real model turn, minutes each.
#
#     zsh scripts/triggers.sh            # every case
#     zsh scripts/triggers.sh 换算       # only cases whose rule or prompt matches
set -u
d=${0:a:h}
filter=${1:-}
hits=0; misses=0; failed=0
while IFS='|' read -r rule prompt; do
  [[ -z "$rule" || "$rule" == \#* ]] && continue
  [[ -n "$filter" && "$rule$prompt" != *"$filter"* ]] && continue
  out=$(zsh "$d/eval.sh" "$prompt" 2>&1) || { printf '%-34s %s\n' "CRASH" "$prompt"; failed=$((failed+1)); continue }
  # A canvas counts: the rules ask for an interface, not for a fence specifically.
  fence=$(print -r -- "$out" | grep -o 'fence=[0-9]*' | cut -d= -f2)
  canvas=$(print -r -- "$out" | grep -o 'canvas=[0-9]*' | cut -d= -f2)
  if (( fence + canvas > 0 )); then printf 'card    %-30s %s\n' "${rule:0:30}" "$prompt"; hits=$((hits+1))
  else printf 'PROSE   %-30s %s\n' "${rule:0:30}" "$prompt"; misses=$((misses+1)); fi
done < "$d/trigger-cases.txt"
echo
echo "$hits card(s), $misses prose, $failed crashed"
(( misses > 0 )) && exit 1
exit 0
