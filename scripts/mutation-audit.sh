#!/bin/zsh
# Which modules have tests that would notice them breaking.
#
# Inverts every `if` condition in one source file at a time and counts failing tests. A module
# with mutation sites and zero failures has no test that constrains its branches — which is how
# `compiler.test.ts` was found to be testing a re-implementation rather than the module.
#
# Read the two columns together. `failingTests=0` with `mutationSites=0` is a no-op, not a
# verdict: `observe.ts` and `register.ts` are almost `if`-free and are mutation-checked by hand.
# Arrow-expression exports (`sameCode`, `matchSegment`) have no `if` either, so a module can be
# well covered and still score low here.
#
# Not part of `bun run check` — it rewrites source files and takes minutes. Run it deliberately.
set -e
cd "$(dirname "$0")/.."

# Restore whatever is mutated no matter how this exits. `set -e` plus a rewritten source file is
# a bad combination: a failure between the mutation and the restore leaves the tree broken, which
# is exactly what happened once — the run aborted mid-loop and left `bindings.ts` inverted.
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
for src in src/client/runtime/*.ts src/client/canvas/*.ts src/*.ts; do
  [[ "$src" == *panel-css* ]] && continue
  sites=$(perl -0ne 'my $c = () = /\bif \(/g; print $c' "$src")
  [[ "$sites" == "0" ]] && { echo "$(basename $src): mutationSites=0 (operator does not apply)"; continue }
  cp "$src" "/tmp/ma-$(basename $src)"
  current="$src"
  perl -0pi -e 's/\bif \(([^)]*)\)/if (!($1))/g' "$src"
  out=$(bun test 2>&1)
  fails=$(echo "$out" | grep -oE '^ *[0-9]+ fail' | head -1 | tr -dc 0-9)
  # A module that THROWS on import collapses its whole file into one error, so the count reads
  # like poor coverage when it is the opposite. `segments.ts` reported 1 for this reason; its six
  # conditions each fail 1-14 tests when inverted alone.
  errors=$(echo "$out" | grep -cE '^ *[0-9]+ error')
  restore
  note=""
  [[ "$errors" != "0" ]] && note="  (module threw on import — count is a floor, mutate conditions singly)"
  echo "$(basename $src): mutationSites=$sites failingTests=${fails:-0}$note"
done
