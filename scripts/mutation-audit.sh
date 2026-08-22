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
[[ -z "$(git status --porcelain)" ]] || { echo "working tree must be clean: this script rewrites source files"; exit 2 }
for src in src/client/runtime/*.ts src/client/canvas/*.ts src/*.ts; do
  [[ "$src" == *panel-css* ]] && continue
  sites=$(perl -0ne 'my $c = () = /\bif \(/g; print $c' "$src")
  [[ "$sites" == "0" ]] && { echo "$(basename $src): mutationSites=0 (operator does not apply)"; continue }
  cp "$src" "/tmp/ma-$(basename $src)"
  perl -0pi -e 's/\bif \(([^)]*)\)/if (!($1))/g' "$src"
  fails=$(bun test 2>&1 | grep -oE '^ *[0-9]+ fail' | head -1 | tr -dc 0-9)
  cp "/tmp/ma-$(basename $src)" "$src"
  echo "$(basename $src): mutationSites=$sites failingTests=${fails:-0}"
done
