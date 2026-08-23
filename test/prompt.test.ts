/**
 * The inline prompt, checked for the things that break it silently.
 *
 * `prompt.ts` is one long template literal and nothing imported it in a test, so its failure
 * modes were invisible: a stray backtick ends the literal (lint catches that one), and a rule
 * quietly lost in an edit does not fail anything at all. This session added six rules, each for
 * a card that reached a reader broken — a regression here is a card breaking again.
 */
import { expect, test } from "bun:test";
import { FENCE_LANG } from "../src/contract.ts";
import { INLINE_PROMPT } from "../src/prompt.ts";

/**
 * Every rule here exists because a real corpus card failed without it. Matched on a short
 * distinctive phrase rather than the whole sentence, so rewording a rule is free and deleting
 * one is not.
 */
const RULES = [
  ["the fence language", `\`${FENCE_LANG}\`, never \`tsx\``],
  ["export named after an import", "Never name it after something you imported"],
  ["useState vs useMemo", "holds state"],
  ["Fragment must be imported", "Import every name you write"],
  ["a regex or glob in JSX text", "brace in JSX text is an expression"],
  ["px inside a style object", "is JavaScript, not CSS"],
  ["an arrow after &&", "chain into an arrow function"],
  ["empty is not undefined", "not a guard against empty"],
  ["no literal colours", "Never write literal colors"],
  ["a non-zero exit resolves", "do not catch it"],
] as const;

for (const [name, phrase] of RULES) {
  test(`the prompt still carries the rule about ${name}`, () => {
    expect(INLINE_PROMPT).toContain(phrase);
  });
}

// The whole file is one template literal: an unescaped backtick silently ends it early, taking
// every rule after it with it. Lint catches the syntax error only when the truncation happens to
// leave something illegal — a length floor catches the case where it does not.
test("the prompt is whole", () => {
  expect(INLINE_PROMPT.length).toBeGreaterThan(8000);
  expect(INLINE_PROMPT).toContain("## Colors");
  expect(INLINE_PROMPT).toContain("## Width");
});
