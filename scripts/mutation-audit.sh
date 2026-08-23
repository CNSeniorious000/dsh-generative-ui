#!/bin/zsh
# Which conditions have a test that would notice them breaking.
#
# Inverts one `if` at a time and counts failing tests. A condition whose inversion changes nothing
# has no test constraining it — which is how `compiler.test.ts` was found to be testing a
# re-implementation, and how nine live guards (`$dsh/fs` with no host, the traversal fence, the
# panel collapse) were found to be unconstrained.
#
# Three earlier versions of this script under-reported, each silently:
#
# - Mutating a whole file at once. A module that then THROWS on import collapses its tests into
#   one error, so `segments.ts` scored 1 out of 17 while every one of its six conditions was in
#   fact covered. Per-condition is the only reading that means anything.
# - `perl -e 's/if \(([^)]*)\)/'`. A regex stops at the first `)`, so any condition containing a
#   call became a syntax error rather than a mutant — 27 of them here. `invert-ifs.mjs` matches
#   parens instead.
# - `echo "$out"`. zsh's echo expands the `\u` and `\t` in test names, corrupting the lines grep
#   was matching. `printf %s\\n` does not.
#
# Not part of `bun run check`: it rewrites source files and takes about an hour. Run it deliberately.
set -e
cd "$(dirname "$0")/.."

# `set -e` plus a rewritten source file is a bad combination: a failure between the mutation and
# the restore leaves the tree broken, which is exactly what happened once.
current=""
restore() {
  if [[ -n "$current" ]]; then
    cp "/tmp/ma-$(basename "$current")" "$current"
    current=""
  fi
  return 0
}
trap restore EXIT INT TERM
[[ -z "$(git status --porcelain)" ]] || { echo "working tree must be clean: this script rewrites source files"; exit 2 }

uncovered=0
for src in src/client/runtime/*.ts src/client/canvas/*.ts src/*.ts; do
  [[ "$src" == *panel-css* ]] && continue
  lines=($(grep -n 'if (' "$src" | cut -d: -f1))
  (( ${#lines} == 0 )) && { echo "${src:t}: no conditions (operator does not apply)"; continue }
  cp "$src" "/tmp/ma-${src:t}"
  current="$src"
  covered=0
  uncovered_here=0
  for n in $lines; do
    bun scripts/invert-ifs.mjs "$src" "$n"
    # The mutator declines lines whose `if` is inside a string — `skill.ts` documents the
    # `AbortError` check inside its prompt. An unchanged file means "not a branch", which is a
    # different answer from "no test noticed", and reporting it as the latter is a standing
    # false positive that trains you to ignore the report.
    if cmp -s "$src" "/tmp/ma-${src:t}"; then continue; fi
    out=$(bun test 2>&1 || true)
    fails=$(printf %s\\n "$out" | grep -oE '^ *[0-9]+ fail' | head -1 | tr -dc 0-9 || true)
    errors=$(printf %s\\n "$out" | grep -cE '^ *[0-9]+ error' || true)
    cp "/tmp/ma-${src:t}" "$src"
    # An `if` inside a prompt string is prose, not a branch — `skill.ts` has one. Nothing
    # distinguishes it automatically; it is reported and read.
    if [[ "${fails:-0}" == "0" && "$errors" == "0" ]]; then
      printf '  %s:%s  UNCOVERED  %s\n' "${src:t}" "$n" "$(sed -n "${n}p" "$src" | sed 's/^ *//' | cut -c1-72)"
      uncovered=$((uncovered + 1))
      uncovered_here=$((uncovered_here + 1))
    else
      covered=$((covered + 1))
    fi
  done
  restore
  declined=$(( ${#lines} - covered - uncovered_here ))
  if (( covered == 0 )); then
    echo "${src:t}: no branches (${declined} \`if (\` in prose, declined)"
  elif (( declined > 0 )); then
    echo "${src:t}: ${covered} conditions covered (${declined} in prose, declined)"
  else
    echo "${src:t}: ${covered} conditions covered"
  fi
done
echo
echo $([[ "$uncovered" == "0" ]] && echo "every condition is constrained by a test" || echo "$uncovered unconstrained")
