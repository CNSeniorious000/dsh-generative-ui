/**
 * The screens, as named predicates rather than inline regexes — `test/cards-negative/` asserts
 * each one still fires, and a control that re-implements the rule it guards proves nothing.
 */
/**
 * Negative-control cards owned by `replay-stream.ts` rather than by a screen.
 *
 * Lives here because `compile-cards.ts` exempts them from its ORPHANED check and
 * `replay-stream.ts` is the thing that justifies the exemption — written as a literal in the
 * exempting file, it would outlive its owner silently. Both import it from here; neither
 * imports the other, which would run a script as a side effect of a check.
 */
export const REPLAY_CONTROLS = ["late-hook.tsx"] as const;

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
  // An async EVENT HANDLER that awaits something slow and then setStates, with nothing to tell
  // it a newer run started. Click file A, click file B while A is still loading, and A's result
  // lands last and wins — the panel shows B selected with A's contents.
  //
  // `useEffect` has the `let cancelled = false` idiom and the corpus uses it; handlers mostly do
  // not (38 of 46 cards with such a handler, and 24 of those await `bash`, which has no bound).
  // Only slow awaits count: a `readFile` that returns in a millisecond cannot realistically be
  // overtaken, and screening it would report a third of the corpus for a race nobody can hit.
  "UNGUARDED-ASYNC-HANDLER": (src: string) => {
    const bodyAt = (open: number) => {
      let depth = 0;
      for (let i = open; i < src.length; i++) {
        if (src[i] === "{") depth += 1;
        else if (src[i] === "}") { depth -= 1; if (depth === 0) return src.slice(open, i + 1) }
      }
      return "";
    };
    // A guard is any comparison against a ref or flag a later run would have moved. Written to
    // accept either side of the `!==`: `id !== runId.current` is the spelling the corpus uses.
    const guarded = /cancelled|aborted|\bsignal\b|\.current\b[\s\S]{0,20}?[!=]==|[!=]==[\s\S]{0,20}?\.current\b|latest|stale/;
    return [...src.matchAll(/(?:const \w+ = async|async)\s*\([^)]*\)\s*=>\s*\{/g)].some((match) => {
      const body = bodyAt(match.index + match[0].length - 1);
      if (!/streamText|\bbash\(/.test(body) || !/set[A-Z]\w*\(/.test(body)) return false;
      return !guarded.test(body);
    });
  },
  // `Number(e.target.value)` straight into state from a `type="number"` field. Clearing it
  // yields `""`, and `Number("")` is **0** — so the reader cannot backspace to retype: the field
  // snaps to 0 the moment it empties. Typing a lone `-` gives `NaN`, which renders as blank and
  // takes every derived value with it.
  //
  // A `type="range"` slider cannot produce either (43 of the corpus's 74 occurrences are
  // sliders, and screening those would report a fifth of the corpus for an impossible input).
  // 16 of the 26 real cases already guard, which is what makes this a rule people can follow.
  "UNGUARDED-NUMBER-INPUT": (src: string) =>
    [...src.matchAll(/Number\((?:e|event)\.target\.value\)/g)].some((match) => {
      const before = src.slice(Math.max(0, match.index - 500), match.index);
      const tag = before.lastIndexOf("<input");
      if (tag === -1 || !/type="number"/.test(before.slice(tag))) return false;
      const handler = before.lastIndexOf("onChange");
      const window = src.slice(handler === -1 ? match.index - 120 : match.index - (before.length - handler), match.index + 160);
      return !/isNaN|Number\.isFinite|=== ""|\|\| 0|\?\?|parseFloat|value === ""/.test(window);
    }),
  // A `type="range"` with no label of any kind. A screen reader announces "slider, 40" — the
  // number rendered beside it is a separate element and is not connected to the control.
  //
  // Ranges only: a text field usually has a placeholder to fall back on, and a `<label>` wrapping
  // the input labels it as well as `aria-label` does. Tag ends are found by brace depth, because
  // `onChange={e => …}` puts a `>` inside the tag and a `[^>]*` regex stops there — which is how
  // the first count of this came out at 241 instead of 61.
  "UNLABELLED-SLIDER": (src: string) => {
    const tagAt = (start: number) => {
      let depth = 0;
      for (let i = start; i < src.length; i += 1) {
        if (src[i] === "{") depth += 1;
        else if (src[i] === "}") depth -= 1;
        else if (src[i] === ">" && depth === 0) return src.slice(start, i + 1);
      }
      return "";
    };
    return [...src.matchAll(/<input\b/g)].some((match) => {
      const tag = tagAt(match.index);
      if (!/type="range"/.test(tag) || /aria-label|aria-labelledby|\bid=/.test(tag)) return false;
      return !/<label/.test(src.slice(Math.max(0, match.index - 250), match.index));
    });
  },
  // Movement with no `prefers-reduced-motion` escape. The setting is not about taste: for people
  // with vestibular disorders a sliding or scaling element causes nausea, and the OS switch is
  // the only way they can say so.
  //
  // Movement, not every transition. 60 corpus cards transition only colour or opacity, which the
  // setting is not asking about — screening those reports a third of the corpus for a fade. What
  // is left is 47 cards transitioning `transform`/`all` and 16 with `@keyframes`, and **7 of 131
  // animating cards honour it at all**, the worst adherence rate measured here.
  "UNSTOPPABLE-MOTION": (src: string) =>
    !/prefers-reduced-motion/.test(src) &&
    // `transition: all` is NOT enough on its own: 9 corpus cards write it on a button whose only
    // animated properties are colour and border, and `all` there means nothing moves. Requires a
    // transform to exist somewhere — either named in the transition, or present as a property the
    // `all` would pick up.
    (/@keyframes/.test(src)
      || /transition(?:Property)?:\s*["']?[^;"'`}]*transform\b/.test(src)
      || (/transition(?:Property)?:\s*["']?[^;"'`}]*\ball\b/.test(src) && /transform:\s*(?:translate|scale|rotate|matrix)/.test(src))),
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
    // A `<div onClick>` is only unreachable if nothing makes it focusable. No corpus card gets
    // this right (0 of 19), but a screen that cannot be satisfied would flag the fix too.
    if ([...code.matchAll(/<div\b[^>]*\bonClick=[\s\S]*?>/g)].some((m) => !/tabIndex|onKeyDown|onKeyUp|onKeyPress|role=/.test(m[0]))) return true;
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
    // A replacement need not be an outline: a `focused` flag driving borderColor is the same
    // affordance, and `beaa3fbf962b` in the corpus does exactly that — the one false positive
    // in 76. Anything that reads a focus state and paints a border or shadow from it counts.
    const replaced = /:focus-visible|outlineOffset|outline-offset|boxShadow[^,;}]*focus|focus[^,;}]*boxShadow/i.test(code)
      || /\bfocus(?:ed)?\b[\s\S]{0,80}?\b(?:border|borderColor|boxShadow|outline)\b|\b(?:border|borderColor|boxShadow|outline)\b[^\n]{0,80}?\bfocus(?:ed)?\b/i.test(code);
    return /outline:\s*["']none["']/.test(code) && !replaced;
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
