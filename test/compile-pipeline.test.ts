/**
 * `createBrowserTsxCompiler`, exercised for real.
 *
 * `compiler.test.ts` asserts on `normalizeGeneratedTsx` + `transform` directly — a re-implementation
 * of this pipeline, which therefore agrees with it forever. Measured: rewriting every `return` in
 * `compiler.ts` to `undefined` (six real mutations) leaves that file **entirely green**. This one
 * imports the module, so it does not.
 *
 * The wasm arrives over `WASM_PATH`, an HTTP route, so the test serves it — the same contract the
 * browser half uses, rather than the disk loader the scripts use.
 */
import { restoreGlobals } from "./globals.ts";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { WASM_PATH } from "../src/contract-assets.ts";
import { createBrowserTsxCompiler, disposeCompiler } from "../src/client/runtime/compiler.ts";

let server: ReturnType<typeof Bun.serve>;
beforeAll(() => {
  // A random high port: the plugin's own routes are mounted by the shell, not by us.
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (new URL(req.url).pathname !== WASM_PATH) return new Response("no", { status: 404 });
      return new Response(await Bun.file("node_modules/@esm.sh/tsx/pkg/tsx_bg.wasm").arrayBuffer(), { headers: { "content-type": "application/wasm" } });
    },
  });
  // The browser resolves `WASM_PATH` against the page origin; bun's `fetch` has no origin at
  // all, so the relative path is rewritten to an absolute one for the duration of the test.
  const realFetch = globalThis.fetch;
  (globalThis as any).fetch = (input: any, init?: any) => realFetch(typeof input === "string" && input.startsWith("/") ? new URL(input, server.url.origin).href : input, init);
});
// `restoreGlobals` puts back the real fetch — this file replaces it for the whole file, so
// the restore belongs at the same scope as the install.
afterAll(() => {
  disposeCompiler();
  server.stop(true);
  restoreGlobals();
});

const compile = (code: string, options?: Parameters<ReturnType<typeof createBrowserTsxCompiler>["compile"]>[1]) => createBrowserTsxCompiler().compile(code, options);

describe("createBrowserTsxCompiler", () => {
  test("compiles a settled card", async () => {
    const { code, changed } = await compile("export default function A() { return <div>hi</div> }");
    expect(code).toContain("jsx");
    expect(changed).toBe(true);
  });

  // The rule the whole product rests on: a card that renders every streaming frame must not go
  // blank on the last one. The model routinely stops before its closing brackets.
  test("a card missing its closing brackets still compiles when settled", async () => {
    const { code } = await compile("export default function A() {\n  return (\n    <div>hi</div>\n");
    expect(code).toContain("jsx");
  });

  // The final→streaming fallback. `final` cannot close a truncated type declaration; `streaming`
  // cuts it off. Measured across every prefix of all 362 corpus cards: this rescues 718 of 13589.
  test("a prefix only streaming can rescue still compiles when settled", async () => {
    const { code } = await compile('import { useState } from "react"\n\ntype T');
    expect(typeof code).toBe("string");
  });

  test("changed is false when the output matches previousCode", async () => {
    const first = await compile("export default function A() { return <div /> }");
    const again = await compile("export default function A() { return <div /> }", { previousCode: first.code });
    expect(again.changed).toBe(false);
  });
});

/**
 * That the settled path never returns something that does not compile.
 *
 * The pipeline has two chances: `final`, then `streaming` if that throws. Whether the tail
 * survives is NOT the guarantee — an unclosed array literal normalizes under `final` to
 * `[1, 2,\n  return <div/>\n}];}`, which keeps every character and does not parse, so the
 * fallback correctly prefers the cut-back version that does. I wrote the opposite assertion
 * first and this input disproved it.
 *
 * What the code really promises is that *something compiles*, and that is what is tested.
 */
test("every settled card yields output that compiles", async () => {
  for (const card of ["export default function A() {\n  const rows = [1, 2,\n  return <div>x</div>\n}", "export default function A() {\n  return (\n    <div>hi</div>\n", 'export default function A() {\n  return <div className="ab']) {
    // Compiling is the promise; a non-empty result is not. `type T` alone normalizes to the
    // empty string, which compiles to nothing — see the note below.
    expect((await compile(card)).code.length).toBeGreaterThan(0);
  }
});

/**
 * The fallback's real value is smaller than "718 prefixes rescued" suggests.
 *
 * `final` failing and `streaming` succeeding happens in 718 of 13589 corpus prefixes — but in
 * 241 of those the rescued module has **no default export left**, because cutting back the
 * half-typed tail cut past everything renderable. `import … type T` is the extreme case: it
 * normalizes to the empty string, compiles fine, and renders nothing.
 *
 * So the fallback turns a thrown error into a blank surface 241 times and into a real card 477
 * times. Both beat an exception mid-stream, and this test pins the distinction so the number in
 * CLAUDE.md is not read as "718 cards saved".
 */
test("a rescue can be empty, and that is still a rescue", async () => {
  const { code } = await compile('import { useState } from "react"\n\ntype T');
  expect(code).not.toContain("export default");
});

/**
 * `partial: true` is the streaming path and must not take the settled one.
 *
 * The two branches differ only in that `final` tries to close the card before cutting it back,
 * so on most inputs they agree — which is why inverting this one condition passed every test
 * above. The unclosed array literal separates them: `final` keeps the body and fails to parse,
 * `streaming` cuts back to a bare component that renders.
 */
test("a partial frame takes the streaming path", async () => {
  // The input has to be one where BOTH modes compile, or the settled path's catch falls back to
  // streaming and the two produce identical output — which is how the first two candidates I
  // tried passed with the condition inverted. An unclosed `.map(` is the separating case:
  // `final` closes it as `{items.map(i => (null))}`, `streaming` cuts back to `<div></div>`.
  const frame = "export default function A() {\n  return <div>{items.map(i => (\n";
  expect((await compile(frame, { partial: true })).source).not.toContain("items.map");
  expect((await compile(frame)).source).toContain("items.map");
});

/**
 * `import.meta.resolve("…")` is rewritten against the import map before the compiler runs.
 *
 * This is the one line in the module that no test reached: deleting the rewrite entirely — passing
 * `source` straight through — left all 163 tests green. It is a runtime asset lookup, not a module
 * edge, so nothing downstream fails loudly when it silently keeps the bare specifier and the card
 * asks the browser for a URL named `some-asset`.
 */
test("import.meta.resolve is rewritten against the import map", async () => {
  const source = 'export const url = import.meta.resolve("some-asset")\nexport default function A() { return <div>{url}</div> }';
  const mapped = await compile(source, { importMap: { imports: { "some-asset": "https://esm.sh/some-asset" } } });
  expect(mapped.code).toContain("https://esm.sh/some-asset");
  // No map, no rewrite: the specifier survives as written rather than being resolved to nothing.
  expect((await compile(source)).code).toContain("some-asset");
});
