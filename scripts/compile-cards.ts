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
  // Both spellings of the default export. 377 of 378 corpus cards write `export default
  // function X`, and the screen only knew that one — the 378th writes `const X = () => …;
  // export default X`, which shadows exactly the same way and was invisible.
  "SHADOWED-EXPORT": (src: string) => {
    const def = (/export default function (\w+)/.exec(src) ?? /export default ([A-Z]\w*)\s*;?\s*$/m.exec(src))?.[1];
    const imported = [...src.matchAll(/import\s*\{([^}]+)\}\s*from/g)].flatMap((m) => m[1].split(",").map((x) => x.trim().split(/\s+as\s+/).pop()!.trim()));
    return def !== undefined && imported.includes(def);
  },
  // JSX only, not generics: `<Foo[k] />` is illegal, `useState<Foo[]>` is everywhere. An
  // immediate `]` was the original discriminator and it is not enough — `Record<Step["channel"],
  // string>` has an index expression too, and was the checker's only hit in 362 real cards.
  // What separates them is what comes after the bracket: a JSX tag continues into attributes or
  // closes, a type argument continues into `,` or `>`.
  "JSX-SUBSCRIPT": (src: string) => /<[A-Z]\w*\[[^\]]+\]\s*(\/?>|[a-zA-Z-]+=)/.test(src),
  // A card is a component on someone else's page, so both halves are the same mistake: sizing
  // against the window rather than the container it was given. `100vh` is the two real hits in
  // 378; the `fixed` half has never fired on a corpus card and is kept because the prompt names
  // it as a rule — `test/cards-negative/fixed-overlay.tsx` is what keeps it from rotting.
  "VIEWPORT-UNITS": (src: string) => /100v[wh]|position:\s*["']?fixed/.test(src),
  // A hook called outside every function body. Compiles perfectly and dies at first render with
  // React error #321 — the class §4 says only rendering catches, except this one is visible in
  // the source: a hook at **column 0** is in no component by definition. Anchored there and
  // nowhere else; allowing leading whitespace matches the `useEffect` inside 109 of 378 cards.
  // `const [a, setA] = useMemo(…)`. Only `useState` and `useReducer` return a pair; the others
  // return one value, so destructuring throws "not iterable" at render and the card is blank.
  "DESTRUCTURED-HOOK": (src: string) => /(?:const|let)\s*\[[^\]]+\]\s*=\s*(?:useMemo|useCallback|useRef|useEffect)\s*\(/.test(src),
  // A React export used without importing it — `<Fragment>` with only `useState` imported.
  // Skipped entirely when the card does a namespace or default import, which brings everything.
  "MISSING-REACT-IMPORT": (src: string) => {
    if (/import\s+\*\s+as\s+\w+\s+from\s*["']react["']|import\s+React\s*(?:,|from)/.test(src)) return false;
    const imported = new Set([...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']react["']/g)].flatMap((m) => m[1].split(",").map((x) => x.trim().split(/\s+as\s+/).pop()!.trim())));
    return [...src.matchAll(/<(Fragment)\b|\b(Fragment|StrictMode|Suspense|memo|forwardRef)\s*[(<]/g)].some((m) => !imported.has(m[1] ?? m[2]));
  },
  // `xs[xs.length - 1].field` on an array that came from outside the card. A `!xs` guard passes
  // for `[]`, so an empty result — a repo with no commits, a failed command, an empty directory —
  // renders blank. Restricted to externally-filled arrays on purpose: three other cards in 378
  // index the last element of an array they built from a literal or a counted loop, which cannot
  // be empty, and flagging those is how a screen becomes noise.
  "UNGUARDED-LAST-INDEX": (src: string) => {
    // Both ends of the array, and EVERY match rather than the first. One card indexes `[0]` and
    // `[length - 1]`, so a screen that knew only one shape would go quiet the moment the author
    // reached for the other end — and taking only the first match lets one benign index on a
    // literal array hide every real one after it. Neither costs anything: the report is 1 of 378
    // either way, and the difference only shows up on a card not yet written.
    const names = [
      ...[...src.matchAll(/(\w+)\[\s*(\w+)\.length\s*-\s*1\s*\]\s*\./g)].filter((m) => m[1] === m[2]).map((m) => m[1]!),
      ...[...src.matchAll(/(\w+)\[\s*0\s*\]\s*\./g)].map((m) => m[1]!),
    ];
    // Externally-filled arrays only, on purpose: three other cards index the last element of an
    // array they built from a literal or a counted loop, which cannot be empty, and flagging
    // those is how a screen becomes noise.
    return /\$dsh\/(exec|fs|ai)/.test(src) && names.some((name) =>
      new RegExp(`set${name[0]!.toUpperCase()}${name.slice(1)}\\b`).test(src) &&
      !new RegExp(`${name}\\.length\\s*(===?\\s*0|>\\s*0|\\?)|!${name}\\.length`).test(src));
  },
  // A light surface colour written as a literal: `background: "#fff"`. The card has assumed a
  // white page, so it renders white-on-white in dark mode. Three of 378 corpus cards match, and
  // they are the dark-mode failures found by rendering — every other hardcoded colour in the
  // corpus is a chart series or an accent, not a surface.
  //
  // Backgrounds only, deliberately. Six corpus cards ignore the token rule entirely, but the
  // other three fail it with light *text* (`color: "#fff"` on a coloured button), which is
  // correct on both themes — widening this to any extreme luminance reports all six and three of
  // them are fine. It is the surface that has to come from the theme.
  //
  // The value is matched, not the line. A first version anchored on `background: "#` and missed
  // a third card whose surface is behind a multi-line ternary (`active ? "#dcfce7" : "#fff"`),
  // which is how a model actually writes a selected state.
  // The no-token half is load-bearing after all: 35 corpus cards paint a `#fff` surface *and*
  // use design tokens elsewhere, which is a deliberate light accent on a themed card. An earlier
  // version dropped this clause after measuring that it changed nothing — that measurement was
  // taken against the narrower regex, which never saw those 35.
  "HARDCODED-BACKGROUND": (src: string) =>
    !/dsw-alias|dsw-token/.test(src) &&
    [...src.matchAll(/background(?:Color)?\s*:\s*((?:[^,{}]|\{[^{}]*\})*)/gi)].some((match) => /#(?:fff|ffffff|fafafa|f8fafc|f9fafb|fefefe)\b/i.test(match[1])),
  // A glob written as JSX text: `<code>src/*.{ts,tsx}</code>`. Inside JSX those braces are an
  // expression, so `{ts,tsx}` is a comma expression over two identifiers that do not exist and
  // the card throws `ts is not defined` at render — a card explaining glob syntax breaks by
  // quoting a glob. I first recorded this as unscreenable; it is not. A real expression names
  // something **bound somewhere in the file**, and a glob's parts are bound nowhere. Requiring
  // a genuine binding site (declaration, parameter, import) rather than "the name appears on a
  // line with a keyword" is what takes this from 0 hits to exactly the one failing card.
  "GLOB-IN-JSX": (src: string) =>
    [...src.matchAll(/>[^<>{}]*\{([^{}]{1,40})\}[^<>{}]*</g)]
      .map((match) => match[1].trim())
      .filter((expression) => /^[a-zA-Z_$][\w$]*(?:\s*,\s*[a-zA-Z_$][\w$]*)+$/.test(expression))
      .some((expression) =>
        expression.split(",").every((part) => {
          const name = part.trim();
          return !new RegExp(`(?:const|let|var|function)\\s+${name}\\b|\\b${name}\\s*(?:,\\s*\\w+)?\\s*\\)\\s*=>|\\(\\s*${name}\\b[^)]*\\)\\s*=>|\\{[^}]*\\b${name}\\b[^}]*\\}\\s*(?:=|from)`).test(src);
        }),
      ),
  // A hook called outside a component — it throws before anything renders. `export const` as
  // well as bare `const`: a card splitting its state into an exported helper writes the former,
  // and the screen's anchor would have walked straight past it.
  "MODULE-SCOPE-HOOK": (src: string) => /^(?:export\s+)?(?:(?:const|let|var)\s+[\w{}[\],\s:]+=\s*)?use[A-Z]\w*\s*\(/m.test(src),
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
const CONTROLS = { "jsx-subscript.tsx": "JSX-SUBSCRIPT", "fixed-overlay.tsx": "VIEWPORT-UNITS", "shadowed-const.tsx": "SHADOWED-EXPORT", "exported-module-hook.tsx": "MODULE-SCOPE-HOOK", "shadowed-export.tsx": "SHADOWED-EXPORT", "module-scope-hook.tsx": "MODULE-SCOPE-HOOK", "blank-render.tsx": ["DESTRUCTURED-HOOK", "MISSING-REACT-IMPORT"], "empty-result.tsx": "UNGUARDED-LAST-INDEX", "empty-first.tsx": "UNGUARDED-LAST-INDEX", "empty-second.tsx": "UNGUARDED-LAST-INDEX", "glob-in-jsx.tsx": "GLOB-IN-JSX", "hardcoded-background.tsx": "HARDCODED-BACKGROUND", "ternary-background.tsx": "HARDCODED-BACKGROUND" } as const;
if (process.argv[2] === undefined) {
  for (const [name, want] of Object.entries(CONTROLS)) {
    const src = readFileSync(`test/cards-negative/${name}`, "utf8");
    for (const screen of Array.isArray(want) ? want : [want]) {
      if (SCREENS[screen](src)) console.log(`control ${name}: ok, ${screen} fires`);
      else { console.log(`control ${name}: DETECTOR BLIND — ${screen} no longer fires`); bad++ }
    }
  }
}

// It has counted `bad` since it was written and never acted on it — a checker that only ever
// prints is one nothing can fail against.
if (bad > 0) process.exit(1);
