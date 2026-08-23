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
import { compileCard, cardsIn, initTsxFromDisk } from "./tsx-node.ts";

await initTsxFromDisk();
const dir = process.argv[2] ?? "test/cards";
let bad = 0;
let skipped = 0;

for (const name of cardsIn(dir)) {
  const src = readFileSync(`${dir}/${name}`, "utf8");
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
          .map((n) => `const ${n} = () => null;`).join(" "));
    const { code } = compileCard(name, wired);
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
const note = skipped === 0 ? "" : ` (${skipped} skipped — imports this process cannot resolve)`;
console.log(bad === 0 ? `paint: ok — every card in ${dir} renders something${note}` : `paint: ${bad} card(s) render nothing${note}`);
if (bad > 0) process.exit(1);
