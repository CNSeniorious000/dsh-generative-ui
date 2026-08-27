import { expect, test } from "bun:test";
import { inlinePrompt } from "../src/prompt.ts";
import { skillBody } from "../src/skill.ts";
import { Config, serveExec } from "../src/index.ts";

// Two different defaults live here and conflating them hid a bug for weeks.
//
// The PRODUCT default is `Config`'s: what a host that configures nothing gets. It is ON — cards
// search with `rg`, run `lint`, read `git`, and a model reasoning from a five-capability set
// writes none of that.
//
// The FUNCTION default is `inlinePrompt()` / `skillBody(a, b)`'s omitted argument, and it stays
// OFF on purpose, because the two directions are not equally bad: docs that under-describe a
// registered route cost the model a capability it could have used, while docs that describe an
// UNregistered one produce cards whose import fails — and a failed import takes the whole module
// down, so the reader gets a blank card naming nothing.
//
// Nothing used to pin the product default: these assertions all called the functions with no
// argument, so flipping `Config` changed nothing here. That is exactly how `skillBody` came to be
// called without its third argument at the one real call site — the prompt said six capabilities
// while the skill described five, and every test stayed green.

test("the product default — a host that configures nothing — is ON", () => {
  expect(Config({}).allowExec).toBe(true);
});

test("an explicit off is still honoured", () => {
  expect(Config({ allowExec: false }).allowExec).toBe(false);
});

test("an omitted argument documents the SMALLER set, which is the safe direction", () => {
  expect(inlinePrompt()).not.toContain("$dsh/exec");
  expect(skillBody(undefined, undefined)).not.toContain("$dsh/exec");
});

// The call site that reads the setting has to pass it on. Both halves, both directions.
test("with commands on, both halves document them", () => {
  expect(inlinePrompt(true)).toContain("$dsh/exec");
  expect(skillBody(undefined, undefined, true)).toContain("$dsh/exec");
});

// Not just the import line. A prompt that drops the bullet but keeps "run `git log` in a card"
// still teaches the model to reach for a capability whose import will fail — and a failed import
// takes the whole module down, so the reader gets a blank card naming nothing.
test("with commands off, nothing in either half suggests running one", () => {
  for (const text of [inlinePrompt(false), skillBody(undefined, undefined, false)]) {
    expect(text).not.toContain("$dsh/exec");
    expect(text).not.toContain("bash(");
    expect(text).not.toContain("## Running a command");
  }
});

// The closed-set sentence is what stops the model reasoning its way to a plausible sixth import,
// so it has to name the set that exists — claiming five while documenting four is worse than not
// claiming a number at all.
test("the closed-set sentence counts the capabilities that exist", () => {
  expect(inlinePrompt(false)).toContain("These five are the whole set");
  expect(inlinePrompt(true)).toContain("These six are the whole set");
  expect(inlinePrompt(false)).not.toContain("`exec`");
});

// The number and the list have to agree, and they did not: the list used to be built by
// SUBTRACTING from a string — `EVERY_CAPABILITY.replace(", \`exec\`", "")` — with a different
// escaping than the string it searched. It matched nothing, which `replace` reports by returning
// the input unchanged, so the sentence said "five" and then named six, `exec` among them, on a
// host where that import does not resolve. Count what the sentence actually lists rather than
// trusting either half, and the two cannot drift again.
test("the closed-set sentence lists exactly as many capabilities as it claims", () => {
  const WORDS: Record<string, number> = { four: 4, five: 5, six: 6, seven: 7 };
  for (const allowExec of [false, true]) {
    const sentence = /These (\w+) are the whole set — ([^—]+) —/.exec(inlinePrompt(allowExec));
    expect(sentence).not.toBeNull();
    const claimed = WORDS[sentence![1]];
    const listed = [...sentence![2].matchAll(/`(\w+)`/g)].map((m) => m[1]);
    expect(listed.length).toBe(claimed);
    expect(listed.includes("exec")).toBe(allowExec);
  }
});

test("turning it on restores both halves", () => {
  expect(inlinePrompt(true)).toContain("$dsh/exec");
  expect(skillBody(undefined, undefined, true)).toContain("## Running a command");
});

// The templating must not leak. A stray `__EXEC_BULLET__` in the prompt is text the model reads.
test("no placeholder survives into either build", () => {
  for (const on of [false, true]) {
    expect(inlinePrompt(on)).not.toMatch(/__[A-Z_]+__/);
    expect(skillBody(undefined, undefined, on)).not.toMatch(/__[A-Z_]+__/);
  }
});

// The switch is enforced by NOT REGISTERING the route, so this is the one thing left to pin: the
// handler itself has no flag to check. That is deliberate — an unregistered path 404s exactly as
// it does on a host with no shell service, a path that already exists and is already handled, so
// a flag inside the handler would have invented a second way to fail.
test("the handler carries no switch of its own — the route is the switch", () => {
  expect(serveExec.toString()).not.toContain("allowExec");
  const source = require("node:fs").readFileSync("src/index.ts", "utf8") as string;
  expect(source).toContain("if (allowExec) scoped.inject([\"shell\", \"sandboxPolicy\"]");
});

// The switch must not become a way to lose the plugin. `installSettingsSection` lives entirely
// inside `ctx.inject(["settings"])`, so a host without that service never fires `onChange` — and
// `dsh --profile headless` is such a host. Everything is therefore mounted from an explicit call
// as well, guarded so a host that DOES have settings mounts once, not twice.
test("a host with no settings service still mounts the prompt and the skill", () => {
  const sections: unknown[] = [];
  const contexts: unknown[] = [];
  const skills: unknown[] = [];
  const stub = {
    // A headless host: no settings service, no web server, no skills subsystem beyond the one
    // stubbed below. `inject` runs its callback only for services this table actually has, which
    // is what cordis does and what makes `inject(["settings"], …)` a dead branch here.
    inject: (names: string[], run: (c: unknown) => void) => { if (names.every((n) => n in stub)) run(stub); },
    effect: (run: () => unknown) => void run(),
    plugin: (spec: { apply: (c: unknown) => void }) => { spec.apply(stub); return { dispose: async () => {} }; },
    systemPrompt: { section: (s: unknown) => void sections.push(s), context: (c: unknown) => void contexts.push(c) },
    skills: { register: (s: unknown) => void skills.push(s) },
  };
  const { apply } = require("../src/index.ts") as { apply: (c: unknown, config: unknown) => void };
  apply(stub, { allowExec: false });
  expect(sections.length).toBe(1);
  expect(skills.length).toBe(1);
});
