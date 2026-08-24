# /// script
# requires-python = ">=3.11"
# ///
"""Pair the judge panel's verdicts before and after a change, per card.

The panel's own spread is ~2.0, so a difference in wave means says almost nothing. But when the
SOURCE is fixed and only the rendering changed, every card is its own control: the same five models
grade the same TSX twice, and the only difference is the pixels. Paired, that reads clean —
measured +0.40 across 7 cards with the `text-base` fix, every one of them up.

Reads /tmp/judge-cache, splits on file mtime. Usage:

    uv run scripts/judge-delta.py [minutes]     # default 10 — anything newer is "after"
"""
import collections, glob, json, os, re, statistics, sys, time

cut = time.time() - float(sys.argv[1] if len(sys.argv) > 1 else 10) * 60
before, after = collections.defaultdict(list), collections.defaultdict(list)
for f in glob.glob("/tmp/judge-cache/*"):
    r = json.loads(open(f).read())
    m = re.search(r"SCORE:\s*([\d.]+)", r["verdict"])
    if not m: continue
    (after if os.path.getmtime(f) > cut else before)[r["card"]].append(float(m.group(1)))

pairs = [(c, statistics.mean(before[c]), statistics.mean(after[c]), len(after[c])) for c in after if c in before]
if not pairs:
    sys.exit("no card was judged on both sides of the split — widen or narrow the minutes argument")
for c, b, a, n in sorted(pairs, key=lambda t: t[2] - t[1]):
    print(f"{c:58} {b:.2f} -> {a:.2f}  {a - b:+.2f}  (n={n})")
d = [a - b for _, b, a, _ in pairs]
up = sum(x > 0 for x in d)
print(f"\n{len(pairs)} paired cards · mean {statistics.mean(d):+.2f} · {up} up, {len(d) - up} down or flat")
