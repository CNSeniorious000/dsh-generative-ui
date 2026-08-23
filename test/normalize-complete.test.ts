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
