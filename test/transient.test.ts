/**
 * Which failures are retried and which reach the reader.
 *
 * Both patterns are matched against `error.message`, and the strings are the browser's, not
 * ours — so the only honest inputs are ones a browser really produced. Every string below was
 * captured from Chromium by importing a module that fails in that particular way.
 */
import { describe, expect, test } from "bun:test";
import { TRANSIENT, TRANSIENT_LOAD } from "../src/client/runtime/GenUISurface.tsx";

describe("TRANSIENT_LOAD — a dependency that did not arrive", () => {
  // The one Chromium actually produces, for a 404, an unknown package and a dead host alike.
  test("a failed dynamic import is retried", () => {
    for (const message of [
      "Failed to fetch dynamically imported module: https://esm.sh/recharts?target=es2022",
      "Failed to fetch dynamically imported module: http://127.0.0.1:47791/x.js",
    ]) expect(TRANSIENT_LOAD.test(message)).toBe(true);
  });

  // Firefox and Safari word it differently; both were in the pattern before this test existed.
  test("the other engines' wording is covered", () => {
    expect(TRANSIENT_LOAD.test("NetworkError when attempting to fetch resource.")).toBe(true);
    expect(TRANSIENT_LOAD.test("Load failed")).toBe(true);
  });

  // **Not** retried, and correctly so: an unresolvable bare specifier means the import map has
  // no entry for it, and no amount of retrying adds one. `mergeFallbackImports` is what fixes
  // this, and it runs on the import-set change rather than on an error.
  test("an unresolvable specifier is shown, not retried", () => {
    expect(TRANSIENT_LOAD.test("Failed to resolve module specifier 'recharts'")).toBe(false);
  });

  test("a real code error is shown", () => {
    expect(TRANSIENT_LOAD.test("item.difficulty is undefined")).toBe(false);
  });
});

describe("TRANSIENT — a frame that is merely incomplete", () => {
  // Mid-stream the card legitimately has no default export yet; surfacing that would flash an
  // error on every card while the model types.
  test("an unfinished frame is suppressed while streaming", () => {
    expect(TRANSIENT.test("No default export found")).toBe(true);
    expect(TRANSIENT.test("Unexpected end of file")).toBe(true);
    expect(TRANSIENT.test("Unexpected eof")).toBe(true);
  });

  test("a settled compile error is not suppressed", () => {
    expect(TRANSIENT.test("Expected '</', got '}'")).toBe(false);
    expect(TRANSIENT.test("An arrow function is not allowed here")).toBe(false);
  });
});
