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

/**
 * The screens, as named predicates rather than inline regexes — `test/cards-negative/` asserts
 * each one still fires, and a control that re-implements the rule it guards proves nothing.
 */
const SCREENS = {
  // `export default function Pie` next to `import { Pie } from "recharts"`: the card renders
  // itself, and dies with no useful error.
  "SHADOWED-EXPORT": (src: string) => {
    const def = /export default function (\w+)/.exec(src)?.[1];
    const imported = [...src.matchAll(/import\s*\{([^}]+)\}\s*from/g)].flatMap((m) => m[1].split(",").map((x) => x.trim().split(/\s+as\s+/).pop()!.trim()));
    return def !== undefined && imported.includes(def);
  },
  // JSX only, not generics: `<Foo[k] />` is illegal, `useState<Foo[]>` is everywhere. An
  // immediate `]` was the original discriminator and it is not enough — `Record<Step["channel"],
  // string>` has an index expression too, and was the checker's only hit in 362 real cards.
  // What separates them is what comes after the bracket: a JSX tag continues into attributes or
  // closes, a type argument continues into `,` or `>`.
  "JSX-SUBSCRIPT": (src: string) => /<[A-Z]\w*\[[^\]]+\]\s*(\/?>|[a-zA-Z-]+=)/.test(src),
  "VIEWPORT-UNITS": (src: string) => /100v[wh]|position:\s*["']?fixed/.test(src),
} as const;

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
const CONTROLS = { "jsx-subscript.tsx": "JSX-SUBSCRIPT", "shadowed-export.tsx": "SHADOWED-EXPORT" } as const;
if (process.argv[2] === undefined) {
  for (const [name, want] of Object.entries(CONTROLS)) {
    if (SCREENS[want](readFileSync(`test/cards-negative/${name}`, "utf8"))) console.log(`control ${name}: ok, ${want} fires`);
    else { console.log(`control ${name}: DETECTOR BLIND — ${want} no longer fires`); bad++ }
  }
}

// It has counted `bad` since it was written and never acted on it — a checker that only ever
// prints is one nothing can fail against.
if (bad > 0) process.exit(1);
