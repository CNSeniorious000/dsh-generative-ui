#!/bin/zsh
# Boot dsh once and fail if the plugin's prompt sections did not load.
#
# The prompt is the plugin's whole contribution to a model's behaviour, and it can be complete,
# well-formed, and pinned by two dozen assertions while `dsh` rejects it outright:
#
#   dsh: UNKNOWN: malformed prompt variable reference "{{}}" in section "dsh-generative-ui:inline"
#
# Every test reads the exported string; this is the only thing that PARSES it. One boot, no model
# call worth caring about, and it catches the failure that makes all the other tests meaningless.
# Unlike `smoke`, this cannot follow BUILD_OUTDIR: it boots real dsh, which loads the plugin
# through the profile's symlink into `lib/`. During a wave that is deliberate — `lib/index.js` is
# then the exact prompt the wave is measuring, so parsing it is the more useful check of the two.
# What it does NOT prove in that case is that the tree you are about to push parses; `bun test`
# and `smoke` cover the tree, and the next build after the wave covers this.
set -u
cd "$(dirname "$0")/.."
if ! command -v dsh > /dev/null; then
  echo "loads: skipped — no dsh on PATH"
  exit 0
fi
d=$(mktemp -d)
d2=$(mktemp -d)
out=$( (cd "$d" && dsh --profile headless "hi") 2>&1 )
rm -rf "$d"
# Parsing is not delivery. Ask the model to quote one of its own rules back: if the section
# loaded but never reached the request, this comes back empty while everything above still
# passes. Verified once by hand — the reply was the rule verbatim, punctuation included.
# Ask for a rule that only this plugin could have supplied. Not "quote any rule" — the model
# picks a different one each time, and the first version of this check asserted which. The fence
# language is the one string no general knowledge would produce.
back=$( (cd "$d2" && dsh --profile headless "你收到的卡片规则里，代码块的 info string 应该写什么？只答那个字符串。" ) 2>&1 )
rm -rf "$d2"
if ! print -r -- "$back" | grep -qF 'ui4a/tsx'; then
  echo "loads: FAILED — the sections parse but the model did not receive them"
  print -r -- "$back" | head -3
  exit 1
fi

if print -r -- "$out" | grep -qiE 'malformed prompt|failed to load|UNKNOWN:'; then
  echo "loads: FAILED — dsh rejected a section"
  print -r -- "$out" | grep -iE 'malformed prompt|failed to load|UNKNOWN:' | head -3
  exit 1
fi
echo "loads: ok — sections parsed, and the model quoted one back"
