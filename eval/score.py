# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""What a round measured, without asking a model.

The judge panel's own spread is about 2.0 points (CLAUDE.md §6.6), so a two-point move in a mean
says nothing on its own. These counters do not have that problem: whether a click sent a message
is a fact, and so is whether a reload brought the card back answered. They are the half of the
result that can carry a small effect, and the panel's prose is the half that finds what to look at
next.

Every rate prints its denominator. Six times in this repo a rate has been reported over a
population that was not what it looked like — runs that never reached a model scored as the model
declining, canvases invisible to a fence count, a wave of 72 that was 26.

    uv run eval/score.py <round-dir> [<round-dir> ...]
"""
import json, pathlib, re, statistics, sys

# A reply that answered with a markdown table or list instead of a card. `fence=0` has two causes
# and only one is a model correctly judging that prose was enough — measured on a calorie-log turn,
# six runs across three models each answered with a 7-to-9-line table and none loaded the skill.
ROWS = re.compile(r"^\s*(?:[-*+]\s+|\d+[.)]\s+|\|)", re.M)


def facts(meta: dict) -> dict:
    turns = meta["turns"]
    cards = [c for t in turns for c in t["cards"]]
    clicks = [c for t in turns for c in t["clicks"]]
    reloads = [t["reload"] for t in turns if t.get("reload")]
    text_only = [t for t in turns if not t["cards"]]
    return {
        "status": meta["status"], "turns": len(turns), "elapsed": meta.get("elapsed"),
        "cards": len(cards),
        "turns_with_card": sum(1 for t in turns if t["cards"]),
        "first_turn_card": bool(turns and turns[0]["cards"]),
        # The principle the old first-turn waves could not see: a NEW fork later in the
        # conversation deserves its own interface.
        "later_card": any(t["cards"] for t in turns[2:]),
        "painted": sum(1 for c in cards if c["painted"]),
        "mistagged": sum(1 for c in cards if c["kind"] == "mistagged"),
        "canvases": sum(1 for c in cards if c["kind"] == "canvas"),
        "skill": sum(1 for t in turns if t.get("skill")),
        "controls": [c["controls"] for c in cards],
        "clicks": len(clicks),
        # A click that fires the conversation immediately. Correct for a plain two-way choice,
        # wrong when the options needed explaining first — so this is a rate to read beside the
        # panel's `interaction` score, not a defect count on its own.
        "clicks_that_sent": sum(1 for c in clicks if c["sent"]),
        # The shape the principles ask for: something was previewed, and a later control committed.
        "preview_then_commit": any(c["sent"] for c in clicks) and any(not c["sent"] and c["ok"] for c in clicks),
        "dead_clicks": sum(1 for c in clicks if not c["ok"]),
        "reloads": len(reloads),
        # Two halves of one rule, measured apart. The skill asks a card that is acted on to
        # "send the result AND record what was chosen", and a single boolean over two snapshots
        # scored the two failures identically: a card that came back remembering its answer and
        # one that never showed an answer at all both leave the text unchanged by a reload.
        #
        # Only a turn that actually COMMITTED can fail either half. An earlier version counted
        # every reload whose text moved and read 43.6%; every hit examined was a person expanding
        # a preview, and the reload correctly resetting transient state — the order-of-magnitude
        # over-report CLAUDE.md §6.1 says a first-pass detector always makes.
        "committed_reloads": sum(1 for t in turns if t.get("reload") and any(c["sent"] for c in t["clicks"])),
        "did_not_record": sum(1 for t in turns
                              if t.get("reload") and any(c["sent"] for c in t["clicks"]) and not t["reload"].get("recorded", True)),
        "did_not_persist": sum(1 for t in turns
                               if t.get("reload") and any(c["sent"] for c in t["clicks"])
                               and t["reload"].get("recorded", False) and not t["reload"].get("persisted", False)),
        # Not a defect, kept apart so the numbers above cannot quietly absorb it: a card that
        # resets its open tab or its expanded row on reload is behaving correctly.
        "reload_reset_preview": sum(1 for t in turns
                                    if t.get("reload") and not any(c["sent"] for c in t["clicks"]) and not t["reload"]["text_same"]),
        "reload_resent": sum(1 for r in reloads if r["resent"]),
        "markdown_instead": sum(1 for t in text_only if len(ROWS.findall(t["reply"])) >= 4),
        # A turn that ended `completed` with no text at all. Measured on glm-5.3-flash: 1172
        # reasoning chunks, one 429 retry, and not one content block — the model thought itself
        # out. Counted separately because it is not the model declining to build UI, and pooling
        # it into the card rate makes a flaky upstream look like a prompt that stopped working.
        "empty_replies": sum(1 for t in turns if not t["reply"].strip()),
        "turn_errors": sum(1 for t in turns if (t.get("reason") or {}).get("kind") == "error"),
    }


def summarise(rows: list[dict], label: str) -> None:
    if not rows: return print(f"{label}: no runs"); 
    n = len(rows)
    turns = sum(r["turns"] for r in rows)
    cards = sum(r["cards"] for r in rows)
    clicks = sum(r["clicks"] for r in rows)
    reloads = sum(r["reloads"] for r in rows)
    controls = [c for r in rows for c in r["controls"]]
    pct = lambda k, d: "  n/a" if d == 0 else f"{100 * k / d:5.1f}%"
    print(f"\n{label}  ({n} runs, {turns} turns, {cards} cards)")
    print(f"  turns that produced a card      {pct(sum(r['turns_with_card'] for r in rows), turns)}  of {turns} turns")
    print(f"  runs whose FIRST turn did       {pct(sum(r['first_turn_card'] for r in rows), n)}  of {n} runs")
    print(f"  runs with a card at turn 3+     {pct(sum(r['later_card'] for r in rows), n)}  of {n} runs")
    print(f"  cards that actually painted     {pct(sum(r['painted'] for r in rows), cards)}  of {cards} cards")
    print(f"  cards written as a canvas       {pct(sum(r['canvases'] for r in rows), cards)}")
    print(f"  cards with the wrong fence tag  {pct(sum(r['mistagged'] for r in rows), cards)}")
    print(f"  clicks that fired the turn      {pct(sum(r['clicks_that_sent'] for r in rows), clicks)}  of {clicks} clicks")
    print(f"  clicks that did nothing at all  {pct(sum(r['dead_clicks'] for r in rows), clicks)}")
    print(f"  runs showing preview-then-commit{pct(sum(r['preview_then_commit'] for r in rows), n)}")
    committed = sum(r["committed_reloads"] for r in rows)
    print(f"  committed but never recorded    {pct(sum(r['did_not_record'] for r in rows), committed)}  of {committed} commits (the card still looks untouched)")
    print(f"  recorded but lost on reload     {pct(sum(r['did_not_persist'] for r in rows), committed)}  of the same {committed}")
    print(f"  reloads that reset a preview    {pct(sum(r['reload_reset_preview'] for r in rows), reloads - committed)}  (not a defect — transient state should reset)")
    print(f"  reloads that re-fired the turn  {pct(sum(r['reload_resent'] for r in rows), reloads)}  of {reloads} reloads")
    print(f"  text-only turns that were a list{pct(sum(r['markdown_instead'] for r in rows), turns)}")
    print(f"  turns that came back EMPTY      {pct(sum(r['empty_replies'] for r in rows), turns)}")
    print(f"  turns that ended in an error    {pct(sum(r['turn_errors'] for r in rows), turns)}")
    if controls: print(f"  controls per card               median {statistics.median(controls):.0f}, max {max(controls)}")
    print(f"  runs cut short by the timeout   {pct(sum(1 for r in rows if r['status'] == 'timeout'), n)}")


def main() -> None:
    for root in sys.argv[1:]:
        root = pathlib.Path(root)
        rows = []
        for meta_path in sorted(root.glob("*/*/meta.json")):
            meta = json.loads(meta_path.read_text())
            if meta["status"] not in ("complete", "timeout"): continue
            row = facts(meta) | {"case": meta["case"], "model": meta["model"],
                                 "kind": "single" if meta["case"] in ("cat-names", "mortgage", "closure", "http418") else "multi"}
            rows.append(row)
        print(f"══ {root.name} ══")
        summarise([r for r in rows if r["kind"] == "multi"], "multi-turn")
        # The controls are the only thing separating "the rules improved" from "the rules now fire
        # on everything", so they are printed apart and never pooled into the headline.
        for case in ("cat-names", "mortgage"):
            hits = [r for r in rows if r["case"] == case]
            if hits: print(f"\n  positive control {case:11} produced a card in {sum(r['cards'] > 0 for r in hits)}/{len(hits)} runs (wanted: all)")
        for case in ("closure", "http418"):
            hits = [r for r in rows if r["case"] == case]
            if hits: print(f"  negative control {case:11} produced a card in {sum(r['cards'] > 0 for r in hits)}/{len(hits)} runs (wanted: none)")

        verdicts = root / "verdicts.json"
        if verdicts.exists():
            scored = [v for v in json.loads(verdicts.read_text()) if v.get("status") == "ok"]
            if scored:
                keys = ["trigger", "clarify", "interaction", "hierarchy", "craft", "overall"]
                print(f"\n  panel ({len(scored)} runs scored): " + "  ".join(f"{k}={sum(v['mean'][k] for v in scored) / len(scored):.2f}" for k in keys))


if __name__ == "__main__":
    main()
