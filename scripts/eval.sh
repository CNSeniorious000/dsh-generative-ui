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
( cd "$d" && dsh --profile headless "$prompt" > o.txt 2>&1 )
out="$d/o.txt"
# QUOTA/rate-limit lines are short, well-formed, and not from the model — they must not read as a zero.
if grep -qE '^(Error|dsh: (QUOTA|RATE)|.*EPERM|.*Cannot find package)' "$out" || [ ! -s "$out" ]; then
  echo "crash  $(head -c 120 "$out" | tr '\n' ' ')"
  exit 2
fi
# Tool calls live in the session transcript, not the reply — the visualisation rule
# ("this block, not a tool") is invisible without them.
# The session dir is the workdir with slashes turned to dashes and wrapped in `--`, but the
# path has been through /private, so match on the trailing mktemp name instead of rebuilding it.
sess=$(ls -td "$HOME/.dsh/sessions/"*"$(basename "$d")--"/session-* 2>/dev/null | head -1)
calls=""
# `name` sits inside `data`, well past the first `}` — grep the whole record, take the last name.
[ -n "$sess" ] && calls=$(zstd -dc "$sess/session.jsonl.zstd" 2>/dev/null \
  | grep -o '"type":"tool/call".*' | grep -o '"name":"[a-z_]*"' | cut -d\" -f4 \
  | sort | uniq -c | awk '{print $2"x"$1}' | tr '\n' ' ')

echo "fence=$(grep -c '```ui4a' "$out") canvas=$(ls "$d"/.dsh/ui4a/canvases/ 2>/dev/null | wc -l | tr -d ' ') bytes=$(wc -c < "$out" | tr -d ' ')  tools=[${calls% }]  $d"
