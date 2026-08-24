/**
 * Serves the real `GenUISurface` against a local React, so a card can be mounted the way the
 * plugin mounts it — including partial-react's error boundary, which is what decides whether a
 * throwing card shows a message or nothing at all.
 *
 * Local, not esm.sh: the verification browser cannot always reach it, and a card under test
 * should not fail for a reason that has nothing to do with the card. The tsx wasm comes from
 * `node_modules` on the plugin's own asset route, exactly as `compiler.ts` fetches it.
 *
 * Usage: `bun scripts/surface-harness.ts [port] [card.tsx]`. With a card path it also serves the
 * source at `/card` and the icon names it imports at `/icons`; the driver registers a stand-in for
 * lucide with `registerModules`, which `/surface.js` re-exports for exactly that purpose:
 *
 *   const { GenUISurface, registerModules } = await import("/surface.js")
 *   const icon = () => React.createElement("span")
 *   registerModules({ "lucide-react": Object.fromEntries((await (await fetch("/icons")).json()).map(n => [n, icon])) })
 *
 * Then in ego-browser import `/surface.js` and
 * render `GenUISurface` with `{ code, streaming, onError }`. React comes from the UMD globals
 * (`globalThis.React` / `globalThis.ReactDOM`), not from a bare import.
 *
 * Cards importing `$dsh/*` mount here. They did not until `$dsh/internal` stopped being
 * registered inside `registerUi4aHost` — a page with no host got capability blobs importing an
 * empty module, and the card rendered silently blank. `$dsh/state` works fully (no host behind
 * it); the host-backed ones lay out correctly and only throw `no host bound` at the moment they
 * are actually called, which is what a preview should do.
 */
import { readFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { WASM_PATH } from "../src/contract-assets.ts";

const port = Number(process.argv[2] ?? 47895);
/** Optional card file, served at `/card` and scanned for the icons its lucide shim must declare. */
const cardPath = process.argv[3];

// Re-export every name the UMD build defines rather than hand-listing them: the consumer is
// partial-react, not our own code, and a hand-list cost three rounds of "does not provide an
// export named X" — createContext, useLayoutEffect, Component, one at a time.
const reactKeys = [...readFileSync("node_modules/react/umd/react.development.js", "utf8").matchAll(/exports\.(\w+)\s*=/g)]
  .map(m => m[1])
  .filter(name => /^[A-Za-z_$][\w$]*$/.test(name) && name !== "default");

// The bundle resolves react through aliases onto the UMD globals rather than leaving them
// external: with no document import map (see below) a bare `import "react"` inside the bundle
// has nothing to resolve against.
await Bun.write("/tmp/dsh-harness-react.js", ["const R = globalThis.React;", "export default R;", ...reactKeys.map(k => `export const ${k} = R[${JSON.stringify(k)}];`)].join("\n"));
await Bun.write("/tmp/dsh-harness-jsx.js", "const R = globalThis.React;\nexport const Fragment = R.Fragment;\nexport const jsx = (t, p, k) => R.createElement(t, k === undefined ? p : { ...p, key: k });\nexport const jsxs = jsx;\nexport const jsxDEV = jsx;");
await Bun.write("/tmp/dsh-harness-dom.js", "const D = globalThis.ReactDOM;\nexport default D;\nexport const { flushSync, createPortal } = D;\nexport const createRoot = D.createRoot;\nexport const renderToString = () => '';");

// One entry exporting both, so a driver can stand in for a package the browser cannot fetch.
// It lives outside the repo — a temp file in the working tree survives a failed build and shows
// up as an untracked file in whatever the next command looks at.
// Port-scoped: two harnesses run side by side to shoot a card in both themes, and a fixed
// name makes the second one unlink the first one's entry mid-build.
const entry = `${tmpdir()}/dsh-surface-entry-${port}.ts`;
const from = (path: string) => JSON.stringify(resolve(import.meta.dir, "..", path));
await Bun.write(entry, [`export { GenUISurface } from ${from("src/client/runtime/GenUISurface.tsx")};`, `export { registerModules } from ${from("src/client/runtime/registry.ts")};`, ""].join("\n"));

const bundle = await (await Bun.build({
  entrypoints: [entry],
  target: "browser",
  plugins: [{
    name: "react-from-umd",
    setup(build) {
      build.onResolve({ filter: /^react(\/jsx-(dev-)?runtime)?$|^react-dom(\/(client|server))?$/ }, args => ({
        path: args.path.startsWith("react-dom") ? "/tmp/dsh-harness-dom.js" : args.path.includes("jsx") ? "/tmp/dsh-harness-jsx.js" : "/tmp/dsh-harness-react.js",
      }));
    },
  }],
})).outputs[0].text();
await unlink(entry);

/**
 * Named exports for exactly the icons the given card imports, each an empty span.
 *
 * Real icons mean esm.sh, which the verification browser cannot always reach, and a card must not
 * fail a mount test for a reason that has nothing to do with the card. A Proxy default export does
 * not work: `import { Droplets }` is a static binding the module has to declare.
 */
const lucideNames = cardPath === undefined
  ? []
  : [...(readFileSync(cardPath, "utf8").match(/import\s*\{([^}]*)\}\s*from\s*["']lucide-react["']/)?.[1] ?? "").matchAll(/[A-Z]\w*/g)].map(m => m[0]);

const js = (source: string) => new Response(source, { headers: { "content-type": "text/javascript" } });
const file = (path: string) => new Response(readFileSync(path, "utf8"), { headers: { "content-type": "text/javascript" } });

/**
 * The page installs NO import map, on purpose.
 *
 * `registerRuntimeModules()` installs one containing blob modules for the react family *and* the
 * `$dsh/*` capabilities, and it refuses to install over a map that is already there — so a
 * harness that provides its own react map leaves every `$dsh/*` blob unresolvable, and a card
 * importing one fails to compile with `Unresolvable imports`. Instead the page publishes the
 * React globals from the UMD builds, and `/surface.js` is imported first so its registration is
 * what the browser resolves against.
 */

/*
 * The host's design tokens, captured from a live `dsh web` (both themes, 350 values each).
 *
 * Without them every `var(--dsw-alias-…)` resolves to nothing, so a card that borders and fills
 * correctly renders as unstyled text — and a screenshot of that is a picture of the harness, not
 * of the card. The first real card screenshotted here looked broken for exactly this reason.
 *
 * THEME=dark to see the ground the app actually ships with.
 */
const theme = process.env.THEME === "dark" ? "dark" : "light";
const themeVars = Object.entries(
  JSON.parse(readFileSync(new URL(`../test/fixtures/dsw-tokens-${theme}.json`, import.meta.url), "utf8")) as Record<string, string>,
)
  .map(([name, value]) => `${name}:${value}`)
  .join(";");

Bun.serve({
  port,
  routes: {
    "/umd/react.js": () => file("node_modules/react/umd/react.development.js"),
    "/umd/react-dom.js": () => file("node_modules/react-dom/umd/react-dom.development.js"),
    "/m/react.js": () => js(["const R = globalThis.React;", "export default R;", ...reactKeys.map(k => `export const ${k} = R[${JSON.stringify(k)}];`)].join("\n")),
    "/m/jsx-runtime.js": () => js("const R = globalThis.React;\nexport const Fragment = R.Fragment;\nexport const jsx = (t, p, k) => R.createElement(t, k === undefined ? p : { ...p, key: k });\nexport const jsxs = jsx;\nexport const jsxDEV = jsx;"),
    "/m/react-dom.js": () => js("const D = globalThis.ReactDOM;\nexport default D;\nexport const { flushSync, createPortal } = D;"),
    "/m/react-dom-client.js": () => js("export const createRoot = globalThis.ReactDOM.createRoot;"),
    // partial-react imports it; nothing under test calls it.
    "/m/react-dom-server.js": () => js("export const renderToString = () => '';\nexport default { renderToString };"),
    "/surface.js": () => js(bundle),
    "/card": () => (cardPath === undefined ? new Response("no card", { status: 404 }) : new Response(readFileSync(cardPath, "utf8"), { headers: { "content-type": "text/plain" } })),
    "/icons": () => new Response(JSON.stringify(lucideNames), { headers: { "content-type": "application/json" } }),
    [WASM_PATH]: () => new Response(readFileSync("node_modules/@esm.sh/tsx/pkg/tsx_bg.wasm"), { headers: { "content-type": "application/wasm" } }),
    "/": () =>
      new Response(
        `<!doctype html><meta charset=utf8>
<style>:root{${themeVars}}body{margin:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,system-ui,-apple-system,sans-serif)}</style>
<script src="/umd/react.js"></script><script src="/umd/react-dom.js"></script>
<div id=root></div>`,
        { headers: { "content-type": "text/html" } },
      ),
  },
});
console.log(`surface harness on ${port} — ${reactKeys.length} react exports${cardPath === undefined ? "" : `, card ${cardPath} with ${lucideNames.length} icons`}`);
