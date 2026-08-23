/**
 * The screen hit rates, printed as a table — the numbers CLAUDE.md quotes.
 *
 * Transcribing a rate into prose is how `什么是二分查找` ended up recorded as both 2/3 and 1/3
 * (see `audit-record.py`, which exists for that). A rate that can be re-derived in one command
 * does not need transcribing, and a widened screen shows up here rather than in a stale sentence.
 *
 * Usage: bun scripts/corpus-rates.ts [dir]   (default: the extracted corpus under /tmp)
 */
import { readFileSync } from "node:fs";
import { cardsIn } from "./tsx-node.ts";
import { SCREENS } from "./screens.ts";

const dir = process.argv[2] ?? "/tmp/corpuscards";
const cards = cardsIn(dir);
const counts = new Map<string, string[]>();
for (const name of cards) {
  const src = readFileSync(`${dir}/${name}`, "utf8");
  for (const [screen, hits] of Object.entries(SCREENS)) if (hits(src)) (counts.get(screen) ?? counts.set(screen, []).get(screen)!).push(name);
}
const width = Math.max(...Object.keys(SCREENS).map((s) => s.length));
for (const screen of Object.keys(SCREENS).toSorted()) {
  const hits = counts.get(screen) ?? [];
  console.log(`${screen.padEnd(width)}  ${String(hits.length).padStart(3)} of ${cards.length}   ${hits.slice(0, 4).join(" ")}`);
}
