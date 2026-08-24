import { resolve } from "node:path";

/**
 * Where the two halves land. Overridable so a build can be a pure CHECK — see the wave guard
 * below, which is about writing `lib/`, not about compiling.
 */
const OUTDIR = process.env.BUILD_OUTDIR ?? "lib";

// A wave measures `lib/`, so REPLACING it while one runs changes the prompt under jobs that are
// already in flight: they come back `stale` (the eval guard catches those) or, worse, they come
// back with a VERDICT produced by a different prompt than the one the wave reported. That has
// happened four times, and every time it was the same shape — an unrelated edit, a reflexive
// `bun run build`, and a wave whose numbers mix two prompts. Remembering not to do it has not
// worked, so the build refuses instead.
//
// The guard is on the OUTPUT, not on building: `bun run check` compiles to prove the tree is
// sound, and a check that cannot run during a wave means no push during a wave — which is how
// this first showed up. `BUILD_OUTDIR=… ` sends the artefacts somewhere else and the guard has
// nothing to protect. `--force` still overrides for a wave known to be void.
if (OUTDIR === "lib" && !Bun.argv.includes("--force")) {
  const ps = Bun.spawnSync(["pgrep", "-f", "run-wave.py"]);
  if (ps.exitCode === 0 && new TextDecoder().decode(ps.stdout).trim() !== "") {
    console.error("refusing to overwrite lib/: a wave is running, and replacing it moves the prompt under jobs already in flight.");
    console.error("  to check the tree without touching it: BUILD_OUTDIR=/tmp/build-check bun run build");
    console.error("  or `bun run build --force` if you know this wave is already void.");
    process.exit(1);
  }
}

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

import { PLATFORM_MODULES } from "./platform.ts";

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
  outdir: OUTDIR,
  target: "node",
  format: "esm",
  external: ["@deepseek-ai/*"],
  naming: "[dir]/[name].[ext]",
});

const client = await Bun.build({
  entrypoints: ["src/client/index.ts"],
  outdir: OUTDIR,
  target: "browser",
  format: "cjs",
  external: PLATFORM_MODULES,
  // partial-react's preflight imports `react-dom/server`, whose exports map only routes to
  // server.browser.js under the `browser` condition — without it the Node build comes in and
  // drags require("stream"/"url"/"util") into a browser bundle.
  conditions: ["browser"],
  plugins: [bundleReactDomServer],
  // Pinned, because otherwise the bundle depends on the CALLER'S environment. Bun picks the JSX
  // runtime from NODE_ENV and the `define` below does not reach the transform — it rewrites
  // strings in the code. Measured: `NODE_ENV=production bun run build` emits 0
  // `require("react/jsx-dev-runtime")`, `NODE_ENV=test` emits 3 (GenUISurface, CanvasPanel,
  // CanvasLauncher). `bun test` sets NODE_ENV=test for its children, and one test shells out to
  // `bun run build` — so running the test suite left `lib/` in a state where the shell's module
  // table has no `react/jsx-dev-runtime`, the client half failed to load, and dsh web showed
  // "Failed to load plugins" over a blank page. It cost two wrong diagnoses before the pattern
  // showed: the bundle was fine right after a build and broken right after a test.
  jsx: { runtime: "automatic", development: false },
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
