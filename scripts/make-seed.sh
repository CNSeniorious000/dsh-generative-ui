#!/usr/bin/env bash
# Builds a workspace for `eval.sh` to run a prompt inside.
#
# `test/eval-fixtures.md` says to run the fixtures against real files, and several prompts are
# meaningless without them — `这个项目的 git 历史帮我梳理一下` in an empty directory sends the model
# hunting for *some* repository (measured: 19 to 35 bash calls, then prose about whatever it found).
# The seeds are generated rather than committed because one of them is a git repository, and a
# repository inside a repository is not something git will carry.
#
# Usage: scripts/make-seed.sh <kind> [dir]   — kinds: git, env, src
set -eu
kind=${1:?usage: make-seed.sh <git|env|src> [dir]}
dir=${2:-/tmp/dsh-seed-$kind}
rm -rf "$dir"
mkdir -p "$dir"

case "$kind" in
  git)
    git -C "$dir" init -q
    git -C "$dir" config user.email fixture@example.com
    git -C "$dir" config user.name Fixture
    # Enough history that summarising it loses something: 24 commits, three authors, several files,
    # and a mix of feature/fix/refactor subjects. Six commits to one file — the first version of
    # this seed — is a history a paragraph genuinely covers, so it measured the wrong thing.
    mkdir -p "$dir/src" "$dir/docs"
    authors=("Ada Lovelace|ada@example.com" "Grace Hopper|grace@example.com" "Alan Turing|alan@example.com")
    subjects=(
      "add the parser skeleton" "fix off-by-one in the tokenizer" "extract the lexer"
      "handle empty input" "document the grammar" "speed up the hot loop"
      "drop the unused flag" "rename Node to Expr" "cover the error path"
      "fix a crash on nested groups" "tidy the imports" "add a benchmark"
    )
    n=0
    for month in 1 2 3 4 5 6; do
      for day in 04 11 18 25; do
        who=${authors[$((n % 3))]}
        subj=${subjects[$((n % 12))]}
        printf 'change %s\n' "$n" >> "$dir/src/parser.ts"
        [ $((n % 3)) -eq 0 ] && printf 'note %s\n' "$n" >> "$dir/docs/notes.md"
        [ $((n % 4)) -eq 0 ] && printf 'case %s\n' "$n" >> "$dir/src/lexer.ts"
        git -C "$dir" add -A
        GIT_AUTHOR_NAME="${who%%|*}" GIT_AUTHOR_EMAIL="${who##*|}" \
        GIT_COMMITTER_NAME="${who%%|*}" GIT_COMMITTER_EMAIL="${who##*|}" \
        GIT_AUTHOR_DATE="2026-0$month-${day}T1${day:0:1}:00:00" GIT_COMMITTER_DATE="2026-0$month-${day}T1${day:0:1}:00:00" \
          git -C "$dir" commit -qm "$subj"
        n=$((n + 1))
      done
    done
    ;;
  env)
    cat > "$dir/.env" <<'ENV'
DATABASE_URL=postgres://localhost:5432/app
REDIS_URL=redis://localhost:6379
LOG_LEVEL=info
FEATURE_NEW_CHECKOUT=false
SESSION_TTL_SECONDS=3600
ENV
    printf '.env\nnode_modules\n' > "$dir/.gitignore"
    ;;
  src)
    mkdir -p "$dir/src/components" "$dir/src/lib"
    printf 'export function App() { return null }\n' > "$dir/src/App.tsx"
    printf 'export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))\n' > "$dir/src/lib/clamp.ts"
    printf 'export function Button() { return null }\n' > "$dir/src/components/Button.tsx"
    printf '# app\n\nA small thing.\n' > "$dir/README.md"
    ;;
  *) echo "unknown kind: $kind" >&2; exit 2 ;;
esac

echo "$dir"
