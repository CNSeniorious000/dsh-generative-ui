#!/usr/bin/env bash
# Run one prompt in a throwaway workspace and report its shape.
# Reports `crash` rather than a zero when the run never reached a model — the two are
# indistinguishable by fence count alone, and a zero that was really a crash has been
# mistaken for a refuted prompt rule three times.
set -u
prompt=$1; seed=${2:-/dev/null}
d=$(mktemp -d)
# The profile loads whatever this symlink resolves to. When it is a different checkout, every
# prompt A/B measures an unchanged prompt and reports plausible numbers — a whole afternoon of
# conclusions was lost to it once. Exit 4 rather than measuring the wrong tree.
linked=$(readlink "${DSH_HOME:-$HOME/.dsh}/profiles/headless/node_modules/dsh-generative-ui" 2>/dev/null || true)
here=$(cd "$(dirname "$0")/.." && pwd -P)
if [ -n "$linked" ] && [ "$(cd "$linked" 2>/dev/null && pwd -P)" != "$here" ]; then
  echo "stale  the headless profile loads $linked, not $here" >&2; exit 4
fi
# And it must be built from the current source: `lib/` older than `src/` means the last edit is
# not in what dsh will read. Same failure as the symlink, one step further along — every prompt
# A/B measures the previous prompt, and the numbers look exactly like a rule that did nothing.
if [ -n "$(find "$here/src" -newer "$here/lib/index.js" -name '*.ts' -o -newer "$here/lib/index.js" -name '*.tsx' 2>/dev/null | head -1)" ]; then
  echo "stale  src/ is newer than lib/ — run \`bun run build\`" >&2
  exit 4
fi
# The gateway credential is the third way to measure nothing and not be told. The provider block
# in each eval home reads its key from `apiKeyEnv`, and with that variable unset dsh starts, opens
# a session, and sits there: the process is alive, the connection is open, nothing ever comes back
# and no error is printed. Measured — a whole wave of 72 runs spent its budget this way, five
# workers busy for minutes with zero session files written, which reads exactly like the upstream
# stalling. Same class as the two guards above, so the same treatment: refuse rather than measure.
keyenv=$(grep -oE 'apiKeyEnv: *[A-Z0-9_]+' "${DSH_HOME:-$HOME/.dsh}/settings.yaml" 2>/dev/null | head -1 | awk '{print $2}')
if [ -n "$keyenv" ] && [ -z "${!keyenv:-}" ]; then
  echo "nocreds  \$$keyenv is unset — dsh would open a session and hang with no error" >&2
  exit 4
fi
# `"$seed"/*` silently omits dotfiles, and a .env or .gitignore fixture is usually the point.
[ -d "$seed" ] && cp -R "$seed"/. "$d"/
# A seed may need more than files — `git 历史` wants commits, and a checked-in `.git` would
# nest inside this repo. `setup.sh` runs in the copy, never in the seed.
[ -x "$d/setup.sh" ] && ( cd "$d" && ./setup.sh >/dev/null 2>&1 && rm -f setup.sh )
# DSH_HOME can point at an isolated home with a different default model — used to keep
# measuring when the primary account runs out of balance, and to compare models.
#
# WHICH MODEL TO MEASURE ON. The default eval home runs `macaron-v1-tall`, which is small enough
# that a rule can look like it works when all it did was patch around the model being dim. The
# models dsh actually runs are `macaron-v1-venti`, `macaron-v1-coding-venti` and `glm-5.2`; a rule
# is worth shipping when it holds on those. One home per model, each with its own settings.yaml —
# and settings.yaml must be a REAL FILE there, not the symlink back to the shared home that the
# bootstrap below creates, or editing one home's model silently edits every home's:
#
#   DSH_HOME=~/.dsh-eval-macaron-v1-venti ./scripts/eval.sh "…"
#
# Confirm the run used the model you asked for rather than a silent fallback:
#   zstd -dc "$sess/session.jsonl.zstd" | grep -o '"model":"[^"]*"' | sort -u
#
# It ALSO decides where the session transcript lands, and that is why it defaults to an eval home
# rather than to `~/.dsh`. dsh writes one session per working directory, this script makes a fresh
# `mktemp -d` per run, and the user's sidebar lists them all: a day of measuring left **2,143
# `tmp.XXXXXXXX` conversations** in it against 85 real ones. The eval home is a sibling of the real
# one — same profile, same credentials by symlink — so nothing about the run changes except which
# sidebar the debris lands in.
if [ -z "${DSH_HOME:-}" ]; then
  export DSH_HOME="$HOME/.dsh-eval"
  if [ ! -d "$DSH_HOME/profiles/headless" ]; then
    mkdir -p "$DSH_HOME/profiles"
    cp -R "$HOME/.dsh/profiles/headless" "$DSH_HOME/profiles/" 2>/dev/null || true
    # Symlinked, not copied: credentials rotate, and a stale copy fails as an auth error that
    # looks exactly like a refused rule.
    for f in settings.yaml .credentials.yaml .anonymous-user-id; do
      [ -e "$HOME/.dsh/$f" ] && ln -sf "$HOME/.dsh/$f" "$DSH_HOME/$f"
    done
  fi
fi
# The transcript goes OUTSIDE the workspace. Written as `$d/o.txt` it is a file the model can
# see and edit, and one run in six wrote its card into the very file that measures it.
out=$(mktemp)
# macOS has no timeout(1), so perl carries the alarm. It reports the timeout as an exit code
# rather than dying of the signal: the earlier `exec` form let SIGALRM kill the subshell, and the
# SHELL announces that — `95054 Alarm clock: 14  perl -e …` lands on this script's stderr AHEAD of
# the verdict, so a caller reading the first line gets a job-control message instead of `timeout`.
# Redirecting the subshell does not help; the message comes from the parent. Forking and exiting
# 142 by hand is what keeps the line clean, and the SIGTERM is what stops a timed-out `dsh`
# outliving the run that gave up on it.
( cd "$d" && perl -e '$SIG{ALRM} = sub { kill 15, $p; exit 142 }; alarm shift; $p = fork; if (!$p) { exec @ARGV } waitpid $p, 0; exit $? >> 8' \
    "${EVAL_TIMEOUT:-900}" dsh --profile headless "$prompt" > "$out" 2>&1 )
# A timeout has two very different causes and the verdict alone cannot separate them: the model
# was producing slowly (a machine under load — every timeout so far arrived while a dozen other
# evals were running), or it wedged and produced nothing. Print the bytes it had written and where
# to look, the same way the crash branches do; a verdict with nowhere to go is a verdict nobody
# can act on.
[ $? -eq 142 ] && {
  echo "timeout after ${EVAL_TIMEOUT:-900}s  bytes=$(wc -c < "$out" | tr -d ' ')  $d  reply=$out"
  exit 3
}
# Tool calls live in the session transcript, not the reply — the visualisation rule
# ("this block, not a tool") is invisible without them.
# The session dir is the workdir with slashes turned to dashes and wrapped in `--`, but the
# path has been through /private, so match on the trailing mktemp name instead of rebuilding it.
# dsh exits before the transcript is on disk, so a lookup right after it returns finds nothing and
# the run is reported `crash/nosession` — with a complete reply sitting in `$out`. Measured three
# times in one session, including on two runs whose replies opened with a ui4a fence. Poll briefly
# for the file rather than sleeping: it is usually there within a second, and a run that genuinely
# never reached a model still falls through after the deadline.
sess=""
for _ in $(seq 40); do
  sess=$(ls -td "${DSH_HOME:-$HOME/.dsh}/sessions/"*"$(basename "$d")--"/session-* 2>/dev/null | head -1)
  [ -n "$sess" ] && [ -s "$sess/session.jsonl.zstd" ] && break
  sess=""
  sleep 0.25
done
# `name` sits inside `data`, well past the first `}` — grep the whole record, take the last name.
calls=$(zstd -dc "$sess/session.jsonl.zstd" 2>/dev/null \
  | grep -o '"type":"tool/call".*' | grep -o '"name":"[a-z_]*"' | cut -d\" -f4 \
  | sort | uniq -c | awk '{print $2"x"$1}' | tr '\n' ' ')

# Ask the transcript how the turn ended rather than pattern-matching stdout. dsh writes a
# `turn/end` record whose reason is `completed` on success and `{kind: error, code: …}` when the
# request failed — an upstream 400, an exhausted balance, a refused tool. Three earlier versions
# of this check grepped for error strings and each missed the next failure to come along; this
# one asks the structure. A missing transcript still means the run never reached a model at all.
# Two crash branches, two different causes, and they were printing the same line — so a run that
# plainly produced a card could report `crash` with no way to tell whether the transcript was
# missing or the turn was unfinished, and no path to go and look. Say which, and where.
if [ ! -s "$out" ] || [ -z "$sess" ]; then
  echo "crash/nosession  $(tr '\n' ' ' < "$out" | cut -c1-100)  $d  reply=$out"
  exit 2
fi
# Matched loosely on purpose: `"kind": "completed"` with or without spaces, so the check does
# not turn on dsh's JSON formatting.
if ! zstd -dc "$sess/session.jsonl.zstd" 2>/dev/null | grep -qE '"kind" *: *"completed"'; then
  echo "crash/unfinished  $(tr '\n' ' ' < "$out" | cut -c1-100)  $d  reply=$out  session=$sess"
  exit 2
fi
# A rule that lives in the SKILL can only be measured on a run that loaded it, and a run that did
# not is not evidence about the rule — it is evidence about the trigger layer. The tool list has
# always carried this and it is easy to read past, so say it in one word: `skill=no` is a reason to
# discard the run from a skill-rule measurement, not a result. Three separate conclusions were
# written from runs that never read the rule they were testing before this line existed.
skill=$(printf %s "$calls" | grep -q 'skillx' && echo yes || echo no)
echo "skill=$skill fence=$(grep -c '```ui4a' "$out") canvas=$(ls "$d"/.dsh/ui4a/canvases/ 2>/dev/null | wc -l | tr -d ' ') bytes=$(wc -c < "$out" | tr -d ' ')  tools=[${calls% }]  $d  reply=$out"
