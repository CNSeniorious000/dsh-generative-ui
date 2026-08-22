import { resolve } from "node:path";

// The panel stylesheet is a real .css file (editors, linters and formatters understand it)
// but reaches the browser as a string the plugin injects itself, because a client bundle is
// one JS factory with no stylesheet channel of its own.
const cssSource = await Bun.file(resolve(import.meta.dir, "../src/client/canvas/panel.css")).text();
await Bun.write(resolve(import.meta.dir, "../src/client/canvas/panel-css.ts"), `/* Generated from panel.css by scripts/build.ts — edit the .css, not this file. */\nexport const PANEL_CSS = ${JSON.stringify(cssSource)};\n`);

/**
 * Two outputs, one package.
 *
 * - node half (lib/index.js, ESM): serves the tsx wasm. cordis and the dsh peers
 *   resolve at runtime from the profile tree, so they stay external.
 * - browser half (lib/client.js, CJS): a closure factory the shell's module loader
 *   materializes. Platform modules resolve through the injected `require`;
 *   everything else is bundled in.
 */

/** The shell's frozen module table (packages/client/web/src/platform.ts). No `scheduler`, no `react-dom/server` — both get bundled. */
const PLATFORM_MODULES = ["react", "react/jsx-runtime", "react-dom", "react-dom/client", "@deepseek-ai/cordis", "@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-ui-primitives"];

const PLUGIN_ID = "dsh-generative-ui";

/**
 * bun's `external` matches subpaths too, so listing `react-dom` (which IS a platform
 * module) also externalizes `react-dom/server` — which is NOT, and would die at
 * materialization with "missed the module table". Resolving it to an absolute path
 * here takes it out of specifier matching entirely, so it gets bundled.
 */
const bundleReactDomServer: import("bun").BunPlugin = {
  name: "bundle-react-dom-server",
  setup(build) {
    const resolved = Bun.resolveSync("react-dom/server.browser.js", resolve(import.meta.dir, ".."));
    build.onResolve({ filter: /^react-dom\/server$/ }, () => ({ path: resolved }));
  },
};

/**
 * partial-react's runtime imports `./compiler`, whose top-level `import.meta.resolve` is a
 * syntax error inside a CJS factory regardless of whether that branch runs. We ship our own
 * browser compiler anyway, so swap the module out at resolve time.
 */
const node = await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "lib",
  target: "node",
  format: "esm",
  external: ["@deepseek-ai/*"],
  naming: "[dir]/[name].[ext]",
});

const client = await Bun.build({
  entrypoints: ["src/client/index.ts"],
  outdir: "lib",
  target: "browser",
  format: "cjs",
  external: PLATFORM_MODULES,
  // partial-react's preflight imports `react-dom/server`, whose exports map only routes to
  // server.browser.js under the `browser` condition — without it the Node build comes in and
  // drags require("stream"/"url"/"util") into a browser bundle.
  conditions: ["browser"],
  plugins: [bundleReactDomServer],
  define: {
    // @esm.sh/tsx's entry reads `import.meta.url`, which does not exist in a CJS factory.
    // Only read on the branches taken when no wasm path was passed, and we always pass one.
    "import.meta.url": JSON.stringify("https://dsh-generative-ui.invalid/"),
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
  },
  banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`,
  footer: "return module.exports; } });",
  sourcemap: "linked",
  naming: "[dir]/client.[ext]",
});

for (const [label, result] of [
  ["node", node],
  ["client", client],
] as const) {
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`${label} build failed`);
  }
  for (const output of result.outputs) console.log(`${label}: ${output.path.split("/").slice(-1)[0]} ${(output.size / 1024).toFixed(1)} kB`);
}
