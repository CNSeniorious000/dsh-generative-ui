// Screenshot one card on the real GenUISurface, for the half of "is this card any good" that
// only the eye can answer: a card can paint every node, announce every state, and still be
// unreadable. `mount-card.sh` reports text and a11y state; this reports layout.
//
// Shoots every breakpoint the card will actually meet. A card is rendered in a chat column and
// in a panel the reader drags, so `@container` queries mean the layout at 320 is a different
// design from the layout at 720 — judging one of them judges a third of the card.
//
// Needs playwright, which this repo does not depend on. It resolves one from a sibling checkout
// rather than requiring the caller to `cd` there first — three separate runs today failed with
// MODULE_NOT_FOUND because the shot was fired from whatever directory the previous step left.
// ego-browser's Page.captureScreenshot times out against this page, so playwright it is.
//
// Usage: node scripts/shot-card.mjs <port> <out-prefix> [widths]
//   with `bun scripts/surface-harness.ts <port> <card.tsx>` already running (THEME=dark for the
//   other ground). Writes <out-prefix>.<width>.png per width.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
const PLAYWRIGHT_HOSTS = ["../../macaron-genui-demo", "../../ui4a-playground", "../../genui-canvas"];
const host = PLAYWRIGHT_HOSTS.map((d) => new URL(`${d}/package.json`, import.meta.url)).find((u) => existsSync(u));
if (!host) throw new Error(`no sibling checkout with playwright: tried ${PLAYWRIGHT_HOSTS.join(", ")}`);
const { chromium } = await createRequire(host)("playwright");
const [port, prefix, widthArg = "320,440,720"] = process.argv.slice(2);
const widths = widthArg.split(",").map(Number);
const b = await chromium.launch();
for (const width of widths) {
  // Tall viewport so a long card is never truncated by it; the clip below trims the ground back
  // off. deviceScaleFactor 3 because the judge has to read 13px secondary labels.
  const p = await b.newPage({ viewport: { width, height: 4000 }, deviceScaleFactor: 3 });
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.evaluate(async (w) => {
    const { GenUISurface, registerModules } = await import("/surface.js");
    const React = globalThis.React,
      { createRoot } = globalThis.ReactDOM;
    const names = await (await fetch("/icons")).json();
    const icon = () => React.createElement("span", { "data-icon": "" });
    if (names.length) registerModules({ "lucide-react": Object.fromEntries(names.map((n) => [n, icon])) });
    const code = await (await fetch("/card")).text();
    // The page already ships an empty `<div id=root>`, so the host must be marked — measuring
    // `body.firstElementChild` measured that empty div and cropped every card to the 40px floor.
    const host = document.getElementById("root") || document.body.appendChild(document.createElement("div"));
    host.id = "shot-host";
    // `container-type` is what GenUISurface gives the mount node, and it is the whole reason a
    // width sweep says anything — without it every `@container` rule is inert at every width.
    host.style.width = w + "px";
    host.style.containerType = "inline-size";
    createRoot(host).render(React.createElement(GenUISurface, { code, streaming: false }));
  }, width);
  // "40 characters of text" is an English-shaped threshold: five two-character Chinese names is
  // ten. Wait for the host to have painted a box instead, which is what `hasPainted` asks too.
  try {
    await p.waitForFunction(
      () => {
        const h = document.getElementById("shot-host");
        return h && (h.getBoundingClientRect().height > 20 || (h.innerText || "").trim().length > 8);
      },
      { timeout: 20000 },
    );
  } catch {
    console.log(`WARN ${width} never painted`);
  }
  await p.waitForTimeout(1000);
  // The host box is not the content box. A child that overflows crops short, and a host that
  // collapses while absolutely-positioned children paint crops to nothing — so take the furthest
  // bottom edge any painted descendant reaches.
  const box = await p.evaluate(() => {
    const host = document.getElementById("shot-host");
    let bottom = host.getBoundingClientRect().bottom;
    for (const el of host.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) bottom = Math.max(bottom, r.bottom);
    }
    // Clip to the host's full width, and separately report how much of it the card declined to
    // use. A card with `max-w-[34rem]` inside a 720px host paints 544px and leaves 176px of the
    // page background — but the clip is the host, so the shot has no visible edge and the waste
    // is invisible to anyone reading it. Four judges caught this from the SOURCE while I read the
    // screenshot and saw a full-bleed form.
    return { x: 0, y: 0, width: Math.ceil(host.getBoundingClientRect().width), height: Math.max(40, Math.ceil(bottom)) };
  });
  // Content wider than the card is the one defect a screenshot shows but a human reading the
  // screenshot cannot name: the clip is taken at the host width, so the overflowing part is simply
  // absent, and an absent column looks like a design choice. Measure it instead.
  const over = await p.evaluate(() => {
    const host = document.getElementById("shot-host");
    const right = host.getBoundingClientRect().right;
    const worst = [];
    for (const el of host.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.right > right + 1) worst.push({ px: Math.round(r.right - right), tag: el.tagName.toLowerCase(), cls: (el.className || "").toString().slice(0, 70) });
    }
    return worst.sort((a, b) => b.px - a.px)[0] || null;
  });
  // `.ui4a-root` is the full-width wrapper GenUISurface mounts, so measuring every descendant
  // always finds it at the host's own right edge and reports 0 — the first version of this probe
  // was silent on the very card four judges flagged. Skip the wrapper and measure the CARD.
  const unused = await p.evaluate(() => {
    const host = document.getElementById("shot-host");
    const hw = host.getBoundingClientRect().width;
    let right = 0;
    for (const el of host.querySelectorAll("*")) {
      if (el.classList.contains("ui4a-root")) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) right = Math.max(right, r.right);
    }
    return Math.round(hw - Math.min(right, hw));
  });
  // NOT a defect — a signal that needs a human. A short list capped at `max-w-[28rem]` leaves
  // 240px unpainted at 720 and is RIGHT to: stretched full-bleed, a meal name and its number sit a
  // screen apart. Four judges called the same `max-w` a bug from the source alone. Reported so the
  // reader can look, not so the count can be minimised.
  if (unused > 24) console.log(`UNUSED ${width} ${unused}px of ${width} unpainted (judge by eye)`);
  if (over) console.log(`OVERFLOW ${width} +${over.px}px ${over.tag}.${over.cls}`);
  // The other half of the same squeeze. `min-width: auto` makes a sibling overflow; `shrink`
  // makes the element itself collapse, and a button crushed to a coloured lozenge with its label
  // clipped away does NOT overflow, so the check above is blind to it. Measured on a wave 2 card:
  // an "Añadir" button rendered 44px wide with no text in it, and every screen passed.
  const crushed = await p.evaluate(() => {
    const host = document.getElementById("shot-host");
    const out = [];
    for (const el of host.querySelectorAll("button, a[href]")) {
      const r = el.getBoundingClientRect();
      const label = (el.innerText || el.getAttribute("aria-label") || "").trim();
      if (r.width > 0 && label && el.scrollWidth > r.width + 2) out.push({ px: Math.round(r.width), want: el.scrollWidth, label: label.slice(0, 24) });
    }
    return out.sort((a, b) => b.want - a.want)[0] || null;
  });
  if (crushed) console.log(`CRUSHED ${width} "${crushed.label}" ${crushed.px}px wants ${crushed.want}px`);
  // The gap the other three cannot see. A card whose ROOT has no padding puts its text flush
  // against the host edge: nothing overflows (the content is flush TO the host, not past it),
  // nothing is crushed, and no width goes unpainted — all three probes stay silent while a title
  // loses its last character to the clip. Measured on a wave-2 card whose root was a bare
  // `<div className="grid gap-3">`; 28 of 29 others write `p-4` and are nowhere near 0.
  const flush = await p.evaluate(() => {
    const host = document.getElementById("shot-host");
    const hr = host.getBoundingClientRect();
    let best = 1e9, who = null;
    for (const el of host.querySelectorAll("*")) {
      if (el.classList.contains("ui4a-root")) continue;   // the full-width wrapper, same as UNUSED
      // Only TEXT-BEARING LEAVES. The first version measured every element, so it fired on both
      // the defect and the control: a card's own root div is supposed to fill the host, and a
      // card with perfect `p-4` still has a 0px-from-edge container. What loses a character to
      // the clip is the text, so the text is what has to be measured.
      if (el.children.length) continue;
      if (!(el.textContent || "").trim()) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const gap = Math.min(r.left - hr.left, hr.right - r.right);
      if (gap < best) { best = gap; who = `${el.tagName.toLowerCase()}.${(el.className || "").toString().slice(0, 30)}`; }
    }
    return { px: Math.round(best), who };
  });
  if (flush.px < 4) console.log(`FLUSH ${width} ${flush.px}px from the host edge — ${flush.who}`);
  if (process.env.PROBE_TRUNC) {
    const t = await p.evaluate(() => [...document.querySelectorAll(".truncate")].map((e) => ({
      t: (e.textContent || "").trim().slice(0, 24), box: Math.round(e.getBoundingClientRect().width), want: e.scrollWidth,
      parent: Math.round(e.parentElement.getBoundingClientRect().width),
    })).filter((x) => x.want > x.box + 1));
    if (t.length) console.log(`TRUNC ${width} ` + JSON.stringify(t));
  }
  if (errs.length) console.log(`pageerror ${width}:`, errs[0]);
  await p.screenshot({ path: `${prefix}.${width}.png`, clip: box });
  console.log(`saved ${prefix}.${width}.png  ${box.width}x${box.height}`);
  await p.close();
}
await b.close();
