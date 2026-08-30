/**
 * Render one card file in the real `GenUISurface` and report what happened to it.
 *
 * The question this answers is the one a transcript cannot: a card that "does not render" may be
 * failing to transform, failing to compile, failing to import, or rendering an empty tree — and
 * those look identical in a session log, where all you see is a fence and a user saying it did not
 * work. Here the surface's own `onError` says which phase, and the host's height says whether
 * anything painted.
 *
 *   node scripts/render-card.mjs <card.tsx> [port]
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const cardPath = process.argv[2];
if (!cardPath) throw new Error("usage: node scripts/render-card.mjs <card.tsx> [port]");
const PORT = Number(process.argv[3] ?? 47921);

const resolveFrom = (dir) => {
  const url = new URL(`${dir}/package.json`, import.meta.url);
  if (!existsSync(url)) return null;
  try { const require = createRequire(url); require.resolve("playwright"); return require; } catch { return null; }
};
const pwRequire = ["..", "../../macaron-genui-demo", "../../canvas-agent-probe"].map(resolveFrom).find(Boolean);
if (!pwRequire) throw new Error("playwright resolves from none of the candidate hosts");
const { chromium } = await pwRequire("playwright");

const code = readFileSync(cardPath, "utf8");
const repo = new URL("..", import.meta.url).pathname;
const harness = spawn("bun", ["scripts/surface-harness.ts", String(PORT)], { cwd: repo, stdio: "ignore" });
process.on("exit", () => harness.kill());
for (let i = 0; i < 80; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/surface.js`)).ok) break; } catch { /* not up */ }
  await new Promise(r => setTimeout(r, 250));
}

const browser = await chromium.launch();
const page = await browser.newPage();
const noise = [];
page.on("pageerror", e => noise.push(`pageerror: ${e.message}`));
page.on("console", m => { if (m.type() === "error") noise.push(`console: ${m.text().slice(0, 240)}`); });
await page.goto(`http://127.0.0.1:${PORT}/`);

await page.evaluate(async (source) => {
  const { GenUISurface } = await import("/surface.js");
  const host = document.createElement("div");
  host.id = "surface-host";
  document.body.appendChild(host);
  globalThis.__errs = [];
  globalThis.__painted = 0;
  globalThis.ReactDOM.createRoot(host).render(globalThis.React.createElement(GenUISurface, {
    code: source,
    streaming: false,
    onError: (e, phase) => globalThis.__errs.push(`${phase}: ${e.message}`),
    onRendered: () => { globalThis.__painted += 1; },
  }));
}, code);

// Long enough for an esm.sh probe to settle; a card importing an unregistered package cannot
// paint before that round trip, and reporting "blank" at 2s would blame the card for the network.
await page.waitForTimeout(12000);
const out = await page.evaluate(() => {
  const host = document.querySelector("#surface-host");
  return {
    height: Math.round(host?.getBoundingClientRect().height ?? 0),
    painted: globalThis.__painted,
    errs: globalThis.__errs,
    text: (host?.innerText ?? "").trim().slice(0, 300),
  };
});

console.log(`${cardPath}  ${code.length} 字符`);
console.log(`  painted 回调触发 ${out.painted} 次，surface 高度 ${out.height}px`);
if (out.errs.length) { console.log("  onError:"); for (const e of out.errs) console.log(`    ${e}`); }
else console.log("  onError: 无");
if (noise.length) { console.log("  浏览器错误:"); for (const n of noise.slice(0, 6)) console.log(`    ${n}`); }
console.log(`  可见文本: ${JSON.stringify(out.text.slice(0, 160))}`);

await browser.close();
harness.kill();
