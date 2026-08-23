/**
 * A screen must not accuse a card of something it has not written yet.
 *
 * The screens run on settled cards today, but the obvious next use is warning while the model
 * is still typing — and a screen that fires on a prefix and clears when the card finishes would
 * report a card that is fine. Measured over every 10% prefix of all 378 corpus cards: exactly
 * one screen does that, and it is inherent rather than a defect (see below).
 *
 * Kept as a property rather than a plan: it costs one test and it is the kind of thing that
 * quietly stops being true when a screen is widened.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SCREENS } from "../scripts/screens.ts";

const CARDS = ["test/cards/2048.ui4a.tsx", "test/cards/metro.ui4a.tsx", "test/cards/piano.ui4a.tsx", "test/cards/near-misses.ui4a.tsx"];

/**
 * `NO-FOCUS-RING` is the exception, and it cannot be otherwise: it fires on `outline: "none"`
 * and clears when the replacement appears, so every card that does the right thing looks wrong
 * for the moment between the two. The rest have no such ordering.
 */
const PREFIX_UNSAFE = new Set(["NO-FOCUS-RING"]);

test("no screen accuses a card of something it has not finished writing", () => {
  const offenders = new Set<string>();
  for (const path of CARDS) {
    const src = readFileSync(path, "utf8");
    const settled = new Set(Object.entries(SCREENS).filter(([, fires]) => fires(src)).map(([name]) => name));
    for (let pct = 10; pct < 100; pct += 10) {
      const prefix = src.slice(0, Math.floor((src.length * pct) / 100));
      for (const [name, fires] of Object.entries(SCREENS)) {
        if (fires(prefix) && !settled.has(name) && !PREFIX_UNSAFE.has(name)) offenders.add(`${name} on ${path} at ${pct}%`);
      }
    }
  }
  expect([...offenders]).toEqual([]);
});
