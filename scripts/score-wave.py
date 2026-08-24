# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Score one wave, and — the point of it — say what the model did INSTEAD of a card.

`skill=no fence=0` is where every earlier eval in this project stopped, and it is the least
informative half of the result. Measured on wave 0: six runs across three models all answered a
calorie-log turn with a 7-line markdown table of per-item numbers and a total, and not one loaded
the skill. That is not a model failing to build UI; it is a model building UI in markdown. The
`md` column is what makes that visible, so a wave can distinguish "prose was right" from "a card
was written in the wrong language".
"""
import collections, json, os, pathlib, re, sys

# The wave directory is state, not source; it lives outside the repo and can be pointed elsewhere.
ROOT = pathlib.Path(os.environ.get("WAVE_ROOT", "/tmp/genui-loop"))
W = int(sys.argv[1])
d = ROOT / "waves" / f"w{W:03d}"
# The wave's OWN snapshot, not the live file: see run-wave.py.
snap = d / "wave.json"
wave = json.loads(snap.read_text()) if snap.exists() else json.loads((ROOT / "waves.json").read_text())[W]

ROW = re.compile(r"^\s*(?:[-*+]\s|\d+[.)]\s|\|)")
rows = []
for f in sorted(d.glob("*.txt")):
    head = f.read_text().splitlines()[0] if f.read_text().strip() else ""
    m = dict(re.findall(r"(\w+)=(\S+)", head))
    reply = m.get("reply", "")
    text = pathlib.Path(reply).read_text() if reply and pathlib.Path(reply).exists() else ""
    idx, model, samp = f.stem.split("-", 1)[0], f.stem.split("-", 1)[1].rsplit("-s", 1)[0], f.stem[-1]
    rows.append({
        "i": int(idx), "model": model, "s": samp,
        "skill": m.get("skill") == "yes",
        "card": (m.get("fence", "0") != "0") or (m.get("canvas", "0") != "0"),
        "md": sum(1 for line in text.splitlines() if ROW.match(line)),
        "bytes": int(m.get("bytes", 0) or 0),
        "fam": wave[int(idx)]["fam"] if int(idx) < len(wave) else "?",
    })

n = len(rows)
if not n: print("no runs yet"); sys.exit()
card = sum(r["card"] for r in rows); skill = sum(r["skill"] for r in rows)
# A reply with six or more list/table rows is a card the model wrote in markdown. Six is where
# the skill's own long-list rule draws the line, so the two numbers are about the same thing.
mdcard = sum(1 for r in rows if not r["card"] and r["md"] >= 6)
print(f"wave {W}: {n} runs  skill {skill} ({skill/n:.0%})  cards {card} ({card/n:.0%})  markdown-tables-instead {mdcard} ({mdcard/n:.0%})")
for key in ("model", "fam"):
    agg = collections.defaultdict(lambda: [0, 0, 0, 0])
    for r in rows:
        a = agg[r[key]]; a[0] += 1; a[1] += r["skill"]; a[2] += r["card"]; a[3] += (not r["card"] and r["md"] >= 6)
    print(f"  by {key}:")
    for k, (t, s, c, mc) in sorted(agg.items(), key=lambda kv: -kv[1][2]):
        print(f"    {k:<26} n={t:<3} skill={s:<3} card={c:<3} md-instead={mc}")
# A 100% card rate is not automatically good news: a trigger rule can widen into "build one
# whenever a number appears". Turns short enough to be a clarification ("intendo di soldi", four
# words) are where over-firing shows first, so they are printed whenever they DID produce a card.
short = sorted({r["i"] for r in rows if r["card"] and len(wave[r["i"]]["q"].replace("用户：", "").strip()) < 25})
if short:
    print("  very short turns that still produced a card — check these are not over-firing:")
    for i in short: print(f"    [{wave[i]['fam']}] {wave[i]['q'].replace('用户：','')[:70]}")
missed = sorted({r["i"] for r in rows if not r["card"] and r["md"] >= 6})
if missed:
    print("  turns answered as a markdown table by at least one run:")
    for i in missed: print(f"    [{wave[i]['fam']}] {wave[i]['q'].replace('用户：','')[:78]}")
