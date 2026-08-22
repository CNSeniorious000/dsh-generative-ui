#!/usr/bin/env bash
# Diffs the shell's real module table against PLATFORM_MODULES in scripts/build.ts.
#
# §2.1 says the table shrinks and must be re-checked on every dsh upgrade, but not how:
# the table is not in any installed package (70 @deepseek-ai packages, none contains the
# string "react/jsx-runtime"). It lives in the shell's own frontend bundle, so the only way
# to read it is to serve the app and fetch it. Listed but absent from the host = the
# require() fails and the whole client dies, so this is worth one command.
set -u
port=${1:-47399}
( DSH_HOME=${DSH_HOME:-$HOME/.dsh} dsh web --port "$port" --no-open >/tmp/platform-table.log 2>&1 & )
for _ in $(seq 1 40); do curl -sf "http://127.0.0.1:$port/" -o /tmp/shell.html && break; sleep 0.5; done
asset=$(grep -o 'src="/assets/[^"]*\.js"' /tmp/shell.html | head -1 | sed 's/src="//; s/"$//')
curl -s "http://127.0.0.1:$port${asset:-/nonexistent}" -o /tmp/shell.js
pkill -f "dsh web --port $port" 2>/dev/null

host=$(grep -o 'return{react:[^}]*}' /tmp/shell.js | head -1 | grep -o '"[^"]*"\|[,{][a-z][a-zA-Z-]*:' | tr -d '",:{' | sort -u | grep -v '^$')
ours=$(grep -o 'PLATFORM_MODULES = \[[^]]*\]' scripts/build.ts | grep -o '"[^"]*"' | tr -d '"' | sort -u)

# A checker that passes when it is itself broken is worse than none: today an `rg` that was
# not on PATH made both sides empty and the diff reported a match.
count=$(echo "$host" | grep -c . )
[ "$count" -ge 5 ] || { echo "PROBE BROKEN — read $count entries from the shell bundle, expected at least 5"; exit 2; }
diff <(echo "$host") <(echo "$ours") >/dev/null && { echo "platform table matches ($(echo "$host" | wc -l | tr -d ' ') entries)"; exit 0; }
echo "MISMATCH — host vs scripts/build.ts:"; diff <(echo "$host") <(echo "$ours")
exit 1
