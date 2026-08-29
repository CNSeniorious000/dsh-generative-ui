# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""The three corpus counters that `delta.py` cannot compute from `meta.json`.

`score.py` reads what the harness observed — a click sent or did not, a card painted or did not.
These three are properties of the SOURCE the model wrote, and they were originally measured by
throwaway scripts. That is fine for deciding a rule is worth writing and useless for deciding it
worked: r005 and r006 have to be measured with the same instrument, and an instrument that lives
in `/tmp` among forty other files is not the same instrument twice.

Every counter here is deliberately narrow, and `--show` prints the hits. Six of the eleven original
sweeps were false positives (see `docs/measurements-log.md`) and every one of them looked like a
real defect until the hits were read. A number from this file is not evidence until that has
happened at least once per round.

    uv run eval/sweep.py <round-dir> [--show=collision|pre] [--limit=5]
    node eval/nesting.mjs <round-dir>        ← nesting, which needs a parser
"""
import pathlib, re, sys, collections

CLASSNAME = re.compile(r'className=(?:"([^"]*)"|\{`([^`]*)`\})')
# Opening tag, closing tag, or self-closing. Good enough for generated TSX, which is formatted.
TAG = re.compile(r'<(/?)([A-Za-z][\w.]*)((?:[^<>"\']|"[^"]*"|\'[^\']*\')*?)(/?)>', re.S)

PRESSED = ("aria-pressed:", "data-[state=on]:", "data-active:", "aria-selected:", "data-[selected]:")
FAMILY = ("bg-", "text-", "border-", "ring-", "shadow-", "opacity-", "outline-")


def family_of(util: str) -> str | None:
    bare = util.split(":")[-1]
    return next((f[:-1] for f in FAMILY if bare.startswith(f)), None)


def collisions(src: str) -> list[str]:
    """`hover:` and a pressed variant setting the same property family at equal specificity.

    `:is()` takes its argument's specificity, so `.c:hover` and `.c[aria-pressed="true"]` are both
    (0,2,0) and source order decides — `hover` is emitted last, so the selection repaints neutral
    under the pointer. `aria-pressed:hover:` is (0,3,0) and wins on specificity instead of order,
    so its presence for the same family clears the hit.
    """
    out = []
    for m in CLASSNAME.finditer(src):
        classes = (m.group(1) or m.group(2) or "").split()
        hov, prs, fixed = set(), set(), set()
        for c in classes:
            fam = family_of(c)
            if not fam: continue
            has_p = any(p in c for p in PRESSED)
            if has_p and "hover:" in c: fixed.add(fam)
            elif has_p: prs.add(fam)
            elif c.startswith("hover:"): hov.add(fam)
        for fam in sorted((hov & prs) - fixed): out.append(f"{fam}: {' '.join(classes)[:150]}")
    return out


# Nesting is NOT measured here. Two versions of it lived in this file — a regex tag stack and an
# indentation walk — and both were wrong by more than 5x, in opposite directions, against the same
# corpus (see docs/measurements-log.md). It needs a real parser, so it lives in `eval/nesting.mjs`.
# Keeping a second, cheaper implementation next to it would only give a future round two numbers to
# choose between.

def hand_rolled_pre(src: str) -> bool:
    return "<pre" in src and "shiki" not in src


def main() -> None:
    root = pathlib.Path(sys.argv[1])
    show = next((a.split("=")[1] for a in sys.argv[2:] if a.startswith("--show=")), "")
    limit = int(next((a.split("=")[1] for a in sys.argv[2:] if a.startswith("--limit=")), 5))

    n = coll_cards = coll_total = pre_cards = code_cards = 0
    samples = collections.defaultdict(list)
    for path in sorted(root.glob("*/*/turn-*.tsx")):
        src = path.read_text(errors="ignore"); n += 1
        hits = collisions(src)
        if hits:
            coll_cards += 1; coll_total += len(hits)
            samples["collision"].append((path, hits[0]))
        if "<pre" in src or "```" in src or "shiki" in src:
            code_cards += 1
            if hand_rolled_pre(src): pre_cards += 1; samples["pre"].append((path, ""))

    print(f"{root.name}: {n} 张卡片源码\n")
    print(f"  hover/pressed 同族碰撞      {coll_cards:4} 张卡片，共 {coll_total} 处")
    print(f"  手搓 <pre>（无 shiki）      {pre_cards:4} 张 / {code_cards} 张带代码的"
          f"{f' ({pre_cards/code_cards:.1%})' if code_cards else ''}")

    if show:
        print(f"\n── {show} 的前 {limit} 个命中（计数之前先读它们）──")
        for path, note in samples[show][:limit]:
            print(f"  {path.relative_to(root)}\n    {note}")


if __name__ == "__main__": main()
