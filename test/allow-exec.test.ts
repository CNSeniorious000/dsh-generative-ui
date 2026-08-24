import { expect, test } from "bun:test";
import { inlinePrompt } from "../src/prompt.ts";
import { skillBody } from "../src/skill.ts";
import { serveExec } from "../src/index.ts";

// `$dsh/exec` takes an arbitrary command string from code a MODEL wrote, running in the user's
// browser and firing on their keystrokes. `$dsh/fs` is bounded by comparison — a workspace path
// under the session's sandbox policy. So commands are opt-in, and every assertion here is about
// the default: a host that says nothing must not get them.

test("the default is off", () => {
  expect(inlinePrompt()).not.toContain("$dsh/exec");
  expect(skillBody(undefined, undefined)).not.toContain("$dsh/exec");
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
  const skills: unknown[] = [];
  const stub = {
    // A headless host: no settings service, no web server, no skills subsystem beyond the one
    // stubbed below. `inject` runs its callback only for services this table actually has, which
    // is what cordis does and what makes `inject(["settings"], …)` a dead branch here.
    inject: (names: string[], run: (c: unknown) => void) => { if (names.every((n) => n in stub)) run(stub); },
    effect: (run: () => unknown) => void run(),
    plugin: (spec: { apply: (c: unknown) => void }) => { spec.apply(stub); return { dispose: async () => {} }; },
    systemPrompt: { section: (s: unknown) => void sections.push(s) },
    skills: { register: (s: unknown) => void skills.push(s) },
  };
  const { apply } = require("../src/index.ts") as { apply: (c: unknown, config: unknown) => void };
  apply(stub, { allowExec: false });
  expect(sections.length).toBe(1);
  expect(skills.length).toBe(1);
});
