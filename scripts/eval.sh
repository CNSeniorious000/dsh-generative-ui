#!/usr/bin/env bash
# Run one prompt in a throwaway workspace and report its shape.
# Reports `crash` rather than a zero when the run never reached a model — the two are
# indistinguishable by fence count alone, and a zero that was really a crash has been
# mistaken for a refuted prompt rule three times.
set -u
prompt=$1; seed=${2:-/dev/null}
d=$(mktemp -d)
# `"$seed"/*` silently omits dotfiles, and a .env or .gitignore fixture is usually the point.
[ -d "$seed" ] && cp -R "$seed"/. "$d"/
# DSH_HOME can point at an isolated home with a different default model — used to keep
# measuring when the primary account runs out of balance, and to compare models.
( cd "$d" && dsh --profile headless "$prompt" > o.txt 2>&1 )
out="$d/o.txt"
# Tool calls live in the session transcript, not the reply — the visualisation rule
# ("this block, not a tool") is invisible without them.
# The session dir is the workdir with slashes turned to dashes and wrapped in `--`, but the
# path has been through /private, so match on the trailing mktemp name instead of rebuilding it.
sess=$(ls -td "${DSH_HOME:-$HOME/.dsh}/sessions/"*"$(basename "$d")--"/session-* 2>/dev/null | head -1)
# `name` sits inside `data`, well past the first `}` — grep the whole record, take the last name.
calls=$(zstd -dc "$sess/session.jsonl.zstd" 2>/dev/null \
  | grep -o '"type":"tool/call".*' | grep -o '"name":"[a-z_]*"' | cut -d\" -f4 \
  | sort | uniq -c | awk '{print $2"x"$1}' | tr '\n' ' ')

# A blacklist of known failure strings only catches failures already seen — three of today's
# four were discovered only after their zero had been read as a model judgement. The positive
# test is stronger: no session transcript means the run never reached a model at all.
if [ ! -s "$out" ] || [ -z "$sess" ] || grep -qE '^(Error|dsh: (QUOTA|RATE))' "$out"; then
  echo "crash  $(head -c 120 "$out" | tr '\n' ' ')"
  exit 2
fi
echo "fence=$(grep -c '```ui4a' "$out") canvas=$(ls "$d"/.dsh/ui4a/canvases/ 2>/dev/null | wc -l | tr -d ' ') bytes=$(wc -c < "$out" | tr -d ' ')  tools=[${calls% }]  $d"
