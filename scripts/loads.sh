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
set -u
cd "$(dirname "$0")/.."
if ! command -v dsh > /dev/null; then
  echo "loads: skipped — no dsh on PATH"
  exit 0
fi
d=$(mktemp -d)
out=$( (cd "$d" && dsh --profile headless "hi") 2>&1 )
rm -rf "$d"
if print -r -- "$out" | grep -qiE 'malformed prompt|failed to load|UNKNOWN:'; then
  echo "loads: FAILED — dsh rejected a section"
  print -r -- "$out" | grep -iE 'malformed prompt|failed to load|UNKNOWN:' | head -3
  exit 1
fi
echo "loads: ok — dsh booted with the plugin's sections"
