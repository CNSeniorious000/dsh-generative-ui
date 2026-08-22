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
if grep -qE '^(Error|.*EPERM|.*Cannot find package)' "$out" || [ ! -s "$out" ]; then
  echo "crash  $(head -c 120 "$out" | tr '\n' ' ')"
  exit 2
fi
echo "fence=$(grep -c '```ui4a' "$out") canvas=$(ls "$d"/.dsh/ui4a/canvases/ 2>/dev/null | wc -l | tr -d ' ') bytes=$(wc -c < "$out" | tr -d ' ')  $d"
