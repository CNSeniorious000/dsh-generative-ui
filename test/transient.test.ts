/**
 * Which failures are retried and which reach the reader.
 *
 * Both patterns are matched against `error.message`, and the strings are the browser's, not
 * ours — so the only honest inputs are ones a browser really produced. Every string below was
 * captured from Chromium by importing a module that fails in that particular way.
 */
import { describe, expect, test } from "bun:test";
import { isUnfinishedFrame, TRANSIENT, TRANSIENT_LOAD } from "../src/client/runtime/GenUISurface.tsx";

describe("TRANSIENT_LOAD — a dependency that did not arrive", () => {
  // The one Chromium actually produces, for a 404, an unknown package and a dead host alike.
  test("a failed dynamic import is retried", () => {
    for (const message of ["Failed to fetch dynamically imported module: https://esm.sh/recharts?target=es2022", "Failed to fetch dynamically imported module: http://127.0.0.1:47791/x.js"]) expect(TRANSIENT_LOAD.test(message)).toBe(true);
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

/**
 * The three cards in the 378-card corpus that genuinely do not compile, with the messages the
 * compiler really produced — not messages written to match the pattern.
 *
 * These must reach the reader. Suppressing one is a card that renders blank forever with an
 * empty console, which is the failure this project spends the most effort on; and each is a
 * different shape (a JSX close, a brace, an arrow in an expression position), so a pattern that
 * accidentally widened to cover "Expected" would fail here.
 */
test("no real corpus compile failure is suppressed", () => {
  for (const message of ["Expected '</', got 'ident' at 0c24e4dad59d.tsx:119:35", "An arrow function is not allowed here at 2f7a87253134.tsx:150:56", "Expected '</', got '}' at 5745802818e1.tsx:43:23"]) {
    expect(TRANSIENT.test(message)).toBe(false);
    expect(TRANSIENT_LOAD.test(message)).toBe(false);
  }
});

/**
 * Suppression is about the parse stages, not the message alone.
 *
 * `No default export found` is thrown inside `importCompiledComponent` and an unexpected EOF
 * comes from the transform rejecting a prefix — both reach us as `compile` or `transform`. A
 * card whose own render throws a matching string is a real error, and suppressing it leaves the
 * reader with a blank surface and nothing in the console.
 */
test("an unfinished frame is suppressed only from the parse stages", () => {
  expect(isUnfinishedFrame("No default export found in compiled module.", "compile", true)).toBe(true);
  expect(isUnfinishedFrame("Unexpected end of file", "transform", true)).toBe(true);
  expect(isUnfinishedFrame("No default export found in compiled module.", "render", true)).toBe(false);
  // ...and never once the card has settled.
  expect(isUnfinishedFrame("Unexpected eof", "compile", false)).toBe(false);
});
