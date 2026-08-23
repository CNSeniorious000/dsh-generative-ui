#!/bin/zsh
# Install the repo's git hooks into this checkout.
#
# `.git/hooks/` is not versioned, so a hook that only exists there protects one clone and nobody
# knows it is missing anywhere else. Run once per checkout: scripts/hooks/install.sh
set -e
cd "$(dirname "$0")/../.."
for hook in scripts/hooks/*(N); do
  [[ "${hook:t}" == "install.sh" ]] && continue
  cp "$hook" ".git/hooks/${hook:t}"
  chmod +x ".git/hooks/${hook:t}"
  echo "installed ${hook:t}"
done
