import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { normalizeGeneratedTsx } from "partial-tsx";
import { compileCard, initTsxFromDisk } from "../scripts/tsx-node.ts";

await initTsxFromDisk();

/**
 * `normalizeGeneratedTsx` exists to make a HALF-WRITTEN card parseable. On a card that is
 * already complete it must be a no-op — and on one real card it is not: it appends
 *
 *     ]</span></div></div>);})}</div></div>)}</div>)}
 *
 * to a 243-line regex tester that compiles perfectly without it, turning it into
 * `Expression expected at 243:1`. The card is fine; the repair breaks it.
 *
 * Zero of the 374 corpus cards that compile raw hit this, so it is rare and construct-specific
 * (a `<style>` block whose CSS braces the tracker appears to read as JSX braces). Kept as a
 * fixture because it was found by generating cards rather than by reading them, and the next
 * person to see `Expression expected` on a card that looks complete should find this first.
 */
test("the fixture compiles on its own — the card is not the problem", () => {
  const src = readFileSync(`${import.meta.dir}/fixtures/over-repaired.tsx`, "utf8");
  expect(() => compileCard("raw.tsx", src)).not.toThrow();
});

/**
 * Pinned as the CURRENT behaviour rather than the desired one.
 *
 * A permanently-red test breaks `bun run check` and teaches everyone to read past failures,
 * which costs more than this bug does. Asserting what actually happens means the day upstream
 * fixes it, this fails and says so — which is the notification we want.
 */
test("known upstream: normalize appends to this complete card and breaks it", () => {
  const src = readFileSync(`${import.meta.dir}/fixtures/over-repaired.tsx`, "utf8");
  const normalized = normalizeGeneratedTsx(src, { mode: "final" });
  expect(normalized.length).toBeGreaterThan(src.length);
  expect(() => compileCard("normalized.tsx", normalized)).toThrow();
});

/**
 * The repair's boundary, measured — and it decides which rules matter.
 *
 * `normalizeGeneratedTsx` will supply a **hook**: it inserts the whole `import … from "react"`
 * line when there is none, and extends an existing one with any hook it finds used. It will not
 * supply a JSX **component**. So:
 *
 *   - no import at all + `useState`            → repaired, renders
 *   - `import { useState }` + `useMemo(...)`   → repaired, renders
 *   - `import { useState }` + `<Fragment>`     → NOT repaired, `Fragment is not defined`, blank
 *
 * Only the third reaches a reader broken, which is why `MISSING-REACT-IMPORT` deliberately stays
 * quiet on the first two — and why *Import every name you write, `Fragment` included* is aimed
 * exactly where the repair cannot reach. Getting this wrong twice in one afternoon produced both
 * an overstated finding and a control card that did not break.
 */
test("normalize inserts a missing react import for a hook", () => {
  const src = `const T = { a: 1 };\nexport default function C() { const [n] = useState(0); return <b>{n}</b> }`;
  expect(normalizeGeneratedTsx(src, { mode: "final" })).toMatch(/^import \{[^}]*useState[^}]*\} from "react"/m);
});

test("normalize extends an existing react import with a hook", () => {
  const src = `import { useState } from "react";\nexport default function C() { const x = useMemo(() => 1, []); return <b>{x}</b> }`;
  expect(normalizeGeneratedTsx(src, { mode: "final" })).toMatch(/import \{[^}]*useMemo/);
});

test("normalize does NOT supply a JSX component", () => {
  const src = `import { useState } from "react";\nexport default function C() { return <Fragment><b/></Fragment> }`;
  expect(normalizeGeneratedTsx(src, { mode: "final" })).not.toMatch(/import \{[^}]*Fragment/);
});

/**
 * `useReducer` specifically, because auditing the screens flagged it as a hole and it is not.
 * `MISSING-REACT-IMPORT` deliberately skips every `/^use[A-Z]/` name — `normalizeGeneratedTsx`
 * extends an existing react import with any hook it finds used. Verified by rendering: a card
 * calling `useReducer` with only `useState` imported paints.
 *
 * The component names in the same list (`Fragment`, `StrictMode`, `Suspense`, `memo`,
 * `forwardRef`) are NOT repaired, which is the whole reason the screen exists.
 */
test("useReducer is repaired, so the screen is right to stay quiet", () => {
  const source = `import { useState } from "react";\nexport default function C() { const [n, d] = useReducer(r, 0); return <button onClick={() => d("i")}>{n}</button> }`;
  expect(normalizeGeneratedTsx(source, { mode: "final" })).toContain("useReducer");
  expect(/import \{[^}]*useReducer[^}]*\} from "react"/.test(normalizeGeneratedTsx(source, { mode: "final" }))).toBe(true);
});
