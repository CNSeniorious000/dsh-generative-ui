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
  // Shown as code, not described. The adherence count found rules stated in prose landing at
  // 0-7% while the same rule as two lines landed — so the code block IS the rule here, and a
  // future edit trimming it back to the sentence undoes the measurement rather than tidying.
  // `{ {` not `{{`: the dsh prompt loader reads `{{…}}` as a variable reference and rejects
  // the section. Same JSX, same rendering, no collision — see the loader test at the bottom.
  ["a duplicate style key, as code", 'style={ { padding: 4, gap: 6, padding: "8px 12px" } }'],
  ["destructuring useRef, as code", "// both undefined; dies on first use"],
  ["a component out of an object, as code", "const Icon = Icons[kind]; return <Icon />"],
] as const;

for (const [name, phrase] of RULES) {
  test(`the prompt still carries the rule about ${name}`, () => {
    // Occurrences, not presence. A phrase appearing twice cannot detect one of them going —
    // the `streamText` assertion below was pinned on a line that appears in both halves of its
    // code block, so deleting either half left the test green.
    expect(INLINE_PROMPT.split(phrase).length - 1).toBe(1);
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
  ["honour prefers-reduced-motion (media query)", "@media (prefers-reduced-motion: reduce)"],
  ["honour prefers-reduced-motion (inline)", 'matchMedia("(prefers-reduced-motion: reduce)")'],
  ["keyboard-reachable controls", "<button aria-label=\"复制\" onClick={copy}>"],
  ["a superseded async run returns", "if (id !== runId.current) return"],
  ["the shared cause behind the control rules", "treating its controls as decoration"],
] as const;

for (const [name, phrase] of SKILL_RULES) {
  test(`the skill still shows the code for ${name}`, () => {
    expect(skillBody("types.json", "standalone.json").split(phrase).length - 1).toBe(1);
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

/**
 * Every screen names a defect the model actually produced. A screen with no corresponding rule
 * is a defect we detect and never asked the model to stop making — the checker and the prompt
 * drifting apart. Pinned as a map so adding a screen forces answering "and what does the prompt
 * say about it?", the same way `screens-quiet-on-fix.test.ts` forces answering "and what does a
 * card doing this right look like?".
 */
const RULE_FOR_SCREEN: Record<string, string | string[]> = {
  "BRAND-PRIMARY-FILL": "as a background",
  "COMMA-IN-STYLE": "Merge styles with a spread, never a comma",
  "DESTRUCTURED-HOOK": "Only `useState` returns a pair",
  "DUPLICATE-STYLE-KEY": "written twice keeps only the last one",
  "GLOB-IN-JSX": "brace in JSX text is an expression",
  "HARDCODED-BACKGROUND": "Never write literal colors",
  "JSX-SUBSCRIPT": "Subscript it into a capitalised local first",
  "MISSING-REACT-IMPORT": "Import every name you write",
  "MODULE-SCOPE-HOOK": ["Declare every hook", "a hook called outside a component"],
  "NO-FOCUS-RING": "focus-visible",
  "SHADOWED-EXPORT": "Never name it after something you imported",
  "UNGUARDED-LAST-INDEX": "not a guard against empty",
  "UNREACHABLE-CONTROL": "breaks keyboard use",
  "UNGUARDED-ASYNC-HANDLER": "a newer click owns the state now",
  "UNGUARDED-NUMBER-INPUT": "cannot be cleared",
  "AND-INTO-ARROW": "does not chain into an arrow function",
  "TRANSITION-WITHOUT-TRANSFORM": "transition that names `transform`",
  "UNANNOUNCED-ASYNC-RESULT": ["announce it where it lands", "say so where it lands"],
  "UNQUOTED-CSS-UNIT": "A `style` object is JavaScript, not CSS",
  "REGEX-IN-JSX-TEXT": "A brace in JSX text is an expression",
  "UNLABELLED-CONTROL": "A slider is the same problem",
  "UNSTOPPABLE-MOTION": "@media (prefers-reduced-motion: reduce)",
  "VIEWPORT-UNITS": "100vw",
};

/**
 * The other direction, and the one that was missing. Running it by hand found `&&`-into-an-arrow
 * (a real defect with a rule and no detector, sitting in the corpus) and, more usefully, found
 * that "The React import line comes first" describes a mechanism that does not exist — ES
 * imports are hoisted, and the screen written for it found 0 of 378 because there is nothing to
 * find. A rule nobody can check is a rule nobody can discover is wrong.
 *
 * Bullets that shape WHEN to write a card rather than what not to write in one are listed here
 * as unscreenable; the point is that dropping one in requires saying so.
 */
const UNSCREENABLE = [
  "Four backticks", "The info string is", "Write the React import before you write the data",

  "A question does not have to say", "A conversion is never asked once", "A plan is not prose",
  "When they tell you they want to change something", "When they hand you an expression",
  "看看都有啥", "Asking for a few of something", "Visualise this",
];

test("every code rule in the prompt has a screen enforcing it", () => {
  // The whole bullet, not just its bold header — a screen's pinned phrase is often in the body
  // (`JSX-SUBSCRIPT` pins "Subscript it into a capitalised local first", which is the sentence
  // AFTER the header). Bullets run until the next one starts.
  const bullets = INLINE_PROMPT.split(/^- \*\*/m).slice(1).map((b) => "- **" + b);
  const covered = [...Object.values(RULE_FOR_SCREEN).flat(), ...UNSCREENABLE];
  const unmatched = bullets.filter((b) => !covered.some((phrase) => b.includes(phrase)));
  expect(unmatched).toEqual([]);
});

test("every screen has a rule telling the model not to do it", async () => {
  const { SCREENS } = await import("../scripts/screens.ts");
  expect(Object.keys(RULE_FOR_SCREEN).toSorted()).toEqual(Object.keys(SCREENS).toSorted());
  const both = INLINE_PROMPT + skillBody("types.json", "standalone.json");
  const missing = Object.entries(RULE_FOR_SCREEN).filter(([, p]) => ![p].flat().every((phrase) => both.includes(phrase)));
  expect(missing).toEqual([]);
});

/**
 * dsh loads these through a template that reads `{{…}}` as a variable reference and REJECTS the
 * whole section when the contents are not a name — the plugin does not degrade, it fails to load:
 *
 *     dsh: UNKNOWN: malformed prompt variable reference "{{}}" in section "dsh-generative-ui:inline"
 *
 * React's own `style={{ … }}` is exactly that token, so a rule written to SHOW a style object
 * takes the whole section down. Nothing here caught it: every other test reads the exported
 * string, while `dsh` is the only thing that PARSES it. Found by running `scripts/eval.sh`.
 *
 * `{{` is fatal ANYWHERE in the text — inline code spans included, indented code blocks
 * included. Verified against `dsh` itself by putting one back in each position and watching
 * `scripts/loads.sh` fail; the loader is a plain string scan and markdown means nothing to it.
 *
 * Write `style={ { … } }` in prompt text: same JSX, same meaning to a reader, no `{{`.
 */
for (const [name, text] of [["the inline prompt", () => INLINE_PROMPT], ["the skill body", () => skillBody("types.json", "standalone.json")]] as const) {
  test(`${name} carries no {{ for the loader to read as a variable`, () => {
    expect([...text().matchAll(/\{\{[^}]*\}\}?/g)].map((m) => m[0])).toEqual([]);
  });
}
