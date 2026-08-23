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

// The `$dsh/*` stubs warn on every call, by design — outside dsh there is no harness to reach.
// Here that is expected, and 22 cards' worth of prompts on stderr buries the actual report.
const realWarn = console.warn;
console.warn = () => {};

await initTsxFromDisk();
const dir = process.argv[2] ?? "test/cards";
let bad = 0;
let skipped = 0;
let corrupt = 0;

for (const name of cardsIn(dir)) {
  const src = readFileSync(`${dir}/${name}`, "utf8");
  // A leaked control token means the EXTRACTION was truncated mid-generation, not that the card
  // is wrong — reporting it as a defect sends the next reader looking for a bug in code the model
  // never finished writing. One of the 378 corpus cards is in this state.
  if (/｜｜DSML｜｜|<\/parameter>|<\/invoke>/.test(src)) { console.log(`${name.padEnd(26)} CORRUPT EXTRACTION — a control token leaked into the source`); corrupt += 1; continue }
  let status: string;
  try {
    // `$dsh/*` does not resolve outside dsh, and a card that uses a capability is exactly the
    // kind worth rendering — skipping them would leave the check blind to half the corpus.
    // `types/standalone/*.js` already stands in for every member with the right shape.
    const wired = src
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
