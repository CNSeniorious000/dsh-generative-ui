#!/usr/bin/env python3
"""Draw real user prompts from a session corpus, so a generation batch is not curated by me.

Every fresh-card run before this used prompts I wrote, which measures the rules against the cases
I thought of. These are what people actually asked for.

    python3 scripts/sample-prompts.py /tmp/corpus.jsonl 8 [seed]

Prints one prompt per line, ready for a batch runner. The seed is printed to stderr so a
surprising result can be reproduced exactly.
"""
import json, random, sys

# Prompts about this project's own plumbing were never card requests, and a prompt that refers to
# earlier turns ("先做 overlay 过渡", "echo probe") cannot be replayed standalone — it would measure
# the harness, not the rules.
SKIP = ("探针", "sendMessage", "docs/", "echo probe", "你能用哪些工具", "EADDRINUSE")

path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/corpus.jsonl"
count = int(sys.argv[2]) if len(sys.argv) > 2 else 8
seed = int(sys.argv[3]) if len(sys.argv) > 3 else random.randrange(10**6)

prompts = []
for line in open(path):
    if '"user/message"' not in line:
        continue
    try:
        record = json.loads(line)
    except Exception:
        continue
    # `source.kind` separates a person typing from a spliced agent message.
    if record.get("data", {}).get("source", {}).get("kind") != "user":
        continue
    for block in record["data"].get("content", []):
        text = block.get("text", "")
        if isinstance(text, str) and 6 <= len(text) <= 70 and "\n" not in text and not any(k in text for k in SKIP):
            prompts.append(text)

unique = sorted(set(prompts))
print(f"{len(prompts)} prompts, {len(unique)} unique, seed {seed}", file=sys.stderr)
random.seed(seed)
print("\n".join(random.sample(unique, min(count, len(unique)))))
