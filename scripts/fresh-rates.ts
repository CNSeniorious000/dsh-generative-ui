/**
 * The post-rules card set, scored the same way as the corpus.
 *
 * The corpus rates are derivable (`corpus-rates.ts`) and checked against the record
 * (`audit-rates.py`). These were not: "17 of 17", then 30, then 34 — three edits in a day, each
 * one a hand-updated number in prose, and two of them briefly wrong.
 *
 * Usage: bun scripts/fresh-rates.ts [dir]   (default: the generated cards under /tmp)
 */
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { SCREENS } from "./screens.ts";
import { cardsIn } from "./tsx-node.ts";

const dir = process.argv[2] ?? "/tmp/allfresh";
if (!existsSync(dir)) { console.log(`no generated cards at ${dir} — see test/eval-fixtures.md for the prompts`); process.exit(0) }

const cards = cardsIn(dir);
let clean = 0, ring = 0;
const flagged = new Map<string, string[]>();
for (const name of cards) {
  const src = readFileSync(`${dir}/${name}`, "utf8");
  const hits = Object.entries(SCREENS).filter(([, fires]) => fires(src)).map(([screen]) => screen);
  if (hits.length === 0) clean += 1;
  else for (const hit of hits) (flagged.get(hit) ?? flagged.set(hit, []).get(hit)!).push(name);
  if (/:focus-visible/.test(src)) ring += 1;
}

console.log(`${clean} of ${cards.length} clean under all ${Object.keys(SCREENS).length} screens`);
console.log(`${ring} of ${cards.length} use :focus-visible (${Math.round((ring / cards.length) * 100)}%)`);
for (const [screen, names] of [...flagged].sort()) console.log(`  ${screen}: ${names.join(" ")}`);
