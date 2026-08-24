import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

/**
 * CLAUDE.md calls itself the design doc — "where they disagree, this file wins and the drift is a
 * bug" — so a script nobody has written down is drift in the direction the file claims to control.
 * A tool that exists and is undiscoverable gets rebuilt: this session rebuilt `smoke.ts` from
 * scratch without noticing it existed, and the cost was an hour.
 *
 * Matched on the basename, not the whole filename. The record cites most scripts as
 * `bun run cross-tab` or `scripts/flaky-dep-server.py` rather than by bare filename, and a strict
 * match reports eight files that are all documented — a check that fires on correct prose is one
 * people learn to ignore.
 */
test("every script is named in CLAUDE.md", () => {
  const doc = readFileSync("CLAUDE.md", "utf8");
  const stem = (name: string) => name.replace(/\.(ts|sh|py|mjs|md|html)$/, "");
  const missing = readdirSync("scripts").filter((name) => !doc.includes(stem(name)));
  expect(missing).toEqual([]);
});
