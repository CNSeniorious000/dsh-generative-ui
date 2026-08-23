/**
 * Renders each card with `react-dom/server` and reports the ones that paint nothing.
 *
 * `compile-cards.ts` proves a card compiles and passes the screens; neither proves it PAINTS.
 * Two of 17 freshly generated cards called `useState` without importing it — clean under all 18
 * screens, blank on screen. That class of failure is invisible to a text predicate and obvious
 * to a render.
 *
 * The browser driver in `render-check.md` is still the truth (real effects, real layout, real
 * `innerText`). This is the cheap version that needs no browser and runs in `check`.
 *
 * Measured against the 378-card corpus, where the browser found 9 failures: this finds **7 of
 * them and nothing else** — no card that painted in a browser fails here. The two it cannot see
 * both need more than a first synchronous render: a module-scope hook throws React #321 only
 * under a real root, and an unguarded `[0]` needs the effect to have run.
 *
 * Usage: bun scripts/paint-cards.ts [dir]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { cardsIn, compileSettled, initTsxFromDisk } from "./tsx-node.ts";
import { TOOL_CALL_MARKUP } from "../src/client/runtime/segments.ts";

// The `$dsh/*` stubs warn on every call, by design — outside dsh there is no harness to reach.
// Here that is expected, and 22 cards' worth of prompts on stderr buries the actual report.
const realWarn = console.warn;
console.warn = () => {};

// Browser globals a card may touch during its first render. Faithful, not inert: a real Map
// behind `localStorage` means a card that writes a draft and reads it back on mount behaves
// exactly as it would — and without this, `localStorage is not defined` reports a working card
// as broken, which is the failure this script exists to avoid making.
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size },
  },
  matchMedia: (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }),
});

await initTsxFromDisk();
const dir = process.argv[2] ?? "test/cards";
let bad = 0;
let skipped = 0;
let corrupt = 0;

for (const name of cardsIn(dir)) {
  const src = readFileSync(`${dir}/${name}`, "utf8");
  // Leaked tool-call markup: strip it exactly the way the runtime does, then paint. The one
  // corpus card in this state (`6d82723c61a7.tsx`) renders fine once the tags are gone, so
  // reporting it as corrupt sent the next reader looking for a bug that was in the extraction.
  // Anything the runtime's own strip does NOT remove is still corrupt — the tags are mid-body.
  const stripped = src.replace(TOOL_CALL_MARKUP, "");
  if (/｜｜DSML｜｜|<\/parameter>|<\/invoke>/.test(stripped)) { console.log(`${name.padEnd(26)} CORRUPT EXTRACTION — a control token leaked into the middle of the source`); corrupt += 1; continue }
  let status: string;
  try {
    // `$dsh/*` does not resolve outside dsh, and a card that uses a capability is exactly the
    // kind worth rendering — skipping them would leave the check blind to half the corpus.
    // `types/standalone/*.js` already stands in for every member with the right shape.
    const wired = stripped
      .replaceAll(/(["'])\$dsh\/(ai|fs|exec|chat)\1/g, (_whole, quote: string, group: string) => `${quote}${resolve(import.meta.dir, `../types/standalone/${group}.js`)}${quote}`)
      // `lucide-react` is icons and nothing else, so a Proxy returning an empty <svg> for any
      // name renders it faithfully enough for this check — and keeps a reference card from being
      // silently skipped in `bun run check`, which is the failure this whole script exists for.
      .replaceAll(/import\s*\{([^}]*)\}\s*from\s*["']lucide-react["']/g, (_whole, names: string) =>
        names.split(",").map((n) => n.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean)
          .map((n) => `const ${n} = () => null;`).join(" "))
      // `partial-json` parses a HALF-arrived JSON string; on a complete one it is `JSON.parse`,
      // and a first synchronous render only ever sees the initial state. 22 corpus cards import
      // it, and stubbing it faithfully is the difference between checking them and skipping them.
      //
      // `recharts` (51 cards) is deliberately NOT stubbed. A stub renders a chart as nothing,
      // which would make this check PASS a card showing a blank chart — a false negative is worse
      // than an honest skip, and the skip is counted.
      .replaceAll(/import\s*\{([^}]*)\}\s*from\s*["']partial-json["']/g, () =>
        "const parse = (s) => { try { return JSON.parse(s) } catch { return undefined } }; const Allow = new Proxy({}, { get: () => 0 });");
    // Normalize first, `final` then `streaming` — the exact two steps `compiler.ts` performs.
    // Compiling the raw source instead tests a path production never takes, in both directions:
    // it misses damage normalize would have repaired, and it misses damage normalize CAUSES.
    const { code } = compileSettled(name, wired);
    // A blob URL is not importable here; a data URL is, and the card's own imports resolve
    // against this process's node_modules — which is why `$dsh/*` and esm.sh-only packages are
    // reported as skipped rather than broken.
    const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
    if (typeof mod.default !== "function") { status = "NO DEFAULT EXPORT"; bad++ }
    else {
      const html = renderToString(createElement(mod.default));
      status = html.replace(/<[^>]*>/g, "").trim().length > 0 || html.length > 40 ? "paints" : "BLANK";
      if (status === "BLANK") bad++;
    }
  } catch (error) {
    const message = String((error as Error).message ?? error).split("\n")[0];
    // An import this process cannot resolve is the harness's limit, not the card's.
    if (/Cannot find (module|package)|Failed to resolve/.test(message)) status = `skipped — ${message.slice(0, 46)}`;
    else { status = `THREW ${message.slice(0, 64)}`; bad++ }
  }
  if (status.startsWith("skipped")) skipped += 1;
  if (!status.startsWith("paints") && !status.startsWith("skipped")) console.log(`${name.padEnd(26)} ${status}`);
}

// Say how many were skipped. A check that silently passes over a third of its input reads
// exactly like one that examined everything and found nothing wrong.
const parts = [skipped && `${skipped} skipped — imports this process cannot resolve`, corrupt && `${corrupt} corrupt extraction`].filter(Boolean);
const note = parts.length === 0 ? "" : ` (${parts.join("; ")})`;
console.warn = realWarn;
console.log(bad === 0 ? `paint: ok — every card in ${dir} renders something${note}` : `paint: ${bad} card(s) render nothing${note}`);
if (bad > 0) process.exit(1);
