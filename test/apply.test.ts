/**
 * The node half's registration, which nothing has ever run.
 *
 * `smoke.ts` loads the built CLIENT bundle and runs its `apply()`; the server half's is only
 * exercised in a real profile. Its structure is the whole of the plugin's degradation story —
 * every capability is a NESTED inject, deliberately, so a profile without `shell` loses
 * `$dsh/exec` and keeps everything else. A static `inject` naming all of them would take the
 * prompt and the skill down with it, which is the entire plugin.
 *
 * The context is a fake that records what was asked for and runs every callback, so this is
 * about which routes appear under which dependency, not about serving a request.
 */
import { expect, test } from "bun:test";
import { apply } from "../src/index.ts";

type Registration = { deps: readonly string[]; effects: string[] };

const applyWith = (available: readonly string[]) => {
  const registrations: Registration[] = [];
  const effects: string[] = [];
  const stub = (): unknown => new Proxy(() => stub(), { get: () => stub(), apply: () => stub() });
  const make = (deps: readonly string[]): Record<string, unknown> => {
    const context: Record<string, unknown> = {
      effect: (run: () => unknown, label?: string) => {
        effects.push(label ?? "(unlabelled)");
        registrations.at(-1)?.effects.push(label ?? "(unlabelled)");
        try { run() } catch { /* the fake context cannot serve a request; registration is the subject */ }
      },
      inject: (want: readonly string[], callback: (scoped: unknown) => void) => {
        // A dependency the profile does not have: cordis never runs the callback.
        if (!want.every((name) => available.includes(name))) return;
        registrations.push({ deps: want, effects: [] });
        callback(new Proxy(make([...deps, ...want]), { get: (target, key) => (key in target ? target[key as string] : stub()) }));
      },
    };
    return context;
  };
  const root = new Proxy(make([]), { get: (target, key) => (key in target ? target[key as string] : stub()) });
  apply(root as never);
  return { registrations, effects };
};

const ALL = ["webServer", "sessions", "fs", "sandboxPolicy", "shell", "llm", "agentDefaultModel", "skills"];

test("a full profile registers every route", () => {
  const { effects } = applyWith(ALL);
  for (const label of ["dsh-generative-ui: workspace files", "dsh-generative-ui: commands", "dsh-generative-ui: model stream", "dsh-generative-ui: skill"]) {
    expect(effects).toContain(label);
  }
});

/**
 * The point of the nesting: one missing capability costs one capability.
 *
 * A profile with no `shell` is a real deployment, not a hypothetical — it is what a read-only
 * or restricted profile looks like.
 */
test("a profile without `shell` loses only the command route", () => {
  const { effects } = applyWith(ALL.filter((name) => name !== "shell"));
  expect(effects).not.toContain("dsh-generative-ui: commands");
  expect(effects).toContain("dsh-generative-ui: workspace files");
  expect(effects).toContain("dsh-generative-ui: model stream");
  expect(effects).toContain("dsh-generative-ui: skill");
});

// The skill and the prompt sit outside the webServer inject on purpose: a profile with no web
// server at all still tells the model how to write a card.
test("a profile with no web server still registers the prompt and the skill", () => {
  const { effects } = applyWith(["skills"]);
  expect(effects).toContain("dsh-generative-ui: skill");
  expect(effects).not.toContain("dsh-generative-ui: workspace files");
});
