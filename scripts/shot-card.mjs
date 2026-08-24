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
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
const PLAYWRIGHT_HOSTS = ['../../macaron-genui-demo', '../../ui4a-playground', '../../genui-canvas']
const host = PLAYWRIGHT_HOSTS.map((d) => new URL(`${d}/package.json`, import.meta.url))
  .find((u) => existsSync(u))
if (!host) throw new Error(`no sibling checkout with playwright: tried ${PLAYWRIGHT_HOSTS.join(', ')}`)
const { chromium } = await createRequire(host)('playwright')
const [port, prefix, widthArg = '320,440,720'] = process.argv.slice(2)
const widths = widthArg.split(',').map(Number)
const b = await chromium.launch()
for (const width of widths) {
  // Tall viewport so a long card is never truncated by it; the clip below trims the ground back
  // off. deviceScaleFactor 3 because the judge has to read 13px secondary labels.
  const p = await b.newPage({ viewport: { width, height: 4000 }, deviceScaleFactor: 3 })
  const errs = []
  p.on('pageerror', e => errs.push(String(e).slice(0, 160)))
  await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await p.evaluate(async (w) => {
    const { GenUISurface, registerModules } = await import('/surface.js')
    const React = globalThis.React, { createRoot } = globalThis.ReactDOM
    const names = await (await fetch('/icons')).json()
    const icon = () => React.createElement('span', { 'data-icon': '' })
    if (names.length) registerModules({ 'lucide-react': Object.fromEntries(names.map(n => [n, icon])) })
    const code = await (await fetch('/card')).text()
    // The page already ships an empty `<div id=root>`, so the host must be marked — measuring
    // `body.firstElementChild` measured that empty div and cropped every card to the 40px floor.
    const host = document.getElementById('root') || document.body.appendChild(document.createElement('div'))
    host.id = 'shot-host'
    // `container-type` is what GenUISurface gives the mount node, and it is the whole reason a
    // width sweep says anything — without it every `@container` rule is inert at every width.
    host.style.width = w + 'px'
    host.style.containerType = 'inline-size'
    createRoot(host).render(React.createElement(GenUISurface, { code, streaming: false }))
  }, width)
  // "40 characters of text" is an English-shaped threshold: five two-character Chinese names is
  // ten. Wait for the host to have painted a box instead, which is what `hasPainted` asks too.
  try {
    await p.waitForFunction(() => {
      const h = document.getElementById('shot-host')
      return h && (h.getBoundingClientRect().height > 20 || (h.innerText || '').trim().length > 8)
    }, { timeout: 20000 })
  } catch { console.log(`WARN ${width} never painted`) }
  await p.waitForTimeout(1000)
  // The host box is not the content box. A child that overflows crops short, and a host that
  // collapses while absolutely-positioned children paint crops to nothing — so take the furthest
  // bottom edge any painted descendant reaches.
  const box = await p.evaluate(() => {
    const host = document.getElementById('shot-host')
    let bottom = host.getBoundingClientRect().bottom
    for (const el of host.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) bottom = Math.max(bottom, r.bottom)
    }
    return { x: 0, y: 0, width: Math.ceil(host.getBoundingClientRect().width), height: Math.max(40, Math.ceil(bottom)) }
  })
  if (errs.length) console.log(`pageerror ${width}:`, errs[0])
  await p.screenshot({ path: `${prefix}.${width}.png`, clip: box })
  console.log(`saved ${prefix}.${width}.png  ${box.width}x${box.height}`)
  await p.close()
}
await b.close()
