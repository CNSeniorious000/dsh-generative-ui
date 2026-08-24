// Screenshot one card on the real GenUISurface, for the half of "is this card any good" that
// only the eye can answer: a card can paint every node, announce every state, and still be
// unreadable. `mount-card.sh` reports text and a11y state; this reports layout.
//
// Needs playwright, which this repo does not depend on — run it from a checkout that has one
// (`macaron-genui-demo`). ego-browser's Page.captureScreenshot times out against this page.
//
// Usage: node scripts/shot-card.mjs <port> <out.png> [width]
//   with `bun scripts/surface-harness.ts <port> <card.tsx>` already running (THEME=dark for the
//   other ground).
// Mirrors mount-card.sh's mount exactly (same surface.js, lucide stand-in, 440px host).
import { chromium } from 'playwright'
const [port, out, width = '440'] = process.argv.slice(2)
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: +width + 40, height: 1000 }, deviceScaleFactor: 2 })
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
  const host = document.createElement('div')
  host.style.width = w + 'px'; document.body.appendChild(host)
  createRoot(host).render(React.createElement(GenUISurface, { code, streaming: false }))
}, width)
try { await p.waitForFunction(() => (document.body.innerText || '').trim().length > 40, { timeout: 20000 }) }
catch { console.log('WARN never painted') }
await p.waitForTimeout(1200)
console.log('text:', (await p.innerText('body')).replace(/\s+/g, ' ').slice(0, 100))
if (errs.length) console.log('pageerror:', errs[0])
await p.screenshot({ path: out, fullPage: true })
await b.close()
console.log('saved', out)
