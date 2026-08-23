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
 * The repair's boundary, which decides how much two different screens matter.
 *
 * `normalizeGeneratedTsx` adds a MISSING react import line, and does not extend an existing one.
 * So a card with no import at all that calls `useState` is repaired and renders; a card importing
 * `useState` that writes `<Fragment>` is not, and paints nothing. The first is why the two blank
 * fresh cards would in fact have worked for a reader; the second is why the original
 * *Import every name you write* rule exists and is aimed where it is.
 *
 * If upstream starts extending existing imports, this fails — and the `Fragment` rule can then be
 * demoted, which is worth knowing rather than discovering by accident.
 */
test("normalize adds a missing react import", () => {
  const src = `const T = { a: 1 };\nexport default function C() { const [n] = useState(0); return <b>{n}</b> }`;
  expect(normalizeGeneratedTsx(src, { mode: "final" })).toMatch(/^import \{[^}]*useState[^}]*\} from "react"/m);
});

test("normalize does NOT extend an existing react import", () => {
  const src = `import { useState } from "react";\nexport default function C() { const [n] = useState(0); return <Fragment>{n}</Fragment> }`;
  const out = normalizeGeneratedTsx(src, { mode: "final" });
  expect(out).not.toMatch(/import \{[^}]*Fragment/);
});
