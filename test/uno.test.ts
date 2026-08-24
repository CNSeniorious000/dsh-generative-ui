import { expect, test } from "bun:test";
import { createGenerator } from "@unocss/core";
import { unoConfig } from "../src/client/runtime/uno-config.ts";

const generate = async (tokens: string[], scope = ".ui4a-root") => {
  const uno = await createGenerator(unoConfig(scope));
  const extracted = await uno.applyExtractors(tokens.join(" "));
  const { css, matched } = await uno.generate(extracted, { preflights: true });
  return { css, matched };
};

// Every rule must be prefixed. The runtime sheet is appended to `<head>` after the shell's own,
// so an unscoped `hidden` from a card would win over the shell's and make part of the app vanish
// — the exact bug the playground has on record.
test("every generated rule is scoped to the genui root", async () => {
  const { css } = await generate(["grid", "gap-4", "hidden", "flex", "text-left"]);
  const rules = [...css.matchAll(/^\s*(\.[^{@\s][^{]*)\{/gm)].map((m) => m[1].trim());
  expect(rules.length).toBeGreaterThan(3);
  expect(rules.filter((r) => !r.startsWith(".ui4a-root "))).toEqual([]);
});

// presetWind4's reset is 3.5KB of `*, ::before, ::after { margin: 0; border: 0 solid }`, and it
// would land on the HOST's DOM. `preflights: { reset: false }` drops it while keeping the theme
// layer, which is where `--spacing` lives and every `gap-*` resolves against.
test("the preflight carries theme variables but no global reset", async () => {
  const { css } = await generate(["gap-4", "rounded-sm"]);
  expect(css).toContain("--spacing:");
  expect(css).not.toMatch(/\*,\s*::after[^{]*\{[^}]*margin/);
});

// The two failures measured on real cards, both of which this syntax makes unspellable: a state
// selector living in `<style>` while the attribute is written in JSX, and a pseudo-element
// override addressed through a class that landed on the wrong element.
test("state variants and pseudo-elements resolve in one token", async () => {
  const { css, matched } = await generate(["aria-checked:bg-accent", "[&::-webkit-slider-thumb]:bg-label"]);
  expect(matched.size).toBe(2);
  expect(css).toContain('[aria-checked="true"]');
  expect(css).toContain("::-webkit-slider-thumb");
});

// A card sizes itself against the panel, never the viewport, so the breakpoint spelling that has
// to work is the container one.
test("container queries generate as @container, not @media", async () => {
  const { css } = await generate(["@[30rem]:grid-cols-3"]);
  expect(css).toContain("@container (min-width: 30rem)");
  expect(css).not.toContain("@media (min-width: 30rem)");
});

// The colour names are the only thing a card can say, so a typo in the config is a card that
// silently paints nothing. Note what is deliberately ABSENT: `brand-primary` has no short name,
// because it is a foreground colour that 50 of 378 real cards used as a fill.
test("every colour name maps to a host token, and brand is not among them", async () => {
  const names = ["base", "layer", "layer-2", "line", "line-2", "label", "muted", "accent", "hover", "danger", "success", "warn"];
  const { css, matched } = await generate(names.map((n) => `bg-${n}`));
  expect(matched.size).toBe(names.length);
  // Not just that the class generated — that the variable it points at is one the host defines.
  // A typo generates perfectly valid CSS referencing a variable that does not exist, and the card
  // paints with no colour at all rather than failing.
  const HOST_TOKENS = new Set(["bg-base", "bg-layer-1", "bg-layer-2", "border-l1", "border-l2", "label-primary", "label-secondary", "state-business-primary", "interactive-bg-hover", "state-error-primary", "state-success-primary", "state-warn-primary"]);
  const referenced = [...css.matchAll(/var\(--dsw-alias-([\w-]+)\)/g)].map((m) => m[1]);
  expect(referenced.length).toBe(names.length);
  expect(referenced.filter((t) => !HOST_TOKENS.has(t))).toEqual([]);
  expect(css).not.toContain("brand-primary");
});

// Dropping presetWind4's reset leaves form controls with the UA's own chrome, whose colours are
// fixed rather than theme-aware: measured in a real browser, two unselected `<button>`s came out
// light grey with black text on a dark card. The replacement must normalise them and must stay
// inside the scope, because the host has buttons of its own.
test("form controls are normalised, and only inside the scope", async () => {
  const { css } = await generate(["grid"]);
  expect(css).toContain(".ui4a-root button");
  const control = css.slice(css.indexOf(".ui4a-root button"));
  expect(control).toContain("background: transparent");
  expect(control).toContain("font: inherit");
  // Nothing may address a bare element globally — `button {` with no scope in front of it would
  // restyle every button in the shell.
  expect(css).not.toMatch(/(^|[};]\s*)(button|input|select|textarea)\s*[,{]/m);
});

// UnoCSS merges selectors that share a declaration, and Chromium drops any rule whose selector
// list contains a pseudo-element it does not know — so one `::-moz-range-thumb` takes the
// `::-webkit-slider-thumb` half down with it. Measured on a real card: 75 of 87 rules survived
// parsing and the slider computed to `height: 0px`. Order is irrelevant; either vendor first
// poisons the list.
test("a merged vendor rule is split so Chromium keeps the half it understands", async () => {
  const { css } = await generate(["[&::-moz-range-thumb]:h-3.5", "[&::-webkit-slider-thumb]:h-3.5"]);
  const merged = /::-moz-range-thumb[^{]*,[^{]*::-webkit-slider-thumb\s*\{/.test(css);
  expect(merged).toBe(true); // this is what UnoCSS produces, and what the runtime must fix
  const { splitVendorRules } = await import("../src/client/runtime/uno.ts");
  const fixed = splitVendorRules(css);
  expect(/::-moz-[^{]*,[^{]*::-webkit-/.test(fixed)).toBe(false);
  // Both halves survive, each in its own rule.
  expect(fixed).toContain("::-webkit-slider-thumb{");
  expect(fixed).toContain("::-moz-range-thumb{");
});
