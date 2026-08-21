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
