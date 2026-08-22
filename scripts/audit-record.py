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

for p, rows in sorted(hits.items()):
    if len({t for t, _ in rows}) > 1:
        print("==", p)
        for t, l in rows:
            print("   ", t[:44], "|", l)
