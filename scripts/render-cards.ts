/**
 * Mounts each card in a real browser and reports whether it painted.
 * `compile-cards.ts` proves a card compiles; CLAUDE.md §4 has three separate ways a card
 * compiles cleanly and renders blank, so the only honest check is to run one.
 *
 * Serves a page that imports the card as a blob module and mounts it, then the caller
 * drives it with ego-browser and reads `window.__cardResult`.
 */
import { readdirSync, readFileSync } from "node:fs";

const dir = process.argv[2] ?? ".research/cards";
const cards = readdirSync(dir).filter(n => n.endsWith(".tsx")).toSorted();
const port = Number(process.argv[3] ?? 47771);

Bun.serve({
  port,
  routes: {
    "/": () =>
      new Response(
        `<!doctype html><meta charset=utf8><div id=root></div>
<script type="importmap">{"imports":{"react":"https://esm.sh/react@18","react-dom/client":"https://esm.sh/react-dom@18/client","react/jsx-runtime":"https://esm.sh/react@18/jsx-runtime","lucide-react":"https://esm.sh/lucide-react@0.400.0?external=react","recharts":"https://esm.sh/recharts@2?external=react"}}</script>
<script type="module">
window.__cards = ${JSON.stringify(cards)};
window.__src = {};
</script>`,
        { headers: { "content-type": "text/html" } },
      ),
    "/card/:name": req => new Response(readFileSync(`${dir}/${req.params.name}`, "utf8"), { headers: { "content-type": "text/plain" } }),
  },
});
console.log(`serving ${cards.length} cards on ${port}`);

/*
 * Drive it with ego-browser: open `/`, then in the page compile each `/card/:name` through
 * @esm.sh/tsx, import it as a blob module, mount it with createRoot, and read back innerText.
 *
 * When clicking a control from script, dispatch the whole sequence
 * (pointerdown, mousedown, pointerup, mouseup, click) — a bare `.click()` on a React button
 * can leave state untouched and looks exactly like a broken card.
 */
