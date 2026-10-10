## Declare every hook before the JSX

An inline card is recompiled on every streamed frame and the renderer keeps its state only
while the **hook signature** is unchanged; add a hook and the tree remounts, so a chart drawn
so far starts again from nothing.

This is normally invisible, and measuring a real card shows why: across 53 streamed frames the
hook count changed three times — **all three inside the first 21%, before the `return` existed at
all.** Remounting an empty card costs nothing, and for the remaining 79% the signature held
steady while the chart filled in.

That free ride depends on writing them in the ordinary order: **all `useState` / `useMemo` /
`useEffect` at the top of the component, none of them conditional, and none added after the
markup is on screen.** A hook introduced late — or one behind an `if` that flips — lands the
remount in the middle of a visible card, and the reader watches it blank and rebuild.

**The default export is the only component that survives a chunk.** Every chunk recompiles the
module, so a component the card defines itself — `function Row()` rendered as `<Row />` — is a
new type on every frame, and its whole subtree is thrown away and built again: its images go blank
and reload, a map inside it is torn down and redrawn. Measured on one streamed card with nine photo
rows and a map: **37 visible flashes while it streamed as `<Row />`, 3 with the rows written as
plain calls** — and those 3 were the page scrolling. So hooks go at the top of the default export,
and a repeated piece is a function that returns JSX and is *called*:

```tsx
function row(n: number, name: string, photo: string | undefined) {
  return <li key={n} className="flex gap-3">{photo && <img src={photo} className="size-16 rounded-lg object-cover" />}…</li>
}
// inside the default export, after its hooks:
<ol>{row(1, "Ferry Building", photos[0])}{row(2, "Pier 39", photos[1])}</ol>
```

A helper called this way owns no hooks; state it needs lives in the export and is passed in.

**And write the markup before the data.** Until the first JSX arrives the reader is looking at
source, so everything above `export default` is time spent on code instead of the card. On the
same card, nine stops of text in an array above the export put the first paint at ~12s; the same
text written straight into the JSX as `{row(…)}` calls painted at ~6–7s. Keep the top of the file
to imports, the constants the hooks need, and the helpers.

**A library that owns its element needs one React never renders.** Leaflet, MapLibre and chart
libraries add their own classes to the element you hand them — and while the card streams, React
keeps rewriting that element's `className` as the attribute grows, wiping theirs: measured with
Leaflet, the map came out as loose tiles with no container styles. Hand the library a child you
append yourself, and refit on resize, because the height class may not have arrived when the ref
first fires:

```tsx
const map = useRef<L.Map | null>(null)
const attachMap = useCallback((el: HTMLDivElement | null) => {
  map.current?.remove(); map.current = null
  if (!el) return
  const box = el.appendChild(document.createElement("div")); box.style.cssText = "width:100%;height:100%"
  const m = (map.current = L.map(box))
  // …tile layer, markers, route…
  new ResizeObserver(() => { m.invalidateSize(); m.fitBounds(bounds) }).observe(box)
}, [])
<div ref={attachMap} className="h-80 rounded-xl overflow-hidden border border-line" />
```

## Anything that keeps running

A game loop, an AutoPlay demo, a metronome, a clock, a progress animation — anything on
`requestAnimationFrame`, `setInterval` or a `MediaStream` — **must be returned from its
effect's cleanup.** Measured: after the card is unmounted, a loop with a `cancelAnimationFrame`
cleanup stops dead, and one without keeps ticking for as long as the tab is open.

This matters here more than in an ordinary app, because **a card is replaced every time the
user asks for a change.** Ten revisions of a Snake card leaves ten loops running, each still
painting into a canvas nobody can see, and the symptom is not a broken card — it is the whole
conversation getting slower for reasons that look like someone else's fault.

```tsx
useEffect(() => {
  let id = requestAnimationFrame(function tick() { step(); id = requestAnimationFrame(tick) })
  return () => cancelAnimationFrame(id)
}, [])
```

The same goes for `setInterval` (`clearInterval`), listeners on `window` or `document`
(`removeEventListener`), and an `AudioContext` (`close()`). If AutoPlay is meant to be shown to
someone, give it a visible pause as well — a demo you cannot stop is a demo you cannot talk over.

**A handler the reader can start twice needs the same discipline, and an effect's cleanup does
not cover it.** Clicking "生成" while the last stream is still arriving runs both loops at once:
they interleave their `setState` calls, and whichever started FIRST usually finishes last, so
the answer the reader is looking at gets overwritten by the one they replaced. Measured across
378 cards: 23 do this, and the majority of them await `bash`, which has no time bound at all.

Bump a ref on entry and let a superseded run return:

```tsx
const runId = useRef(0)
const generate = async (topic: string) => {
  const id = ++runId.current
  for await (const chunk of streamText({ prompt: topic })) {
    if (id !== runId.current) return   // a newer click owns the state now
    setLines(chunk)
  }
}
```

Inside a `useEffect` the same job is done by `let cancelled = false` and a cleanup that sets it —
use whichever the surrounding code already uses.
