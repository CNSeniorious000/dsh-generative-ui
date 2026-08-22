/**
 * Compiles the cards in `test/cards/` (or a directory given as argv[2]) and screens them for the three failures that
 * compile cleanly and break at runtime (CLAUDE.md §4): a default export shadowing an import
 * (React #185, a blank card), a JSX subscript `<a[k] />` (illegal where `<a.b />` is fine),
 * and viewport units in something that is a component on someone else's page.
 *
 * The screens were verified against a deliberately broken card before being trusted — the
 * first version's subscript regex matched `useState<number[]>` and missed `<META[k].icon />`,
 * which is exactly backwards.
 */
import { normalizeGeneratedTsx } from "partial-tsx";
import { readFileSync } from "node:fs";

import { cardsIn, compileCard, initTsxFromDisk } from "./tsx-node.ts";

await initTsxFromDisk();
const dir = process.argv[2] ?? "test/cards";
let bad = 0;
for (const f of cardsIn(dir)) {
  const src = readFileSync(`${dir}/${f}`, "utf8");
  // the shape a settled card takes: normalize final, then transform
  try {
    const out = compileCard(f, normalizeGeneratedTsx(src, { mode: "final" }));
    // the checks CLAUDE.md says nothing catches at compile time
    const imports = [...src.matchAll(/import\s*\{([^}]+)\}\s*from/g)].flatMap(m => m[1].split(",").map(s => s.trim().split(/\s+as\s+/).pop()!.trim()));
    const def = src.match(/export default function (\w+)/)?.[1];
    const shadow = def && imports.includes(def);
    // JSX only, not generics: `<Foo[k] />` is illegal, `useState<Foo[]>` is everywhere. The
    // difference is what follows the bracket — an index expression, never an immediate `]`.
    const subscript = /<[A-Z]\w*\[[^\]]+\]/.test(src) && !/<[A-Z]\w*\[\]/.test(src);
    const vw = /100v[wh]|position:\s*["']?fixed/.test(src);
    const flags = [shadow && "SHADOWED-EXPORT", subscript && "JSX-SUBSCRIPT", vw && "VIEWPORT-UNITS"].filter(Boolean);
    console.log(`${f.padEnd(22)} ok  ${(out.code.length/1024).toFixed(1)}kb  ${flags.length ? "⚠ " + flags.join(",") : ""}`);
    if (flags.length) bad++;
  } catch (e) {
    console.log(`${f.padEnd(22)} FAIL ${String((e as Error).message ?? e).split("\n")[0].slice(0,80)}`);
    bad++;
  }
}
console.log(bad === 0 ? "\nall clean" : `\n${bad} with problems`);
// It has counted `bad` since it was written and never acted on it — a checker that only ever
// prints is one nothing can fail against.
if (bad > 0) process.exit(1);
