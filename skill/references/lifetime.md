# State, submission, and persistence

Two things follow from the lifetime difference:

- An **inline** block that the user acts on should *end that step* — see the next entry for WHICH control ends it, because on a card whose options need previewing it is not the one they pick with. Whichever it is, that control does two things: send the result with `sendMessage` **and** record what was chosen in `usePersistedState`, so the card still shows it when scrolled back to weeks later.

  **The second half is the one that gets dropped, and it fails in two different ways.** Measured over the 105 turns where a reader actually submitted something: **36 (34%) left the card looking exactly as it had before the click**, and another **20 (19%) showed the choice and then lost it on reload** — 53% between them, and evenly spread across every model, so it is the rule and not a habit. The first is forgetting to record at all (`sendMessage` treated as the finish line); the second is recording into `useState`, which a reload throws away. Both read to the reader as a form that did not take their answer.

  So the submit handler has three statements, not one:

      const [answer, setAnswer] = usePersistedState<string | null>("<this card>-answer", null)
      …
      onClick={() => { setAnswer(pick); sendMessage(…) }}        // record, then send
      …
      {answer !== null && <p className="text-muted">已选择：{label(answer)}</p>}   // and SHOW it

  The third line is the one nobody writes — but not for the reason it first looked like. Of the
  cards that call `usePersistedState`, **91 of 93 do render the value somewhere**; what they render
  it as is `aria-pressed` on the button that was clicked. Reading the turns where a submit left the
  card unchanged: **31 of 42 mark the choice with a highlight and say nothing in words**, and 19 of
  those 42 hold it in `useState`, so the highlight is gone after a reload. A highlight is a fine
  way to show which control is active while the reader is still there; it is not an answer to
  someone coming back to this card next week, who sees one button shaded and no statement of what
  was decided. Say it in words AND keep it in `usePersistedState`. (Re-firing on reload is the opposite mistake and does not happen — 0 of 105 — so
  guard the send with the recorded answer, not with anything cleverer.)
- **Exactly one control ends the step, and the reader must be able to find it.** This is the
  single largest hole in what gets built: across 161 runs where the reader actually clicked
  something, **108 of them — 67% — never once got a result back out of the card**, 468 clicks that
  went nowhere. It is not one model's habit (every one of the ten does it) and not one case's
  (every case does it). The shape is always the same: a card you can fiddle with forever and never
  finish.

  **The check is one grep, so run it on what you just wrote: does the source contain a
  `sendMessage` call at all?** Re-measured over 171 clicking runs, 117 of them dead: **90 — 77% —
  have no `sendMessage` anywhere in the card**. The reader clicks `RESTful (JSON)`, `下一步 →`,
  `2. 尺度缩放 / √d` — real controls, wired to internal state and to nothing else — and the
  conversation stops there. Not "the ending was hard to find": there was none to find.

  Two endings are correct, and which one depends on whether the options need explaining:

  - **The options speak for themselves** (yes/no, this file or that one) — the click IS the answer.
    Two plain buttons, no card around them, `sendMessage` on click. Nothing to preview.
  - **The options mean something you have to see to choose between** — then the click SELECTS and
    shows, and a separate **Submit** sends. Clicking a tab must not fire the turn; a reader
    comparing three options should be able to look at all three first.

  The preview form is a selector, a result area, and one submit — that is the whole structure, and
  the result area is where the card earns its existence:

      const [pick, setPick] = useState(OPTIONS[0].id)
      const [sent, setSent] = usePersistedState<string | null>("migration-plan-choice", null)
      …
      <div className="flex flex-wrap gap-2">…one button per option, aria-pressed={pick === o.id}…</div>
      <div className="mt-3">{OPTIONS.find((o) => o.id === pick)!.preview}</div>
      <button disabled={sent !== null} onClick={() => { setSent(pick); sendMessage(…) }}>…</button>

  `preview` is whatever actually shows the difference: a mermaid graph of the two migration paths,
  the formula rendered by katex, an SVG of the layout, a working miniature of the thing, a 3D view,
  a playable board. A paragraph of text describing the option is not a preview — the reader could
  have read that in the reply.

  **And it fires once.** `sent` above is persisted, so a reload shows the answer that was given
  rather than an untouched form, and the button cannot send a second turn for a question already
  answered.

- A **canvas** stays interactive. It does not "complete"; it just sits there working.
- A **canvas outlives the reply that made it**, so data the user puts into it — entries, notes, cards — must survive a reload on its own. Reach for `usePersistedState` from `$dsh/state` — `useState`'s signature including a lazy initialiser, with the value kept in `localStorage` under a namespaced key, and the read and write already wrapped:

  ```tsx
  import { usePersistedState } from "$dsh/state"
  const [entries, setEntries] = usePersistedState<Entry[]>("expense-ledger", [])
  ```

  **Name the key after this canvas, not after the data.** `"ledger"`, `"todos"`, `"settings"` are what every card reaches for, and two cards sharing a key share the rows. Plain `useState` is a bug you cannot see while building: the ledger looks right until the tab reloads and every row is gone.
  **And a reload is not the common case — your own next edit is.** Every revision replaces the
  whole file, so the canvas remounts and anything held only in `useState` is gone; change one word
  in a label and the user's half-typed row goes with it. Persist what they typed, not just what
  they saved.

  **An inline card is clickable before you have finished writing it, and that is where this bites
  hardest.** The reader sees the first controls while the rest of the card is still arriving, and
  **every chunk that adds JSX remounts every component the card defines itself** — so a choice they
  make mid-stream is wiped by the next chunk, silently, with the control snapping back to its
  initial state. Measured three ways on the same card, one variable each: state in a
  card-defined child is lost, the same state in the exported component survives, and
  `usePersistedState` survives in either. **Two chunks is enough** — this is not a rare race.

  So anything the reader can change belongs in `usePersistedState`, not only the answer you
  intend to record. The one case it cannot reach is a third-party component holding its own state:
  `<Disclosure defaultOpen>` reverts to `defaultOpen` on every remount, and the only way to keep
  what the reader did is to control it yourself from persisted state.

  **If you write `setRows(prev => prev.filter(r => r.id !== id))` behind a button, keep the row.**
  Persisting is what makes that line permanent — before it, a mistaken delete came back on reload.
  Hold the removed row and offer it back:

  ```tsx
  const [undo, setUndo] = React.useState<Row | null>(null)
  const remove = (id: string) => {
    setUndo(rows.find((r) => r.id === id) ?? null)
    setRows((prev) => prev.filter((r) => r.id !== id))
  }
  { undo && <button onClick={() => { setRows((p) => [...p, undo]); setUndo(null) }}>Undo delete</button> }
  ```

  A confirm step does the same job — but not the browser's own `confirm()`, which is a modal
  from another era sitting on top of a panel that has its own visual language, and which offers
  no way back once it is answered.

  **The reason this is missed is not that undo is hard to write — it is that the line does not
  look like a delete.** Measured across 36 cards that destroy something: 10 shipped no way back,
  and every one of them had written one of these without recognising it:

  - `setRows(prev => prev.filter(r => r.id !== id))` — 6 of the 10
  - `delete obj[key]` on a persisted map — the other 4, and the one that reads least like a
    delete because nothing named `remove` appears anywhere near it
  - `rows.splice(i, 1)`
  - `setRows([])` behind "clear", "reset", "start over", or a new day — but only when the rows
    are the user's; clearing a queue you generated is not a delete
  - setting a quantity or a count to 0 where the row disappears at 0
  - replacing a whole persisted object — `setPlan(freshPlan)` drops whatever the user edited

  Anything the user cannot type back in under five seconds needs a way back.

  **A running clock is state too**, and the least obvious kind: a stopwatch or a timer mid-count
  reads 0 again after one edit. Measured — the interval itself is cleaned up correctly, nothing
  stacks up, but the elapsed value is gone. Store the *start timestamp* rather than the elapsed
  count, so the display is derived and survives a remount by arithmetic.

  **Reaching for `localStorage` by hand is where this goes wrong.** A full quota, or storage
  disabled entirely, and `setItem` raises — from inside an effect, where it reaches the error
  boundary and takes the whole card down over a saved preference. Persistence went from 1 corpus
  card to 20 fresh ones once this section asked for it, and **10 of those 29 writes were bare**.
  `usePersistedState` has the `try` on both sides; use it and the question does not arise.
