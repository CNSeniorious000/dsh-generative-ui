/**
 * The screens, as named predicates rather than inline regexes — `test/cards-negative/` asserts
 * each one still fires, and a control that re-implements the rule it guards proves nothing.
 */
export const SCREENS = {
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
    // The JSX form for every name, not just `Fragment`. The `\s*[(<]` arm only sees a call or a
    // generic, so `<Suspense fallback={…}>` — the way Suspense is actually written — matched
    // nothing, and the screen was `Fragment`-only in practice.
    return [...src.matchAll(/<(Fragment|StrictMode|Suspense)\b|\b(Fragment|StrictMode|Suspense|memo|forwardRef)\s*[(<]/g)].some((m) => !imported.has(m[1] ?? m[2]));
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
  // The same key twice in one `style={{…}}`: the last wins and the first is silently dropped.
  // Nothing fails, so it survives until someone edits the dead line — the skill names it as one
  // of the two mistakes worth a checker round trip, and no screen here caught it.
  //
  // Brace-matched, and depth-1 keys only. A regex bounded by `}}` stops at the first nested
  // object and reports two cards that are fine; counting `{...spread, background: …}` as a
  // duplicate reports a third. Checked against `@genui/cli`, which agrees on exactly one.
  "DUPLICATE-STYLE-KEY": (src: string) => {
    for (const start of [...src.matchAll(/style=\{/g)].map((m) => m.index + m[0].length - 1)) {
      let depth = 0;
      const keys: string[] = [];
      for (let i = start; i < src.length; i += 1) {
        const char = src[i]!;
        if (char === "{" || char === "(" || char === "[") depth += 1;
        else if (char === "}" || char === ")" || char === "]") {
          depth -= 1;
          if (depth === 0) break;
        } else if (depth === 2 && (src[i - 1] === "{" || src[i - 1] === ",")) {
          const key = /^\s*([a-zA-Z]\w*)\s*:/.exec(src.slice(i));
          if (key !== null) keys.push(key[1]!);
        }
      }
      if (new Set(keys).size !== keys.length) return true;
    }
    return false;
  },
  // `style={labelStyle, { marginTop: 14 }}` — a comma operator, not a merge. JavaScript
  // evaluates `labelStyle`, throws it away, and applies only the object after the comma, so the
  // element silently loses every style the named object carried. The author meant
  // `{...labelStyle, marginTop: 14}`. Nothing fails: the card renders, one label unstyled.
  //
  // Found by running `@genui/cli` over the corpus, which reports it as "Left side of comma
  // operator is unused and has no side effects" — a message that names the mechanism and not
  // the mistake, which is why it is worth a screen with the fix in its name.
  // Comments are stripped first: a card explaining this very trap (`test/cards/near-misses`)
  // contains the bad form in prose, and a screen that reads prose reports the documentation
  // rather than the code — the same false positive `skill.ts` produces for the mutation audit.
  "COMMA-IN-STYLE": (src: string) => /style=\{\s*(?!\{)[A-Za-z_$][\w$]*\s*,/.test(src.replaceAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")),
  // `--dsw-alias-brand-primary` as a background with a light foreground on top. Despite the
  // name it is a *foreground* colour — it equals the body text colour in both themes (near-white
  // on dark, near-black on light), so a tile filled with it and white text on top is a white
  // square on dark and unreadable. The accent you fill with is `state-business-primary`.
  //
  // 50 of 378 cards fill with it and 12 pair it with a light foreground. Only the pairing is
  // screened: filling with it and putting `label-primary` on top is merely odd, while filling
  // with it and writing `#fff` is invisible half the time. The skill states this rule outright,
  // which makes it the clearest measure of a rule the prompt has not landed.
  "BRAND-PRIMARY-FILL": (src: string) =>
    [...src.matchAll(/background(?:Color)?:\s*[^,;}]*brand-primary[^,;}]*/g)].some((match) =>
      /color:\s*["']?(#fff\b|#ffffff\b|white\b|var\(--dsw-alias-bg-)/i.test(src.slice(match.index + match[0].length, match.index + match[0].length + 120))),
  // A control the keyboard cannot reach. Two shapes, both invisible to whoever wrote the card
  // because a mouse works either way: `onClick` on a `<div>` (no focus, no Enter, no Space), and
  // a button whose only content is an icon with no `aria-label` (a screen reader says "button").
  // 17 and 31 of 378 respectively — the two most common defects here after `BRAND-PRIMARY-FILL`.
  //
  // Comments stripped first, and the `<div>` arm requires the onClick to be on the DIV rather
  // than anywhere in its attributes, so `<div><button onClick=…>` is not a hit.
  "UNREACHABLE-CONTROL": (src: string) => {
    const code = src.replaceAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    if (/<div\b[^>]*\bonClick=/.test(code)) return true;
    // An ICON element only. A `{expr}` body is not an icon — most are `{playing ? "暂停" : "播放"}`,
    // which announces fine, and matching those took the report from 17 to 41 of 378.
    return [...code.matchAll(/<button\b[^>]*>[\s\n]*<[A-Z]\w*[^>]*\/>[\s\n]*<\/button>/g)]
      .some((match) => !match[0].includes("aria-label"));
  },
  // `outline: "none"` with nothing put back. 77 of 378 cards strip the focus ring and **0**
  // replace it, which makes this the most common single line here that breaks keyboard use:
  // tabbing through the card moves a cursor nobody can see. The replacement can be a
  // `:focus-visible` rule or a `boxShadow` driven by focus state, so both count.
  "NO-FOCUS-RING": (src: string) => {
    const code = src.replaceAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    return /outline:\s*["']none["']/.test(code) && !/:focus-visible|outlineOffset|outline-offset|boxShadow[^,;}]*focus|focus[^,;}]*boxShadow/i.test(code);
  },
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
