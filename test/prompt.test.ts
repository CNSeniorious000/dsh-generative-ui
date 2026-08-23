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
import { skillBody } from "../src/skill.ts";

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

/**
 * The skill body — 25 KB of judgement, assembled from a template with two optional interpolations
 * and, until now, nothing checking that any of it arrives. Its failure mode is not an exception:
 * a section lost to a stray backtick or a bad edit means the model silently stops being told
 * something, and the evidence is a worse card weeks later.
 */
/**
 * Rules added to the SKILL after measuring how often 378 real cards followed them — each one
 * replaced a paragraph that was landing at 0-7%, and each is here so a future edit that trims
 * the code block back to prose fails rather than quietly undoing the measurement.
 */
const SKILL_RULES = [
  ["abort the previous streamText", "const ctrl = (running.current = new AbortController())"],
  ["abort the previous bash when polling", "ctrl.abort(); clearInterval(timer)"],
  ["honour prefers-reduced-motion", "prefers-reduced-motion: reduce"],
  ["keyboard-reachable controls", "<button aria-label=\"复制\" onClick={copy}>"],
] as const;

for (const [name, phrase] of SKILL_RULES) {
  test(`the skill still shows the code for ${name}`, () => {
    expect(skillBody("types.json", "standalone.json")).toContain(phrase);
  });
}

const SECTIONS = [
  "Is this a UI at all",
  "Inline or canvas",
  "Ask with an interface when the request is underspecified",
  "Say something before it and something after",
  "Framing",
  "Layout",
  "Sound",
  "Declare every hook before the JSX",
  "Anything that keeps running",
  "Running a command",
  "Reading and writing workspace files",
  "Generating content inside the card",
  "Check it before you hand it over",
  "Imports",
];

test("the skill body carries every section, in order", () => {
  const body = skillBody("types.json", "standalone.json");
  expect(body.split("\n").filter((line) => line.startsWith("## ")).map((line) => line.slice(3))).toEqual(SECTIONS);
});

// The two maps have genuinely different lifetimes, and the body is built for all four
// combinations — an interpolation that throws on `undefined` would only show up in the state
// nobody runs locally.
test("the body assembles whether or not the maps exist", () => {
  for (const maps of [[undefined, undefined], ["t.json", undefined], [undefined, "s.json"], ["t.json", "s.json"]] as const) {
    const body = skillBody(maps[0], maps[1]);
    expect(body.startsWith("# Building a generative UI")).toBe(true);
    // Not a bare `undefined` search: the prose says "it is an `undefined` component" on purpose.
    // What must not appear is an interpolation that leaked one — a path, or a flag's argument.
    expect(body).not.toMatch(/undefined\.json|-i undefined|\/undefined/);
  }
});
