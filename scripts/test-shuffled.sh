#!/bin/zsh
# The suite, in a random file order.
#
# bun shares one global per RUN, not per file, so a test that stubs `fetch` or `document` and
# does not restore it breaks whichever file runs next. That is invisible in the default
# alphabetical order — measured: `read.test.ts` had poisoned `compile-pipeline.test.ts` since it
# was written, and the suite stayed green only because a third file sorted between them and
# warmed the compiler first. Renaming that file is what exposed it.
set -e
cd "$(dirname "$0")/.."
bun test $(ls test/*.test.ts | sort -R)
