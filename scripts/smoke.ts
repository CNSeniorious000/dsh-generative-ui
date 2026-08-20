/**
 * Loads the built client bundle the way the shell's module loader does, without a browser.
 *
 * Catches the failure modes that otherwise only show up as a blank app with
 * "loaded without registering" in the UI: a syntax error anywhere in the bundle
 * (top-level `import.meta` is the classic one), a banner/footer wrapper that does
 * not call `load()`, and any bare `require()` the shell's module table cannot answer.
 */
const PLATFORM = new Set(["react", "react/jsx-runtime", "react-dom", "react-dom/client", "@deepseek-ai/cordis", "@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-web-react", "@deepseek-ai/dsh-client-ui-primitives", "@deepseek-ai/dsh-client-ui-attachment", "@deepseek-ai/dsh-client-schema-form"]);

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
console.log(`smoke: ok — id ${id}, requires [${asked.join(", ")}], exports [${Object.keys(exports).join(", ")}]`);
