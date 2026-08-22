import { expect, test } from "bun:test";
import initTsx, { transform } from "@esm.sh/tsx";
import { normalizeGeneratedTsx } from "partial-tsx";

await initTsx(await Bun.file("node_modules/@esm.sh/tsx/pkg/tsx_bg.wasm").arrayBuffer());

const compiles = (source: string) => {
  try {
    transform({ filename: "_.tsx", code: source, target: "es2022", jsxImportSource: "react" });
    return true;
  } catch {
    return false;
  }
};

/**
 * The failure this guards is the worst one this product has: rendering fine for the whole
 * stream and going blank on the last frame. The model routinely drops the trailing `)` and
 * `}` and goes straight to the closing fence, so `final` must normalize too.
 */
test("a reply that stops before its closing brackets still compiles when final", () => {
  const truncated = 'export default function A() {\n  return (\n    <div>hi</div>\n';
  expect(compiles(truncated)).toBe(false);
  expect(compiles(normalizeGeneratedTsx(truncated, { mode: "final" }))).toBe(true);
});

/**
 * The other half of the same rule: **the final compile must never be more fragile than a
 * streaming frame.** `createBrowserTsxCompiler` catches a failed `final` and retries as
 * `streaming`, because some damage is only recoverable by cutting the half-typed tail off.
 *
 * Measured across every prefix of all 362 corpus cards: `final` fails where `streaming`
 * succeeds in **718 of 13589** prefixes — 5.3%, so the fallback is load-bearing, not defensive.
 * The smallest real case is a truncated type declaration, which `final` cannot close.
 */
test("a prefix that only streaming can rescue is not lost by final", () => {
  const cut = 'import { useState } from "react"\n\ntype T';
  expect(compiles(normalizeGeneratedTsx(cut, { mode: "final" }))).toBe(false);
  expect(compiles(normalizeGeneratedTsx(cut, { mode: "streaming" }))).toBe(true);
});
