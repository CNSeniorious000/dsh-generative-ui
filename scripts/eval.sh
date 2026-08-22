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
# A seed may need more than files — `git 历史` wants commits, and a checked-in `.git` would
# nest inside this repo. `setup.sh` runs in the copy, never in the seed.
[ -x "$d/setup.sh" ] && ( cd "$d" && ./setup.sh >/dev/null 2>&1 && rm -f setup.sh )
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

# Ask the transcript how the turn ended rather than pattern-matching stdout. dsh writes a
# `turn/end` record whose reason is `completed` on success and `{kind: error, code: …}` when the
# request failed — an upstream 400, an exhausted balance, a refused tool. Three earlier versions
# of this check grepped for error strings and each missed the next failure to come along; this
# one asks the structure. A missing transcript still means the run never reached a model at all.
if [ ! -s "$out" ] || [ -z "$sess" ]; then
  echo "crash  $(head -c 120 "$out" | tr '\n' ' ')"
  exit 2
fi
# Matched loosely on purpose: `"kind": "completed"` with or without spaces, so the check does
# not turn on dsh's JSON formatting.
if ! zstd -dc "$sess/session.jsonl.zstd" 2>/dev/null | grep -qE '"kind" *: *"completed"'; then
  echo "crash  $(head -c 120 "$out" | tr '\n' ' ')"
  exit 2
fi
echo "fence=$(grep -c '```ui4a' "$out") canvas=$(ls "$d"/.dsh/ui4a/canvases/ 2>/dev/null | wc -l | tr -d ' ') bytes=$(wc -c < "$out" | tr -d ' ')  tools=[${calls% }]  $d"
