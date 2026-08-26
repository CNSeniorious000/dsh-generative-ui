/**
 * The taste, loaded on demand.
 *
 * `dsh-base` mounts `dsh-skill` + `dsh-tool-skill` by default, so a runtime registration here
 * shows up in the model's `<available_skills>` catalog and its body is fetched only when the
 * model calls `skill({ name })`. That is the whole reason this file exists separately from
 * prompt.ts: judgement about layout and framing is long, and paying for it on every request —
 * including the ones that are pure prose — is what the skill mechanism exists to avoid.
 *
 * The catalog carries `name` and `description` **only** — not `whenToUse`, not the body — so the
 * description is the entire routing signal and has to name the trigger, not summarise the content.
 */
import { CANVAS_DIR, CANVAS_SUFFIX, CAPABILITY_PREFIX, FENCE_LANG, capabilityModule } from "./contract.ts";

/** The checker, from pkg.pr.new: @genui/cli is a private workspace package and not on npm. */
const CLI_URL = "https://pkg.pr.new/MindLab-Research/macaron-genui-demo/@genui/cli@main";

export const SKILL_NAME = "generative-ui";

export const SKILL_DESCRIPTION = `How to decide between an inline ${FENCE_LANG} block, a canvas file, and plain prose — and how to lay one out so it reads. Load it **before you decide**, not after — including when your first instinct is that prose is enough. Most of the questions that should have been an interface do not ask for one.`;

/**
 * The skill body.
 *
 * A function of the import-map path because that path is only known at runtime — the plugin
 * lives wherever the profile installed it, and the model runs the checker from the workspace.
 * Without the map, `check` reports `Cannot find module "$dsh/chat"` on every card that uses
 * one, and a false error is worse than no check: the model goes and "fixes" it.
 */
/**
 * The paragraph about which import map serves which command.
 *
 * Built here rather than inline: nesting one template interpolation inside another inside the
 * body is how this file broke twice, and the two maps have genuinely different lifetimes —
 * the type one may exist while the stub one does not.
 */
/** Exported for `test/skill.test.ts`: three states, and this file has broken on them twice. */
export function mapNotes(typesMap: string | undefined, standaloneMap: string | undefined): string {
  if (typesMap === undefined) return "";
  const check = [
    // A card is created BY its path. Checking a draft somewhere else therefore produces a card
    // nothing will ever mount — measured once in wave 8: a complete 150-line routine written to
    // `rutina.tsx` in the workspace root, because the model planned "write a temp file, then run
    // the checker" and the checker step never finished. It reads as the model declining to build.
    `**Check the canvas file itself, at \`${CANVAS_DIR}/<id>${CANVAS_SUFFIX}\`.** Writing that path is what creates the`,
    "canvas, so there is no draft stage to check first: a `.tsx` anywhere else is a file the user",
    "will never see, however correct it is. Write it where it belongs, then check it there and fix",
    "it in place — the panel streams as you write and re-renders as you edit.",
    "",
    `The \`-i\` is not optional when the card imports \`${CAPABILITY_PREFIX}/*\`: without it every one of those lines`,
    "is reported as `Cannot find module`, and there is nothing to fix — they resolve at render time.",
    "",
    "**It silences that error rather than typing the calls.** Measured: a map pointing at a file",
    "that does not exist reports `OK` just the same, so `$dsh/*` ends up `any` and a wrong",
    "argument or a misspelt result field passes the check. Everything else in the card is really",
    "type-checked; the capability calls are on you.",
    "",
    "",
    "One more diagnostic never to skim past: *referenced directly or indirectly in its own initializer*. It means",
    "a `const` shadows something of the same name and now refers to itself — `const rows = useMemo(() => rows(x), [x])`",
    "beside a top-level `function rows`. That throws on the first render and the card is blank, and it arrives",
    "surrounded by ordinary `implicitly has an 'any' type` lines that are safe to ignore. Rename the local.",
    "That map holds type declarations, so it serves `check` and `lint`.",
  ].join("\n");
  if (standaloneMap === undefined) return `${check} \`build\` and \`dev\` want runnable JS and will fail on it.`;
  return [
    `${check} \`build\` and \`dev\` want runnable JS, so they take a different one:`,
    "",
    "```",
    `npm_config_cache="$TMPDIR/npm-cache" npx --yes ${CLI_URL} build <file> -i ${standaloneMap}`,
    "```",
    "",
    `That second map stubs \`${CAPABILITY_PREFIX}/*\` — the exported page has no dsh around it, so those calls log to`,
    "the console and return empty instead of working. The layout, the styling and everything that",
    "does not touch the harness are real; anything that does is inert. Useful for showing someone a",
    "snapshot, not for testing the interactive parts.",
  ].join("\n");
}

/**
 * The skill, for the capabilities this host exposes.
 *
 * With commands off the whole `## Running a command` section is cut rather than softened: it is
 * ~90 lines that all assume `bash()` exists, and half a section describing a capability the host
 * does not have is worse than none — the model reads the surviving half as permission.
 */
export const skillBody = (typesMap: string | undefined, standaloneMap: string | undefined, allowExec = false): string =>
  ((maps) =>
    `# Building a generative UI

## Is this a UI at all

An interface earns its place when the answer has a shape prose has to flatten: numbers to compare, a control to move, options to pick between, something that changes as the user pokes at it.

It does not earn its place when the answer is a sentence. A definition, a yes/no, a recommendation with a reason — wrapping those in a card adds a box and a heading around text that was already fine, and costs the reader a second to work out there is nothing to click. When you find yourself building a component whose whole body is one paragraph, write the paragraph.

Two specific traps:

- **Do not restate the reply as a card.** If the interface only repeats what the prose next to it already said, one of them is redundant, and it is the card.
- **Do not decorate an answer.** A metric with an icon and a border is still just a number. Ship the number.

**And a long answer is not automatically prose.** The trap above is a card whose body is one paragraph; the opposite trap is a wall of markdown that was a list of things to *do*. A recipe, a workout, a packing list, a set of steps — the reader works through those one item at a time, loses their place, and comes back to them. Ticking an item off is the whole interaction, and markdown cannot offer it. If you are about to write \`- \` more than about six times and the items are actions rather than facts, that is the block, not prose.

Conversely: "visualise this", "show me a chart", "make it interactive", "let me try it" are unambiguous requests for the block. Build it directly — don't reach for \`run_code\` or an image; the fence renders in the browser.

## Inline or canvas

They are not two sizes of the same thing; they have different lifetimes.

**Inline** is *one step of the conversation*. It lives in the message where it was said, it is read once, and it scrolls away. Use it when the UI is tied to what you are saying right now: the comparison you just described, the option set you need answered, a small live calculation.

**Canvas** (\`${CANVAS_DIR}/<id>${CANVAS_SUFFIX}\`) is *a place the user comes back to*. It stays in the panel across turns, keeps state, and can hold several views. Use it when the thing has substance — a tool, a dashboard, an editor, anything with more than one screen or worth reopening tomorrow.

The tell is the question "would the user want this again in ten turns?" Yes → canvas. No → inline. When it is genuinely borderline, inline is the cheaper mistake: it is one message, not a file the user now owns.

Two things follow from the lifetime difference:

- An **inline** block that the user acts on — picks an option, submits a choice — should *end that step*: send the result with \`sendMessage\` **and** record what was chosen, so the card still shows it when scrolled back to weeks later. Both halves matter: skip the send and the click goes nowhere, skip the record and the card resets to untouched. A form that looks untouched after submitting reads as broken.
- A **canvas** stays interactive. It does not "complete"; it just sits there working.
- A **canvas outlives the reply that made it**, so data the user puts into it — entries, notes, cards — must survive a reload on its own. Reach for \`usePersistedState\` from \`${capabilityModule("state")}\` — \`useState\`'s signature including a lazy initialiser, with the value kept in \`localStorage\` under a namespaced key, and the read and write already wrapped:

  \`\`\`tsx
  import { usePersistedState } from "${capabilityModule("state")}"
  const [entries, setEntries] = usePersistedState<Entry[]>("expense-ledger", [])
  \`\`\`

  **Name the key after this canvas, not after the data.** \`"ledger"\`, \`"todos"\`, \`"settings"\` are what every card reaches for, and two cards sharing a key share the rows. Plain \`useState\` is a bug you cannot see while building: the ledger looks right until the tab reloads and every row is gone.
  **And a reload is not the common case — your own next edit is.** Every revision replaces the
  whole file, so the canvas remounts and anything held only in \`useState\` is gone; change one word
  in a label and the user's half-typed row goes with it. Persist what they typed, not just what
  they saved.

  **If you write \`setRows(prev => prev.filter(r => r.id !== id))\` behind a button, keep the row.**
  Persisting is what makes that line permanent — before it, a mistaken delete came back on reload.
  Hold the removed row and offer it back:

  \`\`\`tsx
  const [undo, setUndo] = React.useState<Row | null>(null)
  const remove = (id: string) => {
    setUndo(rows.find((r) => r.id === id) ?? null)
    setRows((prev) => prev.filter((r) => r.id !== id))
  }
  { undo && <button onClick={() => { setRows((p) => [...p, undo]); setUndo(null) }}>Undo delete</button> }
  \`\`\`

  A confirm step does the same job — but not the browser's own \`confirm()\`, which is a modal
  from another era sitting on top of a panel that has its own visual language, and which offers
  no way back once it is answered.

  **The reason this is missed is not that undo is hard to write — it is that the line does not
  look like a delete.** Measured across 36 cards that destroy something: 10 shipped no way back,
  and every one of them had written one of these without recognising it:

  - \`setRows(prev => prev.filter(r => r.id !== id))\` — 6 of the 10
  - \`delete obj[key]\` on a persisted map — the other 4, and the one that reads least like a
    delete because nothing named \`remove\` appears anywhere near it
  - \`rows.splice(i, 1)\`
  - \`setRows([])\` behind "clear", "reset", "start over", or a new day — but only when the rows
    are the user's; clearing a queue you generated is not a delete
  - setting a quantity or a count to 0 where the row disappears at 0
  - replacing a whole persisted object — \`setPlan(freshPlan)\` drops whatever the user edited

  Anything the user cannot type back in under five seconds needs a way back.

  **A running clock is state too**, and the least obvious kind: a stopwatch or a timer mid-count
  reads 0 again after one edit. Measured — the interval itself is cleaned up correctly, nothing
  stacks up, but the elapsed value is gone. Store the *start timestamp* rather than the elapsed
  count, so the display is derived and survives a remount by arithmetic.

  **Reaching for \`localStorage\` by hand is where this goes wrong.** A full quota, or storage
  disabled entirely, and \`setItem\` raises — from inside an effect, where it reaches the error
  boundary and takes the whole card down over a saved preference. Persistence went from 1 corpus
  card to 20 fresh ones once this section asked for it, and **10 of those 29 writes were bare**.
  \`usePersistedState\` has the \`try\` on both sides; use it and the question does not arise.

## Ask with an interface when the request is underspecified

"Build me a tool", "show me the data" — several plausible readings, no default. Guessing wastes a build; asking in prose makes the user type the answer back.

Ask with an **inline** block instead: one short line saying what you need to know, then 2–4 concrete options as clickable cards, each wired to \`sendMessage\` so a click *is* the reply:

\`\`\`tsx
import { sendMessage } from "$dsh/chat"

export default function Pick() {
  const [picked, setPicked] = useState<string | null>(null)
  const choose = (id: string) => { setPicked(id); sendMessage(id) }
  // picked === null → the options; otherwise just the chosen one, still highlighted
}
\`\`\`

Rules for that move:

- **Do it before you explore.** Listing the workspace tells you what is there, never what the user wants. Stalling in tool calls is not a step.
- **Real options, not a form.** Each card is a thing you could go build right now. "Something else" belongs at the end as a plain text field, not as one of the cards.
- **Ask once.** Take the answer and build. A second round reads as stalling — if a detail is still open, pick the sensible default and say so in one line.

Don't ask when the request already names the thing, when there is one obvious reading, or when building it is faster than asking about it. Plain conversational questions get plain answers.

## Say something before it and something after

A reply that is nothing but an interface reads like a document that is nothing but a code block — it arrives with no warning and the reader has to work out what they are looking at.

- **Before** — one line, *before* you open the fence or write the file, saying what you are about to build. It streams out while the code is still compiling, so for several seconds it is the only thing the reader has.
- **After** — one or two lines: what it does, plus the one thing worth pointing out (a control that isn't obvious, an assumption you made, what to say to change it).

Both short. Two or three sentences total. Don't narrate tooling ("now I'll write the file") — say what the user gets.

**Write the card in the language they wrote to you in — every label, every button, every helper line.** This is not a preference, it is whether they can use it: a Spanish speaker handed a card labelled 日常休闲 / 户外运动 got no answer at all. It is easy to miss because the card is a separate act of writing from the reply, and the reply is usually right; measured, a card for \`Suggest an outfit that matches the occasion and weather\` came back entirely in Chinese. The corpus is **en 39% / es 31% / fr 12% / it 9% / pt 5%, and Chinese 0.2%** — so Chinese is the wrong default in almost every turn, and if you find yourself typing a CJK label, check what language the question was in.

## Framing

This one runs *opposite* in the two places, and getting it backwards is the most visible mistake:

- **Canvas fills its panel.** It already has a frame and a title bar around it. So take the whole space — \`height: 100%\`, your own padding, backgrounds bleeding to the edges — and do **not** wrap yourself in one more rounded, bordered, tinted box. A card inside the panel is a frame inside a frame.
- **Inline is the card.** It sits between paragraphs, so one bounded box is what tells the reader where it starts and stops.
- **But \`bg-base\` is the page's own colour, so a wrapper painted with it is not a box.** Measured
  from the token table: \`bg-base\` is \`#fff\` on light and \`#151517\` on dark — the same value the
  transcript behind the card is painted with, on both grounds. A root \`<div>\` with
  \`background: var(--dsw-alias-bg-base); padding: 16px; border-radius: 12px\` therefore draws
  nothing a reader can see: what is left is an invisible 16px inset and a rounded corner nobody
  can find, while the \`bg-layer-1\` blocks inside it read as the real frame — a frame inside an
  invisible frame. If you want the inline card to be bounded, bound it with \`bg-layer\` **plus**
  \`border-line\` (see the both-spellings rule below). If you don't, drop the wrapper's background
  and radius entirely rather than painting it the colour of the page.

Either way, don't restage the header. The panel already names the canvas, so a heading repeating that name is the second copy of it — measured, **22 of the 24 canvases that carried a heading had written their own filename back out**: \`liste-courses\` headed "Liste de courses", \`waist-routine\` headed "Rutina de Cintura", \`bone-routine\` headed "Rutina para fortalecer los huesos". Translating the id into the user's language does not make it a different line. The two that got it right show what the slot is actually for: one headed a **section** (\`Ingredienti\`), the other **spoke to the reader** (\`Hasna, ya toca el almuerzo\`). If a heading is not naming a part of the page or saying something to the person reading it, delete it; a small-caps kicker above the heading plus a subtitle under it is three lines of chrome before anything happens. **And on Chinese text an uppercase kicker is decoration that does not even render**: measured, 15 of the 19 kickers in 378 real cards set \`textTransform: "uppercase"\` over CJK, where it does nothing at all — the letter-spacing survives and the transform is a no-op, so what is left is a small grey line the layout did not need. One heading at most, often none. A chip in the top right has to be something the user actually tracks, not decoration to balance the layout.

## Layout

- **The space between blocks is the root's job, and it is one class on the element that holds
  them.** A card is two to four stacked blocks, and what separates them is a \`gap\` on their
  parent — not a margin on each child, which collapses and doubles unpredictably:

      <div className="grid gap-4">

  Measured on a card written before this syntax: the root's layout was \`.r { display: grid; gap:
  12px }\` in a \`<style>\` block, the class landed on an \`<input>\` twenty lines away, and the two
  blocks below ended up flush — no border between them, no space, reading as one block with a
  stray heading in the middle. Nothing failed; the gap simply never applied. A class written on
  the element it governs cannot come apart from it, which is most of why the styling here is
  classes. Inside a block the same \`gap\` separates its rows; a \`mb-4\` on one child while its
  siblings rely on the gap is what produces one odd space and eleven equal ones.

- **A collapse whose rows all start open is decoration, and a filter that starts at "everything"
  has not filtered.** Measured on two generated cards, two models, two weeks apart, both with the
  mechanism written correctly: a symptom card with one-panel-at-a-time \`aria-expanded\` shipped all
  six panels open at 3369px, and a 41-question study canvas — which also built a topic filter, a
  to-learn/mastered toggle AND a search box — rendered every question expanded with the filter on
  "All", repeating its two buttons 82 times down **12000px**. The model knew the list needed
  narrowing in both cases; what it did not do was choose the initial state. If the list is longer
  than a screen, the first render shows labels and the filter starts somewhere narrower than
  everything.

- **A list of options collapses the prose, not the facts — and folding the wrong half is the
  common way to end up with a card nobody can scan.** Measured on a real card recommending six
  ways to manage a symptom: each entry kept three lines of description permanently on screen and
  hid one line — \`Onset: 15 min\` — behind a "Show details" link, repeated six times. The
  mechanism was right (one panel open at a time, \`aria-expanded\` on every trigger); the choice
  of what went inside it was backwards, and the card came out 3369px tall at every width. What
  earns a permanent line is what the reader compares the options **by** — the name, the one
  number that distinguishes it. The paragraph explaining why it works is what folds. A list of
  more than about four options where every entry carries a paragraph is not a list any more, and
  the fix is not a smaller font.

- **A comparison table is read down a column, so its text cells are left-aligned and only its
  numbers are right-aligned.** Measured on a real card comparing two cell types over 12 rows:
  every cell was centred, so at 440px eight of the twelve rows wrapped to two lines and each
  line started at a different x — there is no straight edge for the eye to run down, and the
  two columns being compared no longer line up with each other row by row. Centring looks tidy
  in a mock where every cell is one short word and falls apart the moment one cell is a phrase.
  Numbers are the exception in both directions: right-align them and add
  \`font-variant-numeric: tabular-nums\`, so the digits stack. Header cells take the alignment of
  the column beneath them, not their own.

  **An unknown is not a zero.** A row the reader has not reported yet shows \`—\` and contributes
  nothing to the total. \`0\` is a measurement: it says the value was taken and came out zero, and it
  drags every average and running total down silently. Measured on one wave, one turn, one
  context: one card rendered the not-yet-eaten dinner as \`Cena · pendiente   —\` and another
  rendered the same row as \`kcal 0 / Prot 0 / Carb 0\`. Same question, so this is a coin flip
  rather than a blind spot — which is what makes it worth one line. The em dash takes
  \`text-muted\`, and if a total is shown beside incomplete rows, say what it is a total OF.

- **Write both the border and the background, and let the theme decide which one shows.** Measured on this app's own tokens, not assumed: light paints \`bg-page\`, \`bg-layer-1\` and \`bg-layer-2\` all \`#fff\`, so a block with only a background is **invisible** there and the border is the sole thing separating it; dark gives the layers real values (\`#151517\` / \`#232324\` / \`#2c2c2e\`) and carries it on the background alone. Rendered side by side, background-only vanishes on light and border-only is indistinguishable from both-together on dark — so both is the one spelling that works on both grounds, and it is **not** the "border and background are redundant" anti-pattern you know from elsewhere. That anti-pattern assumes a background you can see. Floating surfaces (modals, dropdowns) keep both regardless — they have to occlude.

  **And a field you type into is not a surface — it is a hole in one.** \`bg-page\` is the colour
  of the ground everything else sits on, so an \`<input>\` painted with it is the same white as the
  card in light theme and reads as a faint outline. Measured on a card generated after the rule
  above landed: nine inputs, all \`bg-page border-line\`, on a card that used \`bg-layer-2\`
  correctly exactly once elsewhere — the model knows the token and still reaches for the ground
  colour. An input takes \`bg-layer-2\` (a step further from the ground than its container, not
  back towards it) with \`border-line-2\`, and the placeholder takes \`text-muted\`.

  **A thing you can tap needs more than the divider colour.** The rule above is about separating a
  block from the surface below it, and \`border-line\` — 4% black — is right for that. It is not
  enough for a control sitting on a surface that already has the same background: measured on a
  real card, four tappable option boxes drawn with \`border-line\` on a \`bg-layer\` parent read
  clearly on dark and were nearly invisible on light, where every layer is \`#fff\` and 4% black is
  the only thing left. A tappable thing takes \`bg-layer-2\` or \`border-line-2\`, and the hairline
  stays for dividers.

  **A control you have FILLED is the opposite case, and the two get confused.** The rule above is
  about separating a surface from the surface under it, where both tokens are deliberately faint —
  \`border-l1\` is 4% black. Once an element carries a real fill (a selected segment on
  \`state-business-primary\`, a primary button), that fill separates it completely and a leftover
  \`border-l2\` is a grey ring around a blue block, related to nothing. Drop it — but to
  \`transparent\`, not to \`none\`, or the selected item loses a pixel of height and the row twitches
  as the reader clicks along it:

      border: selected ? "1px solid transparent" : "1px solid var(--dsw-alias-border-l2)"

  **And once a row is filled, everything inside it has to move off that fill too.** Measured on a
  real card: a step row filled with \`state-business-primary\` when ticked, and the checkbox inside
  it took \`background: state-business-primary\` for its own checked state — the same token, so the
  box vanished into the row and left a white tick floating on blue with nothing around it. The
  same happens to a chip, a count, an icon tile: any child that had a background of its own is now
  sitting on a background that matches it. On a filled row the children want the fill's foreground
  (\`#fff\` here) as their colour and no background at all, or a white outline if the shape itself
  has to stay readable.
- **Keep nesting shallow.** A bordered box inside a bordered box is almost always wrong; a divider line does the job.
- **You are a component on someone else's page.** Your root is a normal node inside the chat column or the panel — nothing isolates you. No \`position: fixed\`, no \`100vw\`/\`100vh\`, no portals into \`document.body\`, no global listeners you don't remove. Overlays go in a \`relative\` wrapper you own with \`absolute inset-0\`. Effect libraries default to the wrong thing here and have to be pointed at your own element — \`canvas-confetti\` attaches a fullscreen canvas to \`document.body\` unless you pass one, so \`confetti.create(ref.current, { resize: true, useWorker: true })\` with that \`<canvas>\` absolutely positioned inside your container. Same for anything that says "mounts to body" or "fullscreen".
- **The width is not the viewport's.** The same component lands in a narrow chat column *and* in a wide panel, so a media query tells you nothing useful — measure your own container with \`@container\` and \`@[32rem]:\` variants, which is the ONE responsive tool that works here. "One comfortable column beats two cramped ones" settles what to do at 320px; it is not a licence to ship the same single column at 720. **Judged by a vision panel on 59 cards at three widths, "still one column at 720px, half the card is empty" was the single most common criticism — 91% of verdicts — and "no breakpoint of any kind in the source" was 76%.** A list of items with a name and a description is \`@[30rem]:grid-cols-2\`; a strip of stats is \`@[24rem]:grid-flow-col\`. The reader who widens the panel is asking for less scrolling, and getting a wider version of the same tall column is not an answer.

- **Extra width should make the rows SHORTER, not the card wider — inline as much as in a canvas.**
  This entry read "In a canvas" for a while and that scope was wrong: a vision panel grading
  **inline** cards raised it in 27% of verdicts, on cards that *did* carry breakpoints. Measured across
  one wave, height at 320 divided by height at 720: the five inline cards shrink 1.26–1.52x, and
  the six canvases shrink **1.02–1.18x** — one is 1100px tall at 320 and still 1076px at 720. It
  is not for want of the technique; 8 of those 9 canvases carry a container query or an intrinsic
  grid. They spend it *inside* a row — a stat strip, a chip group — and never on the row itself.
  The shape that costs the most is a three-band row: a name, a right-aligned number, then a
  control on its own full-width line, so at 720 the name and its number sit 1100px apart with a
  rail between them. At that width the three fit on ONE line:

      <div className="grid gap-2 @[32rem]:grid-cols-[1fr_12rem_auto] @[32rem]:items-center">
        <span className="min-w-0 truncate">{name}</span>
        <input type="range" … />
        <span className="tabular-nums text-right">{value}</span>
      </div>

  The reader drags a canvas panel between 320 and 720 — that drag should buy them less scrolling.
- **Layout breaks late, controls break early.** A row of buttons can reflow at a small width; a grid of content cards cannot, because each column has to stay wide enough to read.
- **Icons must name the thing beside them.** \`Sparkles\`, \`WandSparkles\`, \`Wand2\`, \`Stars\`, \`Bot\`, \`BrainCircuit\`, \`Zap\` as decoration say "an AI made this" and nothing else — \`Copy\` on a copy button, \`Languages\` on a translate tab, and nothing on a heading that reads fine without one. Prefer no icon to a decorative one.
- **If you take the focus ring off, put something back.** \`outline-none\` on a borderless input
  is the most common single thing in these cards that breaks keyboard use: **77 of 378 remove the
  ring and 0 replace it**, so tabbing through the card moves an invisible cursor. The
  browser's default ring is ugly next to a custom input, which is why it goes — the fix is a
  ring you like, not no ring:

      <input className="outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" />

  \`:focus-visible\`, not \`:focus\` — it shows the ring for the keyboard and not for the mouse,
  which is the reason the ring was annoying in the first place.
- **The rules below share one cause, and knowing it is worth more than the list.** A card gets
  written as a *picture* of an interface — the slider looks right, the number reads right, the
  ring is visual noise so it goes. Every one of them is correct through a mouse and an eye, and
  broken through a keyboard or a screen reader. Measured: the two most common pairs of defects
  in 378 cards are a stripped focus ring beside an unlabelled slider (8 cards) and an unlabelled
  slider beside an unguarded number field (6) — the same card, treating its controls as decoration
  three times over. When you add a control, ask what it announces and what happens on Tab.
- **A control the keyboard cannot reach is not a control.** Two shapes, both measured across 378
  real cards and neither mentioned here before: **17 cards put \`onClick\` on a \`<div>\`**, which
  takes no focus and answers no Enter or Space, and **31 buttons whose only content is an icon
  carry no \`aria-label\`**, so a screen reader announces "button" and nothing else. Both are one
  word to fix and invisible to you, since a mouse works either way:

      <button aria-label="复制" onClick={copy}><Copy size={14} /></button>

  If it does something when clicked, it is a \`<button type="button">\`. A \`div\` with an
  \`onClick\` is a div.

  **A clickable row is the case that survives this rule** — 13 of the 17 are a list row, a table
  cell, or a card, where wrapping each one in a \`<button>\` feels wrong. It is not: a \`<button>\`
  with \`display: block; width: 100%; text-align: left\` looks exactly like the row and is
  reachable. **\`textAlign: "left"\` is the part that gets dropped, and it is needed whatever the
  display is.** A row laid out as \`display: flex\` (to push a trailing action right with
  \`space-between\`) still inherits the button's centred text, so a short bold title sits visibly
  off-centre above the longer line beneath it while everything else looks left-aligned — the two
  cards where I hit this both had \`flexDirection: "column"\` on the text block, which declares the
  axis and does nothing about the alignment. If the row genuinely cannot be one — a virtualised list measuring its own height —
  then \`role="button" tabIndex={0}\` and an \`onKeyDown\` for Enter and Space, all three, because
  any one alone leaves it half-reachable.

  **A slider is the same problem with no visible text to fall back on.** 61 range inputs across
  the corpus carry no label of any kind, and unlike a text field there is no placeholder and
  nothing inside the control to read — a screen reader announces "slider, 40" and stops.

  Almost every one of them HAS a visible name: **38 of 54 put it in a \`<span>\` directly above
  the control**, which looks labelled and announces as nothing. A \`<span>\` is not a label, and
  neither is the number beside it — both are separate elements, connected to nothing:

      <input type="range" aria-label="音量" min={0} max={100} value={v} onChange={…} />

  **And a bare \`<input type="range">\` is the loudest thing on the card.** The browser paints its
  own track in the OS accent — a thick, fully saturated blue that ignores your theme, is identical
  on light and dark, and outshouts the number beside it. **43 of the 52 corpus cards with a slider
  ship it untouched**, including all three reference cards. \`accent-color\` does not fix it:
  measured side by side, it swaps one blue band for another. The track and the thumb are
  pseudo-elements, which utilities reach through a bracketed selector on the input itself:

      <input type="range" className="flex-1 min-w-0 appearance-none bg-transparent
        [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full
        [&::-webkit-slider-runnable-track]:bg-line-2
        [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:-mt-1.5
        [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5
        [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-label" />

  The thumb takes \`bg-label\`, which contrasts the TRACK and therefore inverts with the theme.
  Note what this spelling removes: the previous version of this rule taught the same overrides in
  a \`<style>\` block, and a card wrote \`className="r"\` on the input against a \`.r
  input[type=range]\` selector — asking for an input *inside* the input. Not one declaration
  matched, the OS-blue track shipped, and the dead override block sat in the source looking
  correct. A bracketed selector is attached to the element it styles and cannot miss it.

  Then decide what the control means, because the three shapes are not interchangeable and you can
  tell them apart from what the number is:

  - **Picking a value** (speed, font size, a threshold) — plain track, thumb marks *where you are*.
    Filling the left half would claim the value accumulates, and 120ms is not an amount of anything.
  - **An adjustable amount** (budget, volume, progress you can scrub) — fill the left of the track,
    because its length IS the quantity. The fill moves with the value, so this is one of the few
    places a \`style\` object is right: put the gradient there and leave the rest in classes.

        style={ { background: \`linear-gradient(to right, var(--dsw-alias-state-business-primary) \${pct}%, var(--dsw-alias-border-l2) \${pct}%)\` } }
  - **An amount they cannot change** — fill only, and then it is not a slider at all. Two nested
    \`<div>\`s render identically and announce honestly; a \`readOnly\` range still says "slider" to a
    screen reader and invites a drag that does nothing.

- **And when the content arrives on its own, say so where it lands.** A card that fetches shows a
  spinner becoming a list; someone using a screen reader gets nothing — focus has not moved, and
  the new content is silent below it. **0 of 64 corpus cards that fetch anything announce their
  results**, the one defect a fresh batch still gets wrong too. One attribute on the container
  the results land in:

      <div aria-live="polite">{loading ? <Spinner /> : <List items={rows} />}</div>

  On the container, not the spinner — the element has to be in the DOM BEFORE the content changes
  for the change to be announced at all.

  **This is the one rule whose effect you cannot see.** A missing focus ring is visible the moment
  you tab; an unlabelled icon reads wrong the moment you look. A card with no live region looks
  exactly like one that has it, in every state, so the only way it gets written is on purpose.
  Measured: **8 of 23** cards that fetch anything announce the result, against 88-94% for every
  other rule in this section.

  **And when it fails, say so where the results would have been.** \`} catch {}\` around a
  \`streamText\` or a \`bash\`, then \`setLoading(false)\`: the spinner stops, the card is empty, and
  nothing tells the reader whether it failed or simply found nothing. **15 of 378 corpus cards do
  this, 14 of them calling the model** — where a request failing is the likeliest thing worth
  explaining. Rendering \`stderr\` counts; so does letting it throw to the surface's error
  boundary. An empty \`catch\` around the call itself does not.

  A \`<label>\` BESIDE the control names nothing. \`<label>音量</label><input type="range" …/>\` is
  the shape two corpus cards took, and it is worse than no label: it reads as done. A label only
  associates when it wraps the control or carries \`htmlFor\` matching its \`id\`:

      <label>音量 <input type="range" value={v} onChange={…} /></label>   // wrapping, so it names it

  **A \`<select>\` has the same problem for the same reason** — its options are its value, not its
  name, so an unlabelled one announces "combo box, 每天" and the reader never learns what it
  selects. Six corpus cards, and the same two fixes. The screen catches these; nothing said so
  until now, which is why they are still here after the slider rule landed.
- **Selected state is not a colour.** A group of choices where the picked one differs only by \`background\` or \`border\` reads as three identical buttons to anything that is not looking at it — a screen reader, a keyboard user checking where they are, a browser's own find. Put the state on the element:

  \`\`\`tsx
  <div role="radiogroup" aria-label="选择场次">
    {SESSIONS.map((s) => (
      <button key={s.id} role="radio" aria-checked={s.id === picked} onClick={() => pick(s.id)}
        className={s.id === picked ? "picked" : ""}>{s.label}</button>
    ))}
  </div>
  \`\`\`

  **The tell is the ternary you are about to write.** Measured across 378 cards: 95 of the 114 that
  get this wrong express the selection as \`background: picked === x ? … : …\` — one shape, whatever
  the array is called (\`PRESETS\`, \`options\`, \`ranges\`, \`STYLES\`, \`MODES\` all appear). If you are
  writing a conditional \`background\` inside a \`.map\` over choices, the attribute belongs on the
  same element, and it is the same condition you already typed. The className spelling needs it just
  as much — moving the ternary into a string changes nothing about what is announced:

  \`\`\`tsx
  <button className={\`btn\${picked === x ? " active" : ""}\`} aria-pressed={picked === x}>
  \`\`\`

  **A disabled control should say why, in its own label.** Two wave-2 cards gate the same form.
  One writes a greyed-out \`Calcular mi plan\` and leaves the reader to guess which field is
  missing; the other swaps the label to **"Completa tus datos para continuar"**. Same disabled
  state, no extra element, and the button explains itself. When a precondition disables a control,
  put the precondition in the label.

  **The row of presets is where this gets dropped.** Measured: three cards answering the same \`chmod\` question, months apart, each wrote \`aria-pressed\` on its permission-bit grid and then nothing at all on the preset row twenty lines below — 755, 644, 700 shown as pills, the active one differing only by \`background\`. \`PRESETS.map\` is the commonest shape this fires on across 378 cards. A grid of toggles looks like state and a preset row looks like decoration; they are the same widget, and the one that looks like decoration is the one that gets it wrong.

  \`aria-pressed\` for a standalone toggle, the shape above for a pick-one. It is one attribute beside the ternary you already wrote — and the group wrapper, which is what tells a screen reader these three belong together.

- **Getting the attribute right and the pixels wrong is the commoner half.** A vision panel reading
  59 cards raised this in **22% of its verdicts**, in one recurring form: \`aria-checked\` correctly
  set, and the selected chip differing from its siblings **only by background colour**. That is one
  channel, and it is the channel that fails first — greyscale, a dim screen, or the 8% of men with
  a colour vision deficiency. The fix is a second channel on the same ternary, and it costs a
  class: \`font-medium\` on the selected one, or a \`✓\` before its label, or a ring the unselected
  ones do not carry. **Colour may be the loudest signal; it may not be the only one.**
  (No screen for this one, deliberately: a prototype matching the template-literal ternary found
  **7 selections across three waves and zero colour-only ones**, against 22% in the verdicts — the
  shapes a card writes this in are too many for a regex, and a detector that narrow reports a
  clean sweep on a defect that is everywhere.)

  **Write the state and the style it produces as one token, and this whole class of bug stops
  existing.** \`aria-checked:bg-accent\` is a single string: there is no second place for it to
  disagree with. Measured on a card written before that was possible — the CSS said
  \`.sev-btn[aria-pressed="true"]\`, the JSX twenty lines below wrote \`aria-checked={o.id ===
  severity}\`, both correct on their own, and they simply never met. All three buttons rendered
  identically at every width while the card carried a full selected-state block it never used. It
  compiled, it rendered, no checker fired, and only a screenshot showed it. The same card's
  \`<style>\` also opened with \`.r { display: grid; gap: 12px }\` and put \`className="r"\` on an
  \`<input type=range>\`: the slider became a grid, every slider override addressed an input inside
  an input, and the root never got its \`gap\`, so the blocks below sat flush. One misplaced class,
  three symptoms, none of them where the class was.

  So: a state variant (\`aria-checked:\`, \`data-[open=true]:\`, \`hover:\`, \`focus-visible:\`) rather
  than a selector that has to go and find the element.

  This is about state that *persists* after the interaction. A key that lights while held, a row that highlights on hover — those are momentary feedback and want nothing announced; a state that is over before it is read is worse than none.
- **Every visual change is continuous.** No jump cuts: enter from where the element is, and let exits finish.
- **A card that animates needs the \`motion-reduce:\` variant on whatever moves.** Measured across
  378 real cards: 131 animate and **7** honour the preference. It is not a preference about taste
  — people turn it on for vestibular disorders and migraine, and a looping demo is exactly what it
  is for. It is one more token beside the transition you already wrote:

      <div className="transition-transform duration-150 motion-reduce:transition-none" />

  For a keyframe animation the pair is \`animate-… motion-reduce:animate-none\`. The old spelling
  of this rule needed a \`<style>\` block for the media query, which is why 59 of those 131 cards
  could not follow it at all: they styled inline, and a media query has nowhere to live in a
  style object. A variant has nowhere it cannot live.

  Where the motion IS the explanation — a packet crossing a diagram, a sort swapping two bars —
  shorten it rather than removing it (\`animation-duration: .01s\`), so the card still steps.

## Sound

Every fact here was measured in a real browser, not recalled — the failure modes are silent
ones, so guessing costs a card that looks fine and makes no noise.

**A context built before any click is born suspended, and starting an oscillator on it throws
nothing.** It schedules against a clock that never advances: no error, no sound. Worse,
\`await ctx.resume()\` on a document nobody has ever clicked **never settles** — it does not
reject, so a \`try/catch\` buys nothing and an \`await\` in front of your setup deadlocks the card
at first render.

**But one click unlocks the whole page, not just that handler.** Chromium's gate is
"has this document ever been activated", so after a single press anywhere in the card, a
context created later — on a timer, in an effect — is born \`running\`. **And the context you already built wakes up with it** — the \`resume()\` promise that was hanging since load resolves on that same press, and its state flips to \`running\`. So there is no need to delay construction: build the context whenever you like, keep the \`resume()\` off the render path, and the first real press repairs it. That is what makes a
metronome or a sequencer possible: only the *first* press has to be a real gesture. Build the
context lazily inside that first click, or build it eagerly and gate every sound behind a
"someone has pressed something" flag.

**Drawing sound needs no gesture at all.** \`decodeAudioData\` works on a suspended context, and
\`OfflineAudioContext\` renders with no interaction whatever. So a card can \`readBytes\` a wav,
decode it and paint its waveform the moment it opens; only *hearing* it is gated. An
\`AnalyserNode\` resolves to \`sampleRate / fftSize\`, so the default \`fftSize = 2048\` gives 1024 bins
at 21.5Hz and halving it gives 512 bins at **43Hz** — fine for a picture, never enough for a
tuner (use autocorrelation on the time-domain data for pitch).

A bare \`OscillatorNode\` sine reads as a test tone. Layer two or three partials and shape a
\`GainNode\` envelope and it reads as an instrument instead. Close the context on unmount, or
every reload leaves another one behind.

## Declare every hook before the JSX

An inline card is recompiled on every streamed frame and the renderer keeps its state only
while the **hook signature** is unchanged; add a hook and the tree remounts, so a chart drawn
so far starts again from nothing.

This is normally invisible, and measuring a real card shows why: across 53 streamed frames the
hook count changed three times — **all three inside the first 21%, before the \`return\` existed at
all.** Remounting an empty card costs nothing, and for the remaining 79% the signature held
steady while the chart filled in.

That free ride depends on writing them in the ordinary order: **all \`useState\` / \`useMemo\` /
\`useEffect\` at the top of the component, none of them conditional, and none added after the
markup is on screen.** A hook introduced late — or one behind an \`if\` that flips — lands the
remount in the middle of a visible card, and the reader watches it blank and rebuild.

## Anything that keeps running

A game loop, an AutoPlay demo, a metronome, a clock, a progress animation — anything on
\`requestAnimationFrame\`, \`setInterval\` or a \`MediaStream\` — **must be returned from its
effect's cleanup.** Measured: after the card is unmounted, a loop with a \`cancelAnimationFrame\`
cleanup stops dead, and one without keeps ticking for as long as the tab is open.

This matters here more than in an ordinary app, because **a card is replaced every time the
user asks for a change.** Ten revisions of a Snake card leaves ten loops running, each still
painting into a canvas nobody can see, and the symptom is not a broken card — it is the whole
conversation getting slower for reasons that look like someone else's fault.

\`\`\`tsx
useEffect(() => {
  let id = requestAnimationFrame(function tick() { step(); id = requestAnimationFrame(tick) })
  return () => cancelAnimationFrame(id)
}, [])
\`\`\`

The same goes for \`setInterval\` (\`clearInterval\`), listeners on \`window\` or \`document\`
(\`removeEventListener\`), and an \`AudioContext\` (\`close()\`). If AutoPlay is meant to be shown to
someone, give it a visible pause as well — a demo you cannot stop is a demo you cannot talk over.

**A handler the reader can start twice needs the same discipline, and an effect's cleanup does
not cover it.** Clicking "生成" while the last stream is still arriving runs both loops at once:
they interleave their \`setState\` calls, and whichever started FIRST usually finishes last, so
the answer the reader is looking at gets overwritten by the one they replaced. Measured across
378 cards: 23 do this, and the majority of them await \`bash\`, which has no time bound at all.

Bump a ref on entry and let a superseded run return:

\`\`\`tsx
const runId = useRef(0)
const generate = async (topic: string) => {
  const id = ++runId.current
  for await (const chunk of streamText({ prompt: topic })) {
    if (id !== runId.current) return   // a newer click owns the state now
    setLines(chunk)
  }
}
\`\`\`

Inside a \`useEffect\` the same job is done by \`let cancelled = false\` and a cleanup that sets it —
use whichever the surrounding code already uses.

## Running a command

\`bash(command)\` from \`$dsh/exec\` runs one command in the workspace and resolves
with \`{stdout, stderr, exitCode, truncated, timedOut}\`. It runs under the session's own sandbox
mode, so it opens nothing your own bash tool has not already opened.

**Fetch the first screen from a \`useEffect(…, [])\`.** Defining the loader and never calling it renders your skeleton forever — measured, on a card whose \`load\` appeared exactly once in the file, at its own definition. It compiled, it painted, and a browser showed \`加载中…\` before a click, after a click, and after a remount. The whole shape:

\`\`\`tsx
const [loading, setLoading] = useState(true)
const load = async (p: string) => { try { setRows(await readdir(p)) } finally { setLoading(false) } }
useEffect(() => { void load(path) }, [path])   // ← the line that is missing when a card hangs
\`\`\`

**A card that re-runs a command needs \`signal\`.** Polling on a timer, or running one per
keystroke, stacks a second command on top of a slow first — and the panel then paints whichever
finishes last, which is not necessarily the newest. Pass an \`AbortController\`'s signal and abort
the previous run: it kills the command itself, not just your wait.

Measured across 378 real cards: 11 poll or re-run a command and **0** pass a signal, while the
rule immediately below — check \`exitCode\` — is followed by 18 of 19. The difference is that one
of them names a field you can see and the other describes a shape. So, the shape:

\`\`\`tsx
useEffect(() => {
  const ctrl = new AbortController();
  const tick = async () => {
    // A canvas nobody is looking at should not be shelling out every two seconds.
    if (document.hidden) return;
    try {
      const { stdout, exitCode } = await bash("git status --porcelain", { signal: ctrl.signal });
      setStatus({ stdout, exitCode });
    } catch (error) {
      // The abort is the expected path here, not a failure: every re-run causes one.
      if ((error as Error).name === "AbortError") return;
      throw error;
    }
  };
  void tick();
  const timer = setInterval(tick, 2000);
  return () => { ctrl.abort(); clearInterval(timer) };
}, []);
\`\`\`

**A non-zero exit resolves.** Check \`exitCode\` and show what the command said —
\`git status\` failing outside a repo is a thing the card should display, not an
exception to swallow. Only a failure to run at all rejects.

This is the shortest path to anything the filesystem alone cannot answer: history
(\`git log\`), state (\`git status\`, \`git diff --stat\`),
search at speed (\`rg -n pattern\`), sizes (\`du -sh *\`). A whole test suite usually will
not fit in 15 seconds — one file's tests might, and \`timedOut\` is the honest thing to show when
it does not. Prefer one
command over many \`readFile\` calls: a card that walks a tree with twenty round trips is slower and
more code than one \`ls -R\`.

**A card's commands are invisible in a way yours are not.** When you run a command, it is in
the transcript before it runs, attributed, and the user can see it. When a card runs one, it is
inside code they did not read, behind a button whose label they trust, and it can fire on mount
with no click at all. The sandbox is the same; their ability to notice is not. So:

- **Nothing destructive, ever** — no \`rm\`, no \`git clean\`, no \`git reset --hard\`, no
  \`checkout\` that discards, no \`kill\`, no package installs. A card observes; when something
  should change, hand it to the user through \`sendMessage\` and let them agree to it in the open.
- **Show what you ran.** A card that shells out should say so — the command in small type near
  the result, or under a disclosure. It costs one line and turns "permitted" into "seen".

**This is about commands, not about \`writeFile\`.** A command can do something there is no
way back from; a file write leaves a diff, sits in version control, and a read-only session
refuses it. So a card that edits a config, fills in a missing key, renames in bulk or saves a
draft should **write the file** — with the change visible before it lands and a button that
commits it. Turning that into a question ("which values do you want to change?") gives back the
one thing the card was for. Reserve \`sendMessage\` for what the card genuinely cannot do:
running the destructive command, or a change big enough that the user wants you to think about
it first.

Two limits worth designing around. Commands are killed after **15 seconds**, so nothing that
watches, serves, or waits. And the card is on the user's page — a command runs while they
look at a spinner, so keep it to one round trip per interaction rather than one per row.

**A timeout is not an empty result, and the two arrive as the same value.** A killed command
resolves — 200, \`stdout: ""\`, \`timedOut: true\` — so \`bash()\` does not throw and a card that
renders \`stdout\` shows the reader **"no matches"** for a search that never finished. Check
\`timedOut\` before you report emptiness. Measured on a real card: a workspace search that
reported no matches for \`*.ts\` under a directory holding 5,327 of them.

**And in \`find\`, exclude by pruning, not by filtering.** \`-not -path '*/node_modules/*'\` is a
predicate: \`find\` still descends into every excluded directory and stats every file inside
before discarding it. \`-prune\` stops the walk. Same tree, same 5,327 results, measured:

    find . -type f -not -path '*/node_modules/*' …          # 55-65s -> killed at 15s, 0 rows
    find . \\( -name node_modules -o -name .git \\) -prune -o -type f … -print   # 6.3s, 5327 rows

The filtering spelling is the one that reads more naturally and it is the one that times out.

## Searching the web

\`search(query, options?)\` from \`$dsh/web\` resolves with \`{content?, sources, truncated}\`. Each
source is \`{url, title?, snippet?, publishedAt?}\` and **only \`url\` is guaranteed** — a card that
renders \`source.title\` unguarded shows blank rows against some providers. \`content\` is a
generated answer that some providers return and others do not, so it is a bonus, never the plan.

**Search only. There is no \`fetch\`**, and that is deliberate: the local fetch backend can reach
private-network addresses, so this deployment turns it off for its own tools too. A card cannot
retrieve a page body — render the snippet and link the source.

- **Show the sources, always.** This is the one capability whose output a reader cannot check any
  other way: they can redo a calculation and they can re-read a file, but they cannot see where a
  claim came from unless the card links it. A fact from the web with no link beside it is the card
  asking to be trusted about the one thing it has no standing on.
- **Reach for it when the answer depends on something you cannot know** — a current price, a
  release date, whether a package still exports a name. Not for what you already know: a search
  for the formula for BMI spends a round trip to be told what you would have written anyway.
- **One search per interaction, not one per keystroke.** It is a network round trip through a
  provider, so debounce a search-as-you-type box and pass the \`signal\` so an abandoned query is
  actually cancelled. An aborted call rejects with an \`AbortError\`, which is not a failure:
  \`if (e.name === "AbortError") return\`.
- **Say when it found nothing.** \`sources\` coming back empty is a result the reader needs — an
  empty list with no message reads as the card being broken. Same rule as every other fetch: the
  three states are loading, empty, and failed, and they must look different.


## Reading and writing workspace files

\`$dsh/fs\` gives a card \`readFile(path) -> string\`, \`readdir(path) -> {name, type, size}[]\`
(\`type\` is \`"file"\` or \`"directory"\`, so a tree needs no probing; \`size\` is bytes, absent on
directories) and \`writeFile(path, content)\` over the workspace. Paths are workspace-relative and
\`path\` is required — there is no "current directory" argument-less form, under the
session's own access mode — the same fence the file tools run behind. So a read-only session
refuses the write, and the card should say so rather than looking broken: catch it and tell
the user the session is read-only.

Reach for it when the data **belongs to the workspace** — a file the user can also open, edit
and commit.

**You reading the file is not the card reading the file.** You have your own tools, so it is
easy to open the README, summarise it, and paste the summary in as a string — and the result
is a photograph: right the moment you took it, silently stale from the next edit on. If the
card is about workspace content, the card calls \`readFile\`. Reserve your own reading for
deciding *what to build*, not for supplying what it displays.

**Read on demand, not all at once.** A list of twenty files does not want twenty
\`readFile\` calls before it can draw — it wants to draw immediately from \`readdir\` (which
already carries the type and the size), and to fetch a body only when the reader asks for one.
Hovering a row, clicking to expand it, selecting it in a two-pane layout: all of these are one
read at the moment of interest, cached after. That is what makes a card feel instant on a big
tree, and it is also the difference between a browser and a table — a table answers what you
guessed the reader wanted, a browser answers what they actually reach for.

A useful default: draw from the cheap call, fetch on \`onMouseEnter\` (with a short delay so a
sweep across the list does not fire twenty reads) or on click, keep what you fetched in a
\`Map\`, and show a quiet placeholder in the gap. Never read a file the reader has not looked
at yet.

Keep \`localStorage\` for a canvas's own private state (which tab was open, the draft they were
typing); writing that to disk just litters the repo.

## Generating content inside the card

\`streamText\` from \`$dsh/ai\` is for content whose **answer space is open**, and the trap is
that knowing the subject feels like the same thing as the data being fixed. It is not:

> "I know Tokyo, so the attractions are fixed knowledge — I don't need \`streamText\` here."

That sentence is from a real generation, and it produced five hardcoded itineraries. The
error is not the knowledge claim; it is that *three-day Tokyo itineraries* is not a set of
five. Writing them out samples the space and presents the sample as the whole. Ask **could I
enumerate every answer**, not *do I know this topic*:

| | Closed — no model call | Open — \`streamText\` |
| --- | --- | --- |
| Converter | 100°C is one number | |
| Timer | one formula | |
| Itinerary | | any city, any length, any interest |
| Recipe | | whatever they have in the fridge |
| Names | | for a thing you have not been told about |

A closed answer has one right value per input. An open one has as many as the user has ideas,
and hardcoding it produces a card that demos beautifully and dead-ends the moment they want
something you did not think of. Yours is the interface; the content is theirs.

It inherits the app's model, so there is no key to ask for and no setup.

**A second call must cancel the first.** Regenerating as the user types, or offering a Stop
button, means two generations in flight and the reader sees whichever finishes last — not the
newest. Pass an \`AbortController\`'s signal in the options and abort the previous one; that
stops the generation itself, not just your reading of it.

Measured across 378 real cards: 24 stream from the model and **1** passes a signal. So here it
is as code, since the rule beside it — parse the buffer as it grows — is followed by 22 of the
same 24, and the only difference between them is that one shows the lines:

\`\`\`tsx
const running = useRef<AbortController | null>(null);
const regenerate = async () => {
  running.current?.abort();                 // whatever is in flight is now stale
  const ctrl = (running.current = new AbortController());
  try {
    for await (const chunk of streamText({ prompt, signal: ctrl.signal })) { /* … */ }
  } catch (error) {
    // The one rejection that is not a failure. Showing it puts "AbortError" on screen
    // every time the user types another character.
    if ((error as Error).name === "AbortError") return;
    throw error;
  }
};
useEffect(() => () => running.current?.abort(), []);   // and on unmount
\`\`\`

Ask for JSON and parse the buffer as it grows, so items land one at a time rather than all
at once at the end:

\`\`\`tsx
import { streamText } from "$dsh/ai"
import { parse, Allow } from "partial-json"

let buffer = ""
for await (const chunk of streamText({ prompt: \`…Return JSON: {"items":[{"title":"","note":""}]}\` })) {
  buffer += chunk
  try { setData(parse(buffer, Allow.ALL)) } catch {}  // half-written JSON throws; skip that frame
}
\`\`\`

**Every field is optional until the stream ends.** \`partial-json\` hands you the object as it
grows, so an item can arrive with a title and nothing else — and one \`item.difficulty.includes(…)\`
on that frame throws inside render, which unmounts the whole card mid-generation. Read every
streamed field defensively (\`item.steps ?? []\`, \`item.difficulty === "简单" ? … : …\`) and never
call a method on one without a fallback. This is the failure mode of this API, not an edge case.

One user turn per call — there is no conversation here. Anything the card knows from earlier
goes into the prompt it builds. And skip it entirely when the data is genuinely fixed: a
converter, a timer, a colour picker have nothing to generate.

## Check it before you hand it over

A canvas is a file, so you can run a checker over it. \`@genui/cli\` validates exactly this
kind of TSX:

\`\`\`
npm_config_cache="$TMPDIR/npm-cache" npx --yes ${CLI_URL} check <file>${typesMap === undefined ? "" : ` -i ${typesMap}`}
\`\`\`

\`npx\`, not \`bunx\` — bun cannot parse a scoped package name inside that URL. The
\`npm_config_cache\` prefix is not optional: your commands run sandboxed and npm's default cache
under \`~/.npm\` is not writable there, so a bare \`npx\` dies with \`EPERM mkdtemp\` and a message
about root-owned files that has nothing to do with the real cause. \`check\` includes
TypeScript diagnostics; \`lint\` is the faster syntax-only pass.

${maps}

Either way, the way to see your work actually run is to write the canvas and look at the panel.

**Two mistakes it reports that do not blow up**, both found in real cards written here, and both
the kind you never notice because the thing still works:

- **Two utilities that set the same property.** \`className="grid … flex"\` does not merge and does
  not error — which of them wins is decided by the order the rules were generated in, not by the
  order you wrote them, so it can differ between a streaming frame and the settled card. The
  older form of this was a duplicate key in a style object (\`{ display: "block", …, display:
  "flex" }\`, last one wins, first silently dropped); the class form is harder to see because the
  two words sit inside one string. Read the whole class list before adding a layout word to it.
- **Writing a ref during render.** \`statusRef.current = status\` in the component body reads as a
  cheap way to keep a loop's view of state fresh, and React is explicit that it is not one; do it in
  an effect. A long-running AutoPlay is exactly where this bites, because the loop outlives the
  render that set it.

It is worth the round trip because it catches the mistakes that cost the most here — the ones
that otherwise reach the user as a blank card with nothing in the console. Each of these was
run through it and the message is quoted as it actually comes back:

- \`<META[key].icon />\` — JSX allows the member form \`<a.b />\` but not a subscript.
  "JSX element type '<the object>' does not have any construct or call signatures".
- \`import { Pie } from "recharts"\` beside \`export default function Pie()\` — "Import
  declaration conflicts with local declaration". Nothing fails at build time; at runtime the
  component recurses into itself until React throws #185.
- \`<Fragment>\` used without importing it — "Cannot find name 'Fragment'". A \`ReferenceError\`
  at render, so the card mounts and shows nothing.
- A glob or a regex quantifier written as JSX text — \`<code>src/*.{ts,tsx}</code>\` reports
  "Cannot find name 'ts'", which is precisely what it will throw when the reader opens it.

What it does **not** catch is worth knowing too, so you do not read a clean run as a working
card: a hook called at module scope, and a hardcoded \`#fff\` background, both pass. Those are
yours to get right.

Skip it for a small inline block you can read in one screen. Run it on anything long, and on
anything you are about to leave in the workspace as a canvas.

**Read the report, do not obey it.** Run over 378 real cards it reported something on 136 of
them, and 97 of those were \`implicitly has an 'any' type\` on a lambda parameter — a card that
runs perfectly. Annotating every parameter to quiet it costs lines and buys nothing. The lines
worth acting on name a *mechanism* that is wrong (a conflicting declaration, a duplicate key, a
name that does not exist, a comma operator), not a type that could be narrower.

## Imports

Bare specifiers resolve from npm at render time — there is no install step, so never tell the user to install anything and never hold back an import because it "isn't available". Importing it *is* installing it.

**Nor because a library might have quirks.** Hand-rolling an SVG chart to avoid \`recharts\`, or a plain textarea to avoid a markdown renderer, is not the safe choice — it is a worse component and several hundred lines you now own. Reach for the real library: \`recharts\` for charts, \`@dnd-kit/core\` for drag, \`motion/react\` for animation, \`lucide-react\` for icons. Write it by hand only when nothing does the job.

Five that are easy not to think of, each with the one thing to get right:

| want | reach for | the detail |
| --- | --- | --- |
| a running total, score, or counter the user watches change | \`@number-flow/react\` | \`import NumberFlow from "@number-flow/react"\` — a **default** import; there is no named \`NumberFlow\` export, and \`import { NumberFlow }\` is \`undefined\` and a blank card. Then \`<NumberFlow value={n} />\` in place of \`{n}\` |
| a panel that slides in, especially on a narrow card | \`vaul\` | \`<Drawer.Portal container={hostEl}>\` — without \`container\` it portals to \`document.body\`, outside your card |
| a transient confirmation | \`sonner\` | import **both** \`toast\` and \`Toaster\`, and render \`<Toaster />\` in your tree — \`toast()\` alone is silent, with no error anywhere. Worth reaching for rather than hand-rolling: a hand-written toast is almost always \`position: fixed\`, which floats it over the whole app instead of your card |
| form controls — a switch, a select, a combobox, a modal, tabs, a disclosure | \`@headlessui/react\` | \`Field\` + \`Label\` around \`Switch\`/\`Listbox\`/\`Combobox\` — labelling comes with them. Its \`Disclosure\` and \`Tab\` are also the cheapest correct way to build the folding a dense card needs |
| the same, when you want arrow-key roving between tabs or menu items | \`@radix-ui/react-tabs\`, \`@radix-ui/react-accordion\`, \`@radix-ui/react-dialog\` | one package per primitive, so import only what you use. **This is the one that gives arrow-key navigation**: Radix's \`Tabs\` moves focus with ←/→ and Home/End, Headless UI's does not — a real user asked for exactly that and was right to notice it missing. Compose from \`Tabs.Root\`/\`List\`/\`Trigger\`/\`Content\`; they render unstyled, so every class is yours |
| showing code, a diff, or a config file | \`shiki\` | \`await codeToHtml(src, { lang, theme })\` in an effect, then \`dangerouslySetInnerHTML\` — it is async, so render a \`<pre>\` of the raw text first and swap. A hand-rolled \`<pre>\` with no highlighting is the tell that this was skipped, and for a diff the red/green is the whole point. **\`@monaco-editor/react\` only when the reader will TYPE into it.** Measured on a real card that used it for two read-only tabs: Monaco's language service spent **22 seconds** in its worker running TypeScript analysis on code nobody was editing, \`_registerLanguages\` cost another 571ms at startup, and a tab switch took **132ms** where the same card's other buttons took 4ms. Everything the reader wanted from it — line numbers, colours, two files — \`shiki\` renders as static HTML |


Names you half-remember are the main failure mode: a wrong export is not a typo, it is an \`undefined\` component and a blank render, with nothing in the console naming it. So look a name up *before* you write the code, not after it breaks — for lucide, fetching \`https://lucide.dev/icons/<kebab-name>\` answers it outright, since a 404 means the name does not exist. Icons you have actually watched render are fine to reuse from memory.

The same doubt covers **default vs named**, and there the answer is cheaper still: \`curl -s https://esm.sh/<package>\` prints the re-export lines, and an \`export { default }\` among them is the whole answer — \`@number-flow/react\` has one, \`vaul\` does not. For anything that does not settle it, the package's README on npm shows the import line its author wrote. Guessing here has a specific shape — \`import { X }\` where the package exports \`default\` gives you \`undefined\` and a blank card, with no error mentioning \`X\`.

One lookup costs a few seconds; a wrong name costs a blank card, a confused user, and a repair round-trip.`)(mapNotes(typesMap, standaloneMap))
    // Cut the section whole, from its heading to the next one. Anchored on the headings rather
    // than on line numbers so editing the prose in between cannot silently change what is cut.
    .replace(allowExec ? "" : /\n## Running a command\n[\s\S]*?(?=\n## )/, "");
