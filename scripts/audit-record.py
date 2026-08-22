#!/usr/bin/env python3
"""Print every prompt whose N/M score differs between sections of CLAUDE.md.

A number transcribed wrong is worse than a missing one: every later reader treats it as
measured fact. Found `什么是二分查找` recorded as both 2/3 and 1/3 this way.
"""
import re, sys, collections

text = open(sys.argv[1] if len(sys.argv) > 1 else "CLAUDE.md").read()
prompt = re.compile(r"`([^`]*[一-鿿][^`]*)`")
hits = collections.defaultdict(list)
for section in re.split(r"\n(?=### )", text):
    title = section.split("\n", 1)[0][4:60]
    for line in section.splitlines():
        for m in prompt.finditer(line):
            p = m.group(1)
            if 5 <= len(p) <= 40 and re.search(r"\b\d/\d\b", line):
                hits[p].append((title, line.strip()[:110]))

def scores(line):
    """Every N/M in a line, as fractions — a table row often carries before and after."""
    return {(int(a), int(b)) for a, b in re.findall(r"\b(\d)/(\d)\b", line)}


def score_for(prompt, line):
    """The N/M that belongs to this prompt: the first one after its mention.

    A line often names several prompts (`JS reduce 3/3, 二分查找 2/3`), so taking the line's
    first score attributes a neighbour's number to this one.
    """
    at = line.find(f"`{prompt}`")
    if at == -1:
        return None
    found = re.search(r"\b(\d)/(\d)\b", line[at:])
    return (found.group(1), found.group(2)) if found else None


for p, rows in sorted(hits.items()):
    if len({t for t, _ in rows}) < 2:
        continue
    # Two mentions are usually a before/after pair or a restatement. The conflict signal is the
    # score immediately after the prompt — the "before" — disagreeing across sections.
    firsts = {}
    for title, line in rows:
        got = score_for(p, line)
        if got is None:
            continue
        num, den = got
        firsts.setdefault(den, {}).setdefault(num, []).append((title, line))
    for group in (v for v in firsts.values() if len(v) > 1):
        print("==", p)
        for lines in group.values():
            for t, l in lines:
                print("   ", t[:44], "|", l)
