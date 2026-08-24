import { expect, test } from "bun:test";
import { capabilityModule } from "../src/contract.ts";
import { bind } from "../src/client/runtime/bindings.ts";
import { inlinePrompt } from "../src/prompt.ts";
import { skillBody } from "../src/skill.ts";

/**
 * The prompt used to say there was no persistence hook, and the model supplied one anyway —
 * `import { usePersistedState } from "$dsh/state"`, in 5 of 6 runs, surviving a reworded denial.
 * An unresolvable bare specifier fails the whole module import and leaves a blank card with
 * nothing in the console naming the cause, so the text telling the model what exists has to stay
 * in step with what actually exists.
 *
 * Enumerated from `bind()` rather than from a list beside it: a group added to the implementation
 * and missed here would be a capability nobody is told about, which is one nobody uses.
 */
const GROUPS = Object.keys(bind());

/**
 * `exec` is the one capability a host can withhold (`allowExec`, off by default), so the set the
 * text must name depends on the switch. Both directions matter and they fail differently: naming
 * one that is off teaches the model an import that will fail — and a failed import takes the whole
 * module down, so the reader gets a blank card naming nothing. Omitting one that is on wastes it.
 */
const groupsFor = (allowExec: boolean) => (allowExec ? GROUPS : GROUPS.filter((g) => g !== "exec"));

test("bind() exposes something to enumerate", () => {
  expect(GROUPS.length).toBeGreaterThan(0);
});

test("the prompt names every capability the host exposes", () => {
  for (const allowExec of [false, true]) {
    const text = inlinePrompt(allowExec);
    for (const group of groupsFor(allowExec)) expect(text).toContain(capabilityModule(group));
  }
});

test("the skill names every capability the host exposes", () => {
  for (const allowExec of [false, true]) {
    const body = skillBody(undefined, undefined, allowExec);
    for (const group of groupsFor(allowExec)) expect(body).toContain(capabilityModule(group));
  }
});

/**
 * The other direction, and the one that fails silently. `INVENTED-CAPABILITY` screens a card for
 * importing a `$dsh/…` that resolves to nothing — the prompt must not be the thing that taught it
 * the name. Every specifier either prompt mentions has to be one `bind()` actually returns.
 */
test("and no capability that does not exist — or that this host withheld", () => {
  for (const allowExec of [false, true]) checkNamedCapabilities(allowExec);
});

function checkNamedCapabilities(allowExec: boolean) {
  const real = new Set(groupsFor(allowExec).map(capabilityModule));
  const both = inlinePrompt(allowExec) + skillBody(undefined, undefined, allowExec);
  // `$dsh/internal` is the private module the blob shims import; it is deliberately not a
  // capability and must not appear in anything the model reads.
  const named = new Set([...both.matchAll(/\$dsh\/[\w-]+/g)].map((m) => m[0]));
  expect([...named].filter((s) => !real.has(s))).toEqual([]);
}

// The module the model asked for before it existed. It is the answer to the persistence rule, so
// the rule has to name it by its import line — a capability described in prose but never spelled
// as an import is one the model has to guess the shape of.
test("the persistence rule shows the $dsh/state import", () => {
  expect(skillBody(undefined, undefined)).toContain(`import { usePersistedState } from "${capabilityModule("state")}"`);
});
