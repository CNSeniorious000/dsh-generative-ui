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
import { existsSync, readFileSync } from "node:fs";

import { cardsIn, compileCard, initTsxFromDisk } from "./tsx-node.ts";

import { SCREENS } from "./screens.ts";


await initTsxFromDisk();
const dir = process.argv[2] ?? "test/cards";
let bad = 0;
for (const f of cardsIn(dir)) {
  const src = readFileSync(`${dir}/${f}`, "utf8");
  // the shape a settled card takes: normalize final, then transform
  try {
    const out = compileCard(f, normalizeGeneratedTsx(src, { mode: "final" }));
    // A relative import only resolves because `canvas/subpages.ts` rewrites it to a blob URL
    // before compiling — `blob:` cannot host one otherwise (CLAUDE.md §3). A card with one is
    // fine, but the file it names has to exist, and this compiles cleanly either way.
    const relatives = [...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)["'](\.[^"']*)["']/g)].map((m) => m[1]);
    const dangling = relatives.filter((specifier) => {
      const base = `${dir}/${specifier.replace(/^\.\//, "")}`;
      return ![".tsx", ".ts", "/index.tsx", "/index.ts", ""].some((suffix) => existsSync(base + suffix));
    });
    const flags = [...Object.entries(SCREENS).filter(([, hits]) => hits(src)).map(([name]) => name), dangling.length > 0 && `DANGLING-IMPORT ${dangling.join(" ")}`].filter(Boolean);
    console.log(`${f.padEnd(22)} ok  ${(out.code.length/1024).toFixed(1)}kb  ${flags.length ? "⚠ " + flags.join(",") : ""}`);
    if (flags.length) bad++;
  } catch (e) {
    console.log(`${f.padEnd(22)} FAIL ${String((e as Error).message ?? e).split("\n")[0].slice(0,80)}`);
    bad++;
  }
}
console.log(bad === 0 ? "\nall clean" : `\n${bad} with problems`);

// Every screen above, proven still live. `test/cards-negative/` holds one card per trap, each
// compiling cleanly and each *supposed* to be flagged — a checker that reports "all clean" over
// correct cards is indistinguishable from one that has stopped looking, and this project has
// already shipped two detectors that were silently blind. Only runs on the default directory.
const CONTROLS = { "jsx-subscript.tsx": "JSX-SUBSCRIPT", "jsx-subscript-attrs.tsx": "JSX-SUBSCRIPT", "long-hex-background.tsx": "HARDCODED-BACKGROUND", "fixed-overlay.tsx": "VIEWPORT-UNITS", "viewport-height.tsx": "VIEWPORT-UNITS", "shadowed-const.tsx": "SHADOWED-EXPORT", "exported-module-hook.tsx": "MODULE-SCOPE-HOOK", "shadowed-export.tsx": "SHADOWED-EXPORT", "module-scope-hook.tsx": "MODULE-SCOPE-HOOK", "blank-render.tsx": ["DESTRUCTURED-HOOK", "MISSING-REACT-IMPORT"], "missing-suspense.tsx": "MISSING-REACT-IMPORT", "missing-memo.tsx": "MISSING-REACT-IMPORT", "destructured-ref.tsx": "DESTRUCTURED-HOOK", "empty-result.tsx": "UNGUARDED-LAST-INDEX", "empty-first.tsx": "UNGUARDED-LAST-INDEX", "empty-second.tsx": "UNGUARDED-LAST-INDEX", "glob-in-jsx.tsx": "GLOB-IN-JSX", "duplicate-style-key.tsx": "DUPLICATE-STYLE-KEY", "hardcoded-background.tsx": "HARDCODED-BACKGROUND", "ternary-background.tsx": "HARDCODED-BACKGROUND" } as const;
if (process.argv[2] === undefined) {
  for (const [name, want] of Object.entries(CONTROLS)) {
    const src = readFileSync(`test/cards-negative/${name}`, "utf8");
    for (const screen of Array.isArray(want) ? want : [want]) {
      if (SCREENS[screen](src)) console.log(`control ${name}: ok, ${screen} fires`);
      else { console.log(`control ${name}: DETECTOR BLIND — ${screen} no longer fires`); bad++ }
    }
  }
  // A screen with no control is one nothing would notice going quiet — the state every screen
  // here was in before `test/cards-negative/` existed, and the state a newly added one starts
  // in. Cheap to enforce, and it is the difference between "found nothing" and "stopped looking".
  const controlled = new Set(Object.values(CONTROLS).flat());
  for (const screen of Object.keys(SCREENS)) {
    if (controlled.has(screen)) continue;
    console.log(`screen ${screen}: NO CONTROL — add a card to test/cards-negative/ that it must flag`);
    bad++;
  }
}

// It has counted `bad` since it was written and never acted on it — a checker that only ever
// prints is one nothing can fail against.
if (bad > 0) process.exit(1);
