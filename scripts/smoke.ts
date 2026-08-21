/**
 * Loads the built client bundle the way the shell's module loader does, without a browser.
 *
 * Catches the failure modes that otherwise only show up as a blank app with
 * "loaded without registering" in the UI: a syntax error anywhere in the bundle
 * (top-level `import.meta` is the classic one), a banner/footer wrapper that does
 * not call `load()`, and any bare `require()` the shell's module table cannot answer.
 */
const PLATFORM = new Set(["react", "react/jsx-runtime", "react-dom", "react-dom/client", "@deepseek-ai/cordis", "@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-ui-primitives"]);

const source = await Bun.file("lib/client.js").text();
let registered: { id: string; factory: (require: (id: string) => unknown) => Record<string, unknown> } | null = null;

// Minimal stand-ins for what the bundle touches while its module bodies evaluate.
Object.assign(globalThis, {
  window: {
    __ModuleLoader__: {
      load: (m: typeof registered) => {
        registered = m;
      },
    },
  },
  document: { querySelector: () => null, createElement: () => ({ style: {}, setAttribute() {} }), head: { prepend() {}, append() {} } },
});

// The whole point is to evaluate the bundle exactly as the shell's loader does, including
// the banner that calls `__ModuleLoader__.load` — a syntax error here is the failure this
// script exists to catch.
// oxlint-disable-next-line no-eval
(0, eval)(source);

if (registered === null) throw new Error("bundle did not call window.__ModuleLoader__.load — check the banner/footer wrapper");
const { id, factory } = registered as NonNullable<typeof registered>;
if (id !== "dsh-generative-ui") throw new Error(`registered under the wrong id: ${id}`);

const asked: string[] = [];
const exports = factory((specifier) => {
  asked.push(specifier);
  if (!PLATFORM.has(specifier)) throw new Error(`require(${JSON.stringify(specifier)}) is not in the shell's module table`);
  return specifier === "react" || specifier === "react/jsx-runtime" ? require(specifier) : {};
});

if (typeof exports.apply !== "function") throw new Error("client bundle exports no apply()");

/**
 * Run `apply()` too, and report which effects it registered.
 *
 * Evaluating the module bodies only proves the bundle parses. Every effect this plugin has
 * is registered from `apply`, so a throw at the top of it — or an effect that never returns
 * — is invisible until the shell sits on "Loading plugins…" forever. That has happened: a
 * lint-driven edit hung the main thread and this script still printed ok.
 *
 * Browser APIs the effects reach for are deliberately NOT simulated. What is asserted is
 * that `apply` returns, and that each effect either registered or failed on a missing DOM
 * global rather than on the plugin's own logic — anything else is a real defect. Faithfully
 * emulating the DOM here would make this a worse browser than the browser test already run.
 */
const DOM_ABSENCE = /is not (defined|a function)|Cannot read propert|WebAssembly|fetch\(\) URL|doesn't parse/;
const registered_effects: string[] = [];
const dom_gaps: string[] = [];
const effect = (run: () => unknown, label?: string) => {
  const name = label ?? "(unlabelled)";
  registered_effects.push(name);
  try {
    run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!DOM_ABSENCE.test(message)) throw new Error(`effect ${name} failed: ${message}`, { cause: error });
    dom_gaps.push(name);
  }
};
const injected: string[] = [];
const context: Record<string, unknown> = {
  effect,
  inject: (deps: readonly string[], callback: (scoped: unknown) => void) => {
    injected.push(...deps);
    callback(context);
  },
};
// Anything else `apply` touches answers with a callable that keeps answering.
const stub = (): unknown => new Proxy(() => stub(), { get: () => stub(), apply: () => stub() });
const proxied = new Proxy(context, { get: (target, key) => (key in target ? target[key as string] : stub()) });

// Measured after the fact, not with a timer: a synchronously blocking `apply` never yields
// to the event loop, so a `setTimeout` guard would fire only once it had already returned.
const started = performance.now();
exports.apply(proxied);
const elapsed = performance.now() - started;
// Registering effects is bookkeeping; anything close to a second means work that belongs
// off the registration path, which is what left the shell on "Loading plugins…" before.
if (elapsed > 1000) throw new Error(`apply() blocked for ${Math.round(elapsed)}ms — registration must not do work`);

if (registered_effects.length === 0) throw new Error("apply() registered no effects");
const gaps = dom_gaps.length === 0 ? "" : `, ${dom_gaps.length} needing a DOM`;
console.log(`smoke: ok — id ${id}, requires [${[...new Set(asked)].join(", ")}]`);
console.log(`       apply() registered ${registered_effects.length} effects${gaps} under injections [${[...new Set(injected)].join(", ")}]`);
