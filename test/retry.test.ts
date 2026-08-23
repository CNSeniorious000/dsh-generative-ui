/**
 * That a retry actually reaches the network.
 *
 * The module registry caches a failed `import()` as a rejection for the page's lifetime, so
 * re-importing the same URL never re-fetches — measured in Chromium, 2 resource entries for 3
 * imports. `GenUISurface`'s retry therefore has to change the URL, and this holds the rule that
 * makes that work.
 *
 * A real browser is not needed for the part that can regress: the busting is a pure string
 * transform, and the property that matters is that consecutive attempts produce **different**
 * URLs for esm.sh entries and **identical** ones for local blobs.
 *
 * Imported, not re-declared. A test that copies the transform it guards only proves two copies
 * agree — which is how `compiler.test.ts` stayed green through six real mutations.
 */
import { describe, expect, test } from "bun:test";
import { bustFetchedImports, shouldRetry } from "../src/client/runtime/GenUISurface.tsx";

const bust = (url: string, attempt: number) => bustFetchedImports({ x: url }, attempt).x;

describe("retry URL busting", () => {
  test("consecutive attempts produce different URLs", () => {
    const url = "https://esm.sh/recharts?target=es2022";
    expect(bust(url, 1)).not.toBe(bust(url, 2));
    expect(bust(url, 1)).not.toBe(url);
  });

  // A specifier with no query gets `?`, one with a query gets `&` — an esm.sh URL carrying
  // `?target=es2022&ui4a-retry=1` is what the fix actually sends, and `??` would 400.
  test("the separator matches what the URL already has", () => {
    expect(bust("https://esm.sh/minimatch", 1)).toBe("https://esm.sh/minimatch?ui4a-retry=1");
    expect(bust("https://esm.sh/recharts?target=es2022", 1)).toBe("https://esm.sh/recharts?target=es2022&ui4a-retry=1");
  });

  // Local blob URLs are minted fresh per render and must not be touched: appending a query to a
  // blob URL makes it unresolvable, which would break every card instead of fixing one.
  test("blob and relative URLs are left alone", () => {
    for (const url of ["blob:http://localhost:5173/8f2c-…", "/_ui4a/tsx_bg.wasm"]) expect(bust(url, 3)).toBe(url);
  });
});

/**
 * When a retry is worth doing at all.
 *
 * Retrying busts the esm.sh URLs and re-imports, which fixes exactly one thing: a dependency
 * that failed to arrive. `partial-react` reports that as the **compile** phase —
 * `importCompiledComponent` runs inside the compile `catch` (`runtime.ts:338`). The same
 * message from the render phase is the card's own `fetch` throwing inside its body, where
 * re-importing changes nothing and the three attempts cost the reader 2.4s of blank surface
 * before anyone tells them what happened. The phase check had been missing.
 */
describe("shouldRetry", () => {
  test("a dependency that failed to load is retried", () => {
    expect(shouldRetry("Failed to fetch", "compile", false, 0)).toBe(true);
    expect(shouldRetry("NetworkError when attempting to fetch resource.", "compile", false, 2)).toBe(true);
  });

  test("the same message from the card's own body is not", () => {
    expect(shouldRetry("Failed to fetch", "render", false, 0)).toBe(false);
    expect(shouldRetry("Failed to fetch", "transform", false, 0)).toBe(false);
  });

  test("a real code error is never retried", () => {
    expect(shouldRetry("item.difficulty is undefined", "compile", false, 0)).toBe(false);
  });

  // While streaming the next frame re-delivers on its own, and a retry would replace the
  // growing buffer with a stale prefix.
  test("a streaming surface is not retried", () => {
    expect(shouldRetry("Failed to fetch", "compile", true, 0)).toBe(false);
  });

  test("the attempts run out", () => {
    expect(shouldRetry("Failed to fetch", "compile", false, 3)).toBe(false);
  });
});
