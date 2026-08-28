# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Did the prompt change anything? Read the two rounds PAIRED, per (case, model).

The panel's own spread is about 2.0 points, and two rounds asking different questions have been
measured 0.5 apart in the pooled mean with nothing changed at all. So a pooled before/after mean
cannot see an effect this size. What can is the paired delta: the same case, the same model, one
variable, and a standard error taken over the pairs.

The deterministic counters are read the same way, and they are the ones that carry a small effect
— whether a click sent a message is a fact, not an opinion.

Nothing here says "significant" below 2 standard errors. That threshold is why the `text-base` fix
was readable at +0.45 while its own pooled mean said +0.23 and meant nothing.

    uv run eval/delta.py <before-round> <after-round>
"""
import json, pathlib, statistics, sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from score import facts, persist_keys

KEYS = ["trigger", "clarify", "interaction", "hierarchy", "craft", "overall"]
# The counters worth a paired read. Each is (label, numerator, denominator) over one run.
COUNTERS = [
    ("turns with a card", lambda f: f["turns_with_card"], lambda f: f["turns"]),
    ("card at turn 3+", lambda f: int(f["later_card"]), lambda f: 1),
    ("clicks that fired the turn", lambda f: f["clicks_that_sent"], lambda f: f["clicks"]),
    ("preview-then-commit", lambda f: int(f["preview_then_commit"]), lambda f: 1),
    ("committed but not recorded", lambda f: f["did_not_record"], lambda f: f["committed_reloads"]),
    ("recorded but lost on reload", lambda f: f["did_not_persist"], lambda f: f["committed_reloads"]),
    ("cards that painted", lambda f: f["painted"], lambda f: f["claimable"]),
    ("  …inline fences", lambda f: f["painted_fence"], lambda f: f["fences"]),
    ("  …canvases", lambda f: f["painted_canvas"], lambda f: f["canvases"]),
    ("cards that persist an answer", lambda f: f["persisting_cards"], lambda f: f["cards"]),
    ("list instead of a card", lambda f: f["markdown_instead"], lambda f: f["turns"]),
]


def load(root: pathlib.Path) -> dict[tuple[str, str], dict]:
    out = {}
    for path in sorted(root.glob("*/*/meta.json")):
        meta = json.loads(path.read_text())
        if meta["status"] not in ("complete", "timeout") or not meta["turns"]: continue
        persisting, collisions, copied = persist_keys(path.parent)
        out[(meta["case"], meta["model"])] = facts(meta) | {
            "persisting_cards": persisting, "key_collisions": collisions, "copied_example_key": copied}
    verdicts = root / "verdicts.json"
    if verdicts.exists():
        for v in json.loads(verdicts.read_text()):
            key = (v["case"], v["model"])
            if key in out and v.get("status") == "ok": out[key]["panel"] = v["mean"]
    return out


def report(label: str, deltas: list[float]) -> None:
    if len(deltas) < 2: return print(f"  {label:30} {len(deltas)} pair(s) — too few to read")
    mean = statistics.fmean(deltas)
    se = statistics.stdev(deltas) / len(deltas) ** 0.5
    # `se == 0` means every pair moved by exactly the same amount — including "not at all", which
    # is the common case and which `abs(0) >= 2*0` was happily marking as a significant result.
    mark = "  ←" if se > 0 and abs(mean) >= 2 * se else ("  (identical)" if mean == 0 else "")
    print(f"  {label:30} {mean:+6.3f} ± {se:.3f} (n={len(deltas):3}){mark}")


def main() -> None:
    before, after = (load(pathlib.Path(p)) for p in sys.argv[1:3])
    pairs = sorted(set(before) & set(after))
    print(f"{len(pairs)} paired runs ({len(before)} before, {len(after)} after)\n")
    if not pairs: return

    print("panel, paired (← marks a move of at least 2 standard errors):")
    for key in KEYS:
        deltas = [after[p]["panel"][key] - before[p]["panel"][key] for p in pairs
                  if "panel" in before[p] and "panel" in after[p]]
        report(key, deltas)

    print("\ncounters, paired (rate after − rate before, per run):")
    for label, num, den in COUNTERS:
        deltas = []
        for p in pairs:
            db, da = den(before[p]), den(after[p])
            if db == 0 or da == 0: continue   # a rate over nothing is not a zero
            deltas.append(num(after[p]) / da - num(before[p]) / db)
        report(label, deltas)

    print("\nboundary (the controls decide whether the rules improved or just widened):")
    for case in ("cat-names", "mortgage", "closure", "http418"):
        want = "card" if case in ("cat-names", "mortgage") else "prose"
        rows = [(before[p]["cards"] > 0, after[p]["cards"] > 0) for p in pairs if p[0] == case]
        if rows:
            print(f"  {case:11} wants {want:5} — before {sum(b for b, _ in rows)}/{len(rows)} carded, after {sum(a for _, a in rows)}/{len(rows)}")


if __name__ == "__main__":
    main()
