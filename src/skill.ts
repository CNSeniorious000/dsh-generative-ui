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

/** The checker, from pkg.pr.new: @genui/cli is a private workspace package and not on npm. Exported for `scripts/site.ts`, which builds the landing page with the same CLI. */
export const CLI_URL = "https://pkg.pr.new/MindLab-Research/macaron-genui-demo/@genui/cli@main";
// How to run `@genui/cli` straight from that URL. One constant because the two places that print a
// command must not drift apart, and because each runner needs something different from the others —
// see the paragraph under "Check it before you hand it over", where all three are spelled out.
const RUN_CLI = `BUN_INSTALL_CACHE_DIR="$TMPDIR/bun-cache" bunx --yes genui@${CLI_URL}`;

export const SKILL_NAME = "generative-ui";

export const SKILL_DESCRIPTION = `How to decide between an inline ${FENCE_LANG} block, a canvas file, and plain prose — and how to lay one out so it reads. Load it **before you decide**, not after — including when your first instinct is that prose is enough. Most of the questions that should have been an interface do not ask for one.`;

/**
 * The skill body.
 *
 * A function of the import-map path because that path is only known at runtime — the plugin
 * lives wherever the profile installed it, and the model runs the checker from the workspace.
 * The map lets the checker resolve the host capability imports used by the card.
 */
/**
 * The paragraph about which import map serves which command.
 *
 * Built here rather than inline so the two maps can be described independently.
 */
/** Exported for `test/skill.test.ts`. */
export function mapNotes(typesMap: string | undefined, standaloneMap: string | undefined): string {
  if (typesMap === undefined) return "";
  const check = [
    `**Check the canvas file itself, at \`${CANVAS_DIR}/<id>${CANVAS_SUFFIX}\`.** Writing that path is what creates the`,
    "canvas, so there is no draft stage to check first: a `.tsx` anywhere else is a file the user",
    "will never see, however correct it is. Write it where it belongs, then check it there and fix",
    "it in place — the panel streams as you write and re-renders as you edit.",
    "",
    `The \`-i\` is not optional when the card imports \`${CAPABILITY_PREFIX}/*\`: without it every one of those lines`,
    "is reported as `Cannot find module`, and there is nothing to fix — they resolve at render time.",
    "",
    "**It silences that error rather than typing the calls.** The map only supplies declarations:",
    "it does not validate capability names or arguments. Everything else in the card is type-checked;",
    "the capability calls are on you.",
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
    `${RUN_CLI} build <file> -i ${standaloneMap}`,
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

**The tell is not "would this be useful to keep".** That question is about the content, it answers
yes for anything reference-shaped, and it is how a changelog, a cron explanation and a definition of
closures all became files. Ask instead: **did they ask for a durable thing?** A canvas is a file in
their workspace that they now own and have to close — creating one is an action taken on their
behalf, and it needs their say-so:

- They named a lasting artifact — "make me a dashboard", "a page I can share", "save this as", "a
  tool for…", "画板", "报告" — or asked to keep or come back to something. → **canvas**
- They asked a question, even a large one whose answer is long and well-organised. → **inline**,
  every time. "What changed in 2.1.251" is a question; 71 items of answer does not make it a file.
- The thing genuinely has more than one screen, or holds state the next turn needs. → **canvas**,
  and say in one line that you opened it.

When it is genuinely borderline, inline is the cheaper mistake: it is one message, not a file the
user now owns.

Two things follow from the lifetime difference:

- An **inline** block that the user acts on should *end that step* — see the next entry for WHICH control ends it, because on a card whose options need previewing it is not the one they pick with. Whichever it is, that control does two things: send the result with \`sendMessage\` **and** record what was chosen in \`usePersistedState\`, so the card still shows it when scrolled back to weeks later.

  **The second half is easy to drop, and it fails in two different ways.** Forgetting to record at all (\`sendMessage\` treated as the finish line) leaves the card unchanged; recording into \`useState\` loses the choice on reload. Both read to the reader as a form that did not take their answer.

  So the submit handler has three statements, not one:

      const [answer, setAnswer] = usePersistedState<string | null>("<this card>-answer", null)
      …
      onClick={() => { setAnswer(pick); sendMessage(…) }}        // record, then send
      …
      {answer !== null && <p className="text-muted">已选择：{label(answer)}</p>}   // and SHOW it

  A highlight is a fine way to show which control is active while the reader is still there; it is
  not an answer to someone coming back to this card later, who sees one button shaded and no
  statement of what was decided. Say it in words AND keep it in \`usePersistedState\`. Guard the send
  with the recorded answer, not with anything cleverer.
- **Exactly one control ends the step, and the reader must be able to find it.** A card the reader
  can fiddle with forever without a result has no useful ending.

  **The check is one grep, so run it on what you just wrote: does the source contain a
  \`sendMessage\` call at all?** A control can update local state and still leave the conversation
  without a result. Not "the ending was hard to find": there was none to find.

  Two endings are correct, and which one depends on whether the options need explaining:

  - **The options speak for themselves** (yes/no, this file or that one) — the click IS the answer.
    Two plain buttons, no card around them, \`sendMessage\` on click. Nothing to preview.
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

  \`preview\` is whatever actually shows the difference: a mermaid graph of the two migration paths,
  the formula rendered by katex, an SVG of the layout, a working miniature of the thing, a 3D view,
  a playable board. A paragraph of text describing the option is not a preview — the reader could
  have read that in the reply.

  **And it fires once.** \`sent\` above is persisted, so a reload shows the answer that was given
  rather than an untouched form, and the button cannot send a second turn for a question already
  answered.

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

  **An inline card is clickable before you have finished writing it, and that is where this bites
  hardest.** The reader sees the first controls while the rest of the card is still arriving, and
  **every chunk that adds JSX remounts every component the card defines itself** — so a choice they
  make mid-stream is wiped by the next chunk, silently, with the control snapping back to its
  initial state. State in the exported component or in \`usePersistedState\` survives the remount;
  state in a card-defined child does not.

  So anything the reader can change belongs in \`usePersistedState\`, not only the answer you
  intend to record. The one case it cannot reach is a third-party component holding its own state:
  \`<Disclosure defaultOpen>\` reverts to \`defaultOpen\` on every remount, and the only way to keep
  what the reader did is to control it yourself from persisted state.

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
  look like a delete.** These shapes all destroy user data without an obvious \`remove\` name:

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
  reads 0 again after an edit. Store the *start timestamp* rather than the elapsed count, so the
  display is derived and survives a remount by arithmetic.

  **Reaching for \`localStorage\` by hand is where this goes wrong.** A full quota, or storage
  disabled entirely, and \`setItem\` raises from inside an effect and can take the whole card down
  over a saved preference. \`usePersistedState\` has the \`try\` on both sides; use it and the
  question does not arise.

## Ask with an interface when the request is underspecified

"Build me a tool", "show me the data" — several plausible readings, no default. Guessing wastes a build; asking in prose makes the user type the answer back.

Ask with an **inline** block instead: one short line saying what you need to know, then 2–4 concrete options as clickable cards, each wired to \`sendMessage\` so a click *is* the reply:

\`\`\`tsx
import { sendMessage } from "$dsh/chat"
import { usePersistedState } from "${capabilityModule("state")}"

export default function Pick() {
  const [picked, setPicked] = usePersistedState<string | null>("ask:which-cloud-host", null)
  const choose = (id: string) => { setPicked(id); sendMessage(id) }
  // the key names THIS question — two asks in one conversation must not share it
  // picked === null → the options; otherwise just the chosen one, still highlighted
}
\`\`\`

**When the two answers need no explaining, they are two buttons in a row — not two cards.** The
shape to match is in the question: \`Postgres or SQLite?\` / \`公制还是英制？\` / \`要我先跑测试吗？\` are
answered by the label alone, and a bordered tile with a description under each says the choice is
weightier than it is. Same \`choose\`, same key, one row:

\`\`\`tsx
<div className="flex flex-wrap gap-2">
  {OPTIONS.map((o) => (
    <button key={o.id} onClick={() => choose(o.id)} aria-pressed={picked === o.id}
      className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-hover
                 aria-pressed:bg-accent aria-pressed:text-white aria-pressed:border-transparent
                 aria-pressed:hover:bg-accent">                    {/* or the selection vanishes under the pointer */}
      {o.label}
    </button>
  ))}
</div>
\`\`\`

Give each option a description and you have built the card version above; the descriptions are
what earn the tiles. Two labels that stand on their own take the row.

Rules for that move:

- **Do it before you explore.** Listing the workspace tells you what is there, never what the user wants. Stalling in tool calls is not a step.
- **Real options, not a form.** Each card is a thing you could go build right now. "Something else" belongs at the end as a plain text field, not as one of the cards.
- **One ask per question, and their answer settles that question.** Take it and build: a detail they left open takes your sensible default, named in one line. A choice their answer just *opened* is a different question, and it takes this same move — they told you the language, so formal-or-casual is a question that did not exist a turn ago.

Don't ask when the request already names the thing, when there is one obvious reading, or when building it is faster than asking about it. Plain conversational questions get plain answers.

## Say something before it and something after

A reply that is nothing but an interface reads like a document that is nothing but a code block — it arrives with no warning and the reader has to work out what they are looking at.

- **Before** — one line, *before* you open the fence or write the file, saying what you are about to build. It streams out while the code is still compiling, so for several seconds it is the only thing the reader has.
- **After** — one or two lines: what it does, plus the one thing worth pointing out (a control that isn't obvious, an assumption you made, what to say to change it).

Both short. Two or three sentences total. Don't narrate tooling ("now I'll write the file") — say what the user gets.

**Write the card in the language they wrote to you in — every label, every button, every helper line.** It is easy to miss because the card is a separate act of writing from the reply. Check the user's language before writing its labels.

## Framing

This one runs *opposite* in the two places, and getting it backwards is the most visible mistake:

- **Canvas fills its panel.** It already has a frame and a title bar around it. So take the whole space — \`height: 100%\`, your own padding, backgrounds bleeding to the edges — and do **not** wrap yourself in one more rounded, bordered, tinted box. A card inside the panel is a frame inside a frame.
- **Inline is the card.** It sits between paragraphs, so one bounded box is what tells the reader where it starts and stops.
- **But \`bg-page\` is the page's own colour, so a wrapper painted with it is not a box.**
  \`bg-page\` (that is the CLASS; \`--dsw-alias-bg-base\` is the variable
  behind it, and the two vocabularies are deliberately different) is \`#fff\` on light and
  \`#151517\` on dark — the same value the
  transcript behind the card is painted with, on both grounds. A root \`<div>\` with
  \`background: var(--dsw-alias-bg-base); padding: 16px; border-radius: 12px\` therefore draws
  nothing a reader can see: what is left is an invisible 16px inset and a rounded corner nobody
  can find, while the \`bg-layer\` blocks inside it read as the real frame — a frame inside an
  invisible frame. If you want the inline card to be bounded, bound it with \`bg-layer\` **plus**
  \`border-line\` (see the both-spellings rule below). If you don't, drop the wrapper's background
  and radius entirely rather than painting it the colour of the page.

Either way, don't restage the header. The panel already names the canvas, so a heading repeating that name is the second copy of it. If a heading is not naming a part of the page or saying something to the person reading it, delete it; a small-caps kicker above the heading plus a subtitle under it is three lines of chrome before anything happens. On Chinese text, \`textTransform: "uppercase"\` does nothing, leaving only an unnecessary small grey line. One heading at most, often none. A chip in the top right has to be something the user actually tracks, not decoration to balance the layout.

## Layout

- **The space between blocks is the root's job, and it is one class on the element that holds
  them.** A card is two to four stacked blocks, and what separates them is a \`gap\` on their
  parent — not a margin on each child, which collapses and doubles unpredictably:

      <div className="grid gap-4">

  A class written on the element it governs cannot come apart from it, which is most of why the styling here is
  classes. Inside a block the same \`gap\` separates its rows; a \`mb-4\` on one child while its
  siblings rely on the gap is what produces one odd space and eleven equal ones.

- **A collapse whose rows all start open is decoration, and a filter that starts at "everything"
  has not filtered.** Choose the initial state: if the list is longer
  than a screen, the first render shows labels and the filter starts somewhere narrower than
  everything.

- **A list of options collapses the prose, not the facts — and folding the wrong half is the
  common way to end up with a card nobody can scan.** What
  earns a permanent line is what the reader compares the options **by** — the name, the one
  number that distinguishes it. The paragraph explaining why it works is what folds. A list of
  more than about four options where every entry carries a paragraph is not a list any more, and
  the fix is not a smaller font.

- **A comparison table is read down a column, so its text cells are left-aligned and only its
  numbers are right-aligned.** Centring looks tidy
  in a mock where every cell is one short word and falls apart the moment one cell is a phrase.
  Numbers are the exception in both directions: right-align them and add
  \`font-variant-numeric: tabular-nums\`, so the digits stack. Header cells take the alignment of
  the column beneath them, not their own.

  **An unknown is not a zero.** A row the reader has not reported yet shows \`—\` and contributes
  nothing to the total. \`0\` is a measurement: it says the value was taken and came out zero, and it
  drags every average and running total down silently. The em dash takes
  \`text-muted\`, and if a total is shown beside incomplete rows, say what it is a total OF.

- **Write both the border and the background, and let the theme decide which one shows.** Light paints \`bg-page\`, \`bg-layer-1\` and \`bg-layer-2\` all \`#fff\`, so a block with only a background is **invisible** there and the border is the sole thing separating it; dark gives the layers real values (\`#151517\` / \`#232324\` / \`#2c2c2e\`) and carries it on the background alone. Both tokens work on both grounds. Floating surfaces (modals, dropdowns) keep both regardless — they have to occlude.

  **And a field you type into is not a surface — it is a hole in one.** \`bg-page\` is the colour
  of the ground everything else sits on, so an \`<input>\` painted with it is the same white as the
  card in light theme and reads as a faint outline. An input takes \`bg-layer-2\` (a step further from the ground than its container, not
  back towards it) with \`border-line-2\`, and the placeholder takes \`text-muted\`.

  **A thing you can tap needs more than the divider colour.** The rule above is about separating a
  block from the surface below it, and \`border-line\` — 4% black — is right for that. It is not
  enough for a control sitting on a surface that already has the same background: on light, every
  layer is \`#fff\` and 4% black is the only thing left. A tappable thing takes \`bg-layer-2\` or \`border-line-2\`, and the hairline
  stays for dividers.

  **A control you have FILLED is the opposite case, and the two get confused.** The rule above is
  about separating a surface from the surface under it, where both tokens are deliberately faint —
  \`border-line\` is 4% black. Once an element carries a real fill (a selected segment on
  \`state-business-primary\`, a primary button), that fill separates it completely and a leftover
  \`border-line-2\` is a grey ring around a blue block, related to nothing. Drop it — but to
  \`transparent\`, not to \`none\`, or the selected item loses a pixel of height and the row twitches
  as the reader clicks along it:

      border: selected ? "1px solid transparent" : "1px solid var(--dsw-alias-border-l2)"

  **And once a row is filled, everything inside it has to move off that fill too.** A step row filled with \`state-business-primary\` and a checked box inside it using the same background make the
  box vanish into the row and leave a white tick floating on blue with nothing around it. The
  same happens to a chip, a count, an icon tile: any child that had a background of its own is now
  sitting on a background that matches it. On a filled row the children want the fill's foreground
  (\`#fff\` here) as their colour and no background at all, or a white outline if the shape itself
  has to stay readable.
- **Keep nesting shallow.** A bordered box inside a bordered box is almost always wrong; a divider line does the job.
- **You are a component on someone else's page.** Your root is a normal node inside the chat column or the panel — nothing isolates you until you do it yourself. No \`position: fixed\`, no viewport UNITS (\`vh\`/\`vw\`, at any number — the window is not your box, so \`78vh\` is wrong for the same reason \`100vh\` is), no portals into \`document.body\`, no global listeners you don't remove. Overlays go in a \`relative\` wrapper you own with \`absolute inset-0\`. Effect libraries default to the wrong thing here and have to be pointed at your own element — \`canvas-confetti\` attaches a fullscreen canvas to \`document.body\` unless you pass one, so \`confetti.create(ref.current, { resize: true, useWorker: true })\` with that \`<canvas>\` absolutely positioned inside your container. Same for anything that says "mounts to body" or "fullscreen".
- **A title or a control sitting above a long list is a \`sticky\` header. Not "could be" — is.**
  The test is mechanical, so apply it mechanically: *is there anything above the list that the
  reader will still want once they are deep inside it?* A heading that says what they are looking
  at, a search box, a row of filter chips, a count that changes as they filter. If yes, that strip
  pins. Otherwise the reader scrolls into the list, decides to narrow it, and has to scroll back up
  past everything they were reading to reach the box that narrows it.
- **Your root sets no height and no \`overflow\`; the page is what scrolls.** You are inside a
  column the reader is already scrolling, so a root that sizes itself and grows its own scrollbar
  puts a second scroll inside the first. Pin with \`sticky\`, which pins against the READER's
  scroll, and give an inner pane its own bound only when a list genuinely needs one:

  \`\`\`tsx
  <div className="isolate relative">                                   {/* your own stacking context */}
    <div className="sticky top-0 z-10 bg-layer border-b border-line">…</div>
    <div className="max-h-[30rem] overflow-y-auto">…</div>            {/* the list, not the card */}
  </div>
  \`\`\`

  **\`overflow\` on ANY ancestor of a \`sticky\` element switches it off, silently** — no error, no
  warning, it simply scrolls away. Nothing between a \`sticky\` element and the page may set it.

  **\`isolate\` is what keeps your \`z-index\` small.** Inside a stacking context you own, \`z-10\`
  is above everything of yours and below everything of the app's. Without one, a number picked to
  beat your own siblings also beats the composer the reader types into.

- **The width is not the viewport's.** The same component lands in a narrow chat column *and* in a wide panel, so a media query tells you nothing useful — measure your own container with \`@container\` and \`@[32rem]:\` variants, which is the ONE responsive tool that works here. "One comfortable column beats two cramped ones" settles what to do at 320px; it is not a licence to ship the same single column at 720. A list of items with a name and a description is \`@[30rem]:grid-cols-2\`; a strip of stats is \`@[24rem]:grid-flow-col\`. The reader who widens the panel is asking for less scrolling, and getting a wider version of the same tall column is not an answer.

- **Extra width should make the rows SHORTER, not the card wider — inline as much as in a canvas.**
  Apply this to inline cards and canvases. Spend the extra width on rows themselves, not only on a stat strip or chip group inside them.
  The shape that costs the most is a three-band row: a name, a right-aligned number, then a
  control on its own full-width line, so at 720 the name and its number sit 1100px apart with a
  rail between them. At that width the three fit on ONE line:

      <div className="grid gap-2 @[32rem]:grid-cols-[1fr_12rem_auto] @[32rem]:items-center">
        <span className="min-w-0 truncate">{name}</span>
        <input type="range" … />
        <span className="tabular-nums text-right">{value}</span>
      </div>

  The reader drags a canvas panel between 320 and 720 — that drag should buy them less scrolling.
- **Nothing you draw may carry a width the column did not give it.** Content hanging off the edge
  can be clipped at the card, hiding the defect. Watch for these shapes:

  | what sticks out | write instead |
  | --- | --- |
  | \`<svg width="600" …>\` | \`viewBox="0 0 600 400"\` and \`className="w-full h-auto"\` — the viewBox carries the coordinates, the class carries the size |
  | a \`<pre>\`/\`<code>\` of real source | the code keeps its long lines; the WRAPPER gets \`overflow-x-auto\`, so the card stays put and the code scrolls inside it |
  | \`<table className="min-w-[28rem]">\` | put the \`overflow-x-auto\` on the wrapper and drop the min-width, or let the columns wrap |

  For code, \`shiki\` highlights it (see the library table) AND the wrapper still needs
  \`overflow-x-auto\`. Unhighlighted source in a card the reader cannot scroll sideways is code
  they can neither read nor reach the end of.

  \`min-w-0\` is the answer to a flex child that will not shrink; this is its opposite — an
  explicit intrinsic width you typed yourself, and no ancestor can undo it.

- **Layout breaks late, controls break early.** A row of buttons can reflow at a small width; a grid of content cards cannot, because each column has to stay wide enough to read.
- **Whatever \`hover:\` changes, the selected state has to claim in its hover form too.** A
  \`hover:bg-hover\` and an \`aria-pressed:bg-accent\` on the same button generate at the SAME
  specificity — \`:is()\` takes its argument's, so \`.class:hover\` and \`.class[aria-pressed]\` are
  both \`(0,2,0)\` — and source order in the generated sheet puts \`hover\` last. So the selected
  button turns back to neutral grey **while the pointer is on it**, which is exactly when the
  reader is looking at it.

  Add the pressed-and-hovered pair. It is \`(0,3,0)\`, so it wins on specificity and does not care
  where it lands in the sheet:

      hover:bg-hover aria-pressed:bg-accent aria-pressed:hover:bg-accent

  **Whichever attribute you marked the selection with, qualify that one** — the trick is the extra
  variant, not the word \`aria-pressed\`. \`data-[state=active]\`, \`checked\` and \`aria-selected\`
  have the same fix:

      data-[state=active]:hover:bg-accent    checked:hover:bg-accent    aria-selected:hover:bg-accent

  **Do not reach for \`not-\`.** \`not-aria-pressed:hover:bg-hover\` and
  \`hover:not-aria-pressed:bg-hover\` are the intuitive fix and this generator matches **neither** —
  they produce no rule at all, so the button keeps the bug and the class list now says it was
  handled. A ternary works too (\`picked ? "bg-accent" : "hover:bg-hover"\`) because only one branch
  is ever present; reach for that when the two states differ in more than a couple of properties.

- **Icons must name the thing beside them.** \`Sparkles\`, \`WandSparkles\`, \`Wand2\`, \`Stars\`, \`Bot\`, \`BrainCircuit\`, \`Zap\` as decoration say "an AI made this" and nothing else — \`Copy\` on a copy button, \`Languages\` on a translate tab, and nothing on a heading that reads fine without one. Prefer no icon to a decorative one.
- **If you take the focus ring off, put something back.** \`outline-none\` on a borderless input
  makes tabbing through the card move an invisible cursor. The
  browser's default ring is ugly next to a custom input, which is why it goes — the fix is a
  ring you like, not no ring:

      <input className="outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" />

  \`:focus-visible\`, not \`:focus\` — it shows the ring for the keyboard and not for the mouse,
  which is the reason the ring was annoying in the first place.
- **The rules below share one cause, and knowing it is worth more than the list.** A card gets
  written as a *picture* of an interface — the slider looks right, the number reads right, the
  ring is visual noise so it goes. Every one of them is correct through a mouse and an eye, and
  broken through a keyboard or a screen reader. The mistake is treating its controls as decoration.
  When you add a control, ask what it announces and what happens on Tab.
- **A control the keyboard cannot reach breaks keyboard use.** An \`onClick\` on a \`<div>\` takes no
  focus and answers no Enter or Space, and a button whose only content is an icon needs an
  \`aria-label\`; without it, a screen reader announces "button" and nothing else. Both are invisible to you when a mouse works either way:

      <button aria-label="复制" onClick={copy}><Copy size={14} /></button>

  If it does something when clicked, it is a \`<button type="button">\`. A \`div\` with an
  \`onClick\` is a div.

  **A clickable row is the case that survives this rule** — a list row, table cell, or card can be a \`<button>\` styled to look like the row. It is not: a \`<button>\`
  with \`display: block; width: 100%; text-align: left\` looks exactly like the row and is
  reachable. **\`textAlign: "left"\` is the part that gets dropped, and it is needed whatever the
  display is.** A row laid out as \`display: flex\` (to push a trailing action right with
  \`space-between\`) still inherits the button's centred text, so a short bold title sits visibly
  off-centre above the longer line beneath it while everything else looks left-aligned — the two
  cards where I hit this both had \`flexDirection: "column"\` on the text block, which declares the
  axis and does nothing about the alignment. If the row genuinely cannot be one — a virtualised list measuring its own height —
  then \`role="button" tabIndex={0}\` and an \`onKeyDown\` for Enter and Space, all three, because
  any one alone leaves it half-reachable.

  **A slider is the same problem with no visible text to fall back on.** Unlike a text field there
  is no placeholder and nothing inside the control to read — a screen reader announces "slider, 40" and stops.

  A visible name in a \`<span>\` directly above the control looks labelled and announces as nothing. A \`<span>\` is not a label, and
  neither is the number beside it — both are separate elements, connected to nothing:

      <input type="range" aria-label="音量" min={0} max={100} value={v} onChange={…} />

  **And a bare \`<input type="range">\` is the loudest thing on the card.** The browser paints its
  own track in the OS accent — a thick, fully saturated blue that ignores your theme and outshouts
  the number beside it. \`accent-color\` does not fix it. The track and the thumb are
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
  the new content is silent below it. Put one attribute on the container
  the results land in:

      <div aria-live="polite">{loading ? <Spinner /> : <List items={rows} />}</div>

  On the container, not the spinner — the element has to be in the DOM BEFORE the content changes
  for the change to be announced at all.

  **This is the one rule whose effect you cannot see.** A missing focus ring is visible the moment
  you tab; an unlabelled icon reads wrong the moment you look. A card with no live region looks
  exactly like one that has it, in every state, so the only way it gets written is on purpose.

  **And when it fails, say so where the results would have been.** \`} catch {}\` around a
  \`streamText\` or a \`bash\`, then \`setLoading(false)\`: the spinner stops, the card is empty, and
  nothing tells the reader whether it failed or simply found nothing. Rendering \`stderr\` counts;
  so does letting it throw to the surface's error
  boundary. An empty \`catch\` around the call itself does not.

  A \`<label>\` BESIDE the control names nothing. \`<label>音量</label><input type="range" …/>\` is
  is worse than no label: it reads as done. A label only
  associates when it wraps the control or carries \`htmlFor\` matching its \`id\`:

      <label>音量 <input type="range" value={v} onChange={…} /></label>   // wrapping, so it names it

  **A \`<select>\` has the same problem for the same reason** — its options are its value, not its
  name, so an unlabelled one announces "combo box, 每天" and the reader never learns what it
  selects, and the same two fixes apply.
- **Selected state is not a colour.** A group of choices where the picked one differs only by \`background\` or \`border\` reads as three identical buttons to anything that is not looking at it — a screen reader, a keyboard user checking where they are, a browser's own find. Put the state on the element:

  \`\`\`tsx
  <div role="radiogroup" aria-label="选择场次">
    {SESSIONS.map((s) => (
      <button key={s.id} role="radio" aria-checked={s.id === picked} onClick={() => pick(s.id)}
        className={s.id === picked ? "picked" : ""}>{s.label}</button>
    ))}
  </div>
  \`\`\`

  **The tell is the ternary you are about to write.** If you express the selection as \`background: picked === x ? … : …\` while mapping choices, the attribute belongs on the
  writing a conditional \`background\` inside a \`.map\` over choices, the attribute belongs on the
  same element, and it is the same condition you already typed. The className spelling needs it just
  as much — moving the ternary into a string changes nothing about what is announced:

  \`\`\`tsx
  <button className={\`btn\${picked === x ? " active" : ""}\`} aria-pressed={picked === x}>
  \`\`\`

  **A disabled control should say why, in its own label.** When a precondition disables a control,
  put the precondition in the label.

  **The row of presets is where this gets dropped.** A grid of toggles and a preset row are the same widget; put the state attribute on both.

  \`aria-pressed\` for a standalone toggle, the shape above for a pick-one. It is one attribute beside the ternary you already wrote — and the group wrapper, which is what tells a screen reader these three belong together.

- **Getting the attribute right and the pixels wrong is the commoner half.** A selected chip differing
  from its siblings **only by background colour** has one
  channel, and it is the channel that fails first — greyscale, a dim screen, or the 8% of men with
  a colour vision deficiency. The fix is a second channel on the same ternary, and it costs a
  class: \`font-medium\` on the selected one, or a \`✓\` before its label, or a ring the unselected
  ones do not carry. **Colour may be the loudest signal; it may not be the only one.**

  **Write the state and the style it produces as one token, and this whole class of bug stops
  existing.** \`aria-checked:bg-accent\` is a single string: there is no second place for it to
  disagree with.

  So: a state variant (\`aria-checked:\`, \`data-[open=true]:\`, \`hover:\`, \`focus-visible:\`) rather
  than a selector that has to go and find the element.

  This is about state that *persists* after the interaction. A key that lights while held, a row that highlights on hover — those are momentary feedback and want nothing announced; a state that is over before it is read is worse than none.
- **Every visual change is continuous.** No jump cuts: enter from where the element is, and let exits finish.
- **A card that animates needs the \`motion-reduce:\` variant on whatever moves.** It is not a preference about taste
  — people turn it on for vestibular disorders and migraine, and a looping demo is exactly what it
  is for. It is one more token beside the transition you already wrote:

      <div className="transition-transform duration-150 motion-reduce:transition-none" />

  For a keyframe animation the pair is \`animate-… motion-reduce:animate-none\`. A variant works
  where a media query in a style object cannot.

  Where the motion IS the explanation — a packet crossing a diagram, a sort swapping two bars —
  shorten it rather than removing it (\`animation-duration: .01s\`), so the card still steps.

## Sound

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

Write them in the ordinary order: **all \`useState\` / \`useMemo\` /
\`useEffect\` at the top of the component, none of them conditional, and none added after the
markup is on screen.** A hook introduced late — or one behind an \`if\` that flips — lands the
remount in the middle of a visible card, and the reader watches it blank and rebuild.

## Anything that keeps running

A game loop, an AutoPlay demo, a metronome, a clock, a progress animation — anything on
\`requestAnimationFrame\`, \`setInterval\` or a \`MediaStream\` — **must be returned from its
effect's cleanup.**

This matters here more than in an ordinary app, because **a card is replaced every time the
user asks for a change.** A stale loop can keep painting into a canvas nobody can see and slow the
conversation down.

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
the answer the reader is looking at gets overwritten by the one they replaced. This is especially
important when awaiting \`bash\`, which has no time bound by default.

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

**Fetch the first screen from a \`useEffect(…, [])\`.** Defining the loader and never calling it renders your skeleton forever. The whole shape:

\`\`\`tsx
const [loading, setLoading] = useState(true)
const load = async (p: string) => { try { setRows(await readdir(p)) } finally { setLoading(false) } }
useEffect(() => { void load(path) }, [path])   // ← the line that is missing when a card hangs
\`\`\`

**A card that re-runs a command needs \`signal\`.** Polling on a timer, or running one per
keystroke, stacks a second command on top of a slow first — and the panel then paints whichever
finishes last, which is not necessarily the newest. Pass an \`AbortController\`'s signal and abort
the previous run: it kills the command itself, not just your wait.

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
resolves — \`stdout: ""\`, \`timedOut: true\` — so \`bash()\` does not throw and a card that renders
\`stdout\` can show the reader **"no matches"** for a search that never finished. Check \`timedOut\`
before you report emptiness.

**And in \`find\`, exclude by pruning, not by filtering.** \`-not -path '*/node_modules/*'\` is a
predicate: \`find\` still descends into every excluded directory and stats every file inside
before discarding it. \`-prune\` stops the walk. For example:

    find . -type f -not -path '*/node_modules/*' …          # 55-65s -> killed at 15s, 0 rows
    find . \\( -name node_modules -o -name .git \\) -prune -o -type f … -print   # 6.3s, 5327 rows

Use the pruning spelling for bounded searches.

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

\`$dsh/fs\` gives a card \`readFile(path) -> string\`, \`readBytes(path) -> Uint8Array\`, \`readdir(path) -> {name, type, size}[]\`
(\`type\` is \`"file"\` or \`"directory"\`, so a tree needs no probing; \`size\` is bytes, absent on
directories) and \`writeFile(path, content)\` over the workspace. Paths are workspace-relative and
\`path\` is required — there is no "current directory" argument-less form, under the
session's own access mode — the same fence the file tools run behind. So a read-only session
refuses the write, and the card should say so rather than looking broken: catch it and tell
the user the session is read-only.

**Anything that is not text goes through \`readBytes\`.** \`readFile\` decodes as UTF-8, so a png, a wav
or a \`.mid\` read that way comes back with every byte above 0x7f replaced by U+FFFD — corrupt, and
silently so. And there is **no HTTP route that serves workspace files**: \`<img src={\`/\${path}\`}>\`
resolves against the app, 404s, and the reader gets a page of broken icons. The whole shape is three lines:

\`\`\`tsx
const [url, setUrl] = useState<string>()
useEffect(() => {
  let live = true, made: string | undefined
  void readBytes(path).then((bytes) => {
    if (!live) return
    made = URL.createObjectURL(new Blob([bytes]))
    setUrl(made)
  })
  return () => { live = false; if (made !== undefined) URL.revokeObjectURL(made) }
}, [path])
\`\`\`

Revoking is not optional in a browser that keeps a long transcript: one object URL per image per
mount, never released, is a leak the reader pays for in memory. A grid of them wants an
\`IntersectionObserver\` too — read the bytes when the cell comes near, not all of them on mount.

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

Hardcoding a few itineraries samples the space and presents the sample as the whole. Ask **could I
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
${RUN_CLI} check <file>${typesMap === undefined ? "" : ` -i ${typesMap}`}
\`\`\`

**\`bunx\` needs the package NAME in front of the URL** — \`genui@https://…\`. Bun reads the whole
argument as \`<name>@<spec>\`, so a bare URL gives it an empty name and it stops at
\`unrecognised dependency format\` before fetching anything. Any name works; it is a label, not a
lookup.

If bun is not there, in order:

\`\`\`
pnpx --config.blockExoticSubdeps=false ${CLI_URL} check <file>
npm_config_cache="$TMPDIR/npm-cache" npx --yes ${CLI_URL} check <file>
\`\`\`

Both take the bare URL. The pnpm flag is **not** optional — the CLI pulls \`@genui/unocss\` by URL
as well, and pnpm refuses URL-resolved SUBdependencies by default, so without it you get
\`ERR_PNPM_EXOTIC_SUBDEP\` naming a package you never asked for. Do **not** add
\`--config.cacheDir\` beside it: pnpm then loses the package's own bin and dies with
\`spawn cli ENOENT\`, which reads like the package is broken and is not. It needs no cache redirect
anyway — its store is the one of the three your sandbox lets you write.

**The other two do**, and the reason is worth knowing because it disguises itself. Sandboxed,
\`touch ~/.npm/_cacache/x\` and \`touch ~/.bun/install/cache/x\` both come back
\`Operation not permitted\`; the directories exist, they are simply not yours to write from in
there. npm reports this as \`EPERM mkdtemp\` **and a message about root-owned files**, which sends
you looking for a permissions problem in your home directory that is not there. \`$TMPDIR\` is
writable, so pointing each cache at it is the whole fix.

\`check\` includes TypeScript diagnostics; \`lint\` is the faster syntax-only pass.

${maps}

Either way, the way to see your work actually run is to write the canvas and look at the panel.

**Two mistakes it reports that do not blow up**, and both are easy to miss because the thing still works:

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

It is worth the round trip because it catches mistakes that otherwise reach the user as a blank
card with nothing in the console. Examples:

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

**Read the report, do not obey it.** An \`implicitly has an 'any' type\` warning can still describe
a card that runs perfectly. Annotating every parameter to quiet it costs lines and buys nothing. The lines
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
| form controls — a switch, a select, a combobox, a modal, tabs, a disclosure | \`@headlessui/react\` | \`Field\` + \`Label\` around \`Switch\`/\`Listbox\`/\`Combobox\` — labelling comes with them. Its \`Disclosure\` and \`Tab\` are also the cheapest correct way to build the folding a dense card needs. **The container components render a \`Fragment\`, so a \`className\` on one throws and takes the whole card with it** — \`<Disclosure className=…>\` dies with *Passing props on "Fragment"!* and the reader gets that sentence instead of the card. Write \`<Disclosure as="div" className=…>\`; same for \`Tab.Group\`, \`Listbox\`, \`Menu\`, \`RadioGroup\`. The leaves (\`Disclosure.Button\`, \`.Panel\`) are real elements and take \`className\` as they are, which is why the failure looks like the library rejecting a style it accepts everywhere else. |
| the same, when you want arrow-key roving between tabs or menu items | \`@radix-ui/react-tabs\`, \`@radix-ui/react-accordion\`, \`@radix-ui/react-dialog\` | one package per primitive, so import only what you use. **This is the one that gives arrow-key navigation**: Radix's \`Tabs\` moves focus with ←/→ and Home/End, Headless UI's does not — a real user asked for exactly that and was right to notice it missing. Compose from \`Tabs.Root\`/\`List\`/\`Trigger\`/\`Content\`; they render unstyled, so every class is yours |
| a formula the reader is trying to READ, not just the number it comes out as | \`katex\` | \`katex.renderToString(tex, { throwOnError: false })\` into \`dangerouslySetInnerHTML\`; it has both a default and a named \`renderToString\`, so either import works. \`throwOnError: false\` is the load-bearing half — a half-typed \`\\\\frac{a}\` renders as \`<span class="katex-error">\` instead of throwing during render and taking the card with it, and half-typed is what streaming produces. The glyph metrics come from its stylesheet: append \`<link rel="stylesheet" href="https://esm.sh/katex@0/dist/katex.min.css">\` in an effect and REMOVE it in the cleanup, the same way you would a listener |
| a flow, a sequence, a state machine — anything whose content is *which box points at which* | \`mermaid\` | \`mermaid.initialize({ startOnLoad: false })\` once, then \`await mermaid.render(id, "graph LR; A-->B")\` which resolves \`{ svg }\` for \`dangerouslySetInnerHTML\` — it is async and returns a string, it does not mount itself. Give each render a unique id or the second one collides with the first. Reach for this before hand-placing boxes: you write the edges and it does the layout, which is the part that goes wrong by hand |
| a diagram whose POSITIONS carry meaning — a system laid out the way the reader pictures it, a floor plan, an annotated screenshot | your own \`<svg>\`, or boxes and CSS | This is the one case where hand-drawing IS the answer, and the rule above does not contradict it: \`recharts\` renders DATA, and there is no library that knows what your boxes are or which arrow goes where. Asked to draw something, draw it — a card that answers "画出来" with a bulleted list of the parts has changed the question. Nodes as positioned boxes with \`<svg>\` lines between them, or a grid of boxes with borders for the edges, both read fine |
| showing code, a diff, or a config file | \`shiki\` | \`await codeToHtml(src, { lang, theme })\` in an effect, then \`dangerouslySetInnerHTML\` — it is async, so render a \`<pre>\` of the raw text first and swap. A hand-rolled \`<pre>\` with no highlighting is the tell that this was skipped, and for a diff the red/green is the whole point. **\`@monaco-editor/react\` only when the reader will TYPE into it.** Everything the reader wanted from it — line numbers, colours, two files — \`shiki\` renders as static HTML |


Names you half-remember are the main failure mode: a wrong export is not a typo, it is an \`undefined\` component and a blank render, with nothing in the console naming it. So look a name up *before* you write the code, not after it breaks — for lucide, fetching \`https://lucide.dev/icons/<kebab-name>\` answers it outright, since a 404 means the name does not exist. Icons you have actually watched render are fine to reuse from memory.

The same doubt covers **default vs named**, and there the answer is cheaper still: \`curl -s https://esm.sh/<package>\` prints the re-export lines, and an \`export { default }\` among them is the whole answer — \`@number-flow/react\` has one, \`vaul\` does not. For anything that does not settle it, the package's README on npm shows the import line its author wrote. Guessing here has a specific shape — \`import { X }\` where the package exports \`default\` gives you \`undefined\` and a blank card, with no error mentioning \`X\`.

One lookup costs a few seconds; a wrong name costs a blank card, a confused user, and a repair round-trip.`)(mapNotes(typesMap, standaloneMap))
    // Cut the section whole, from its heading to the next one. Anchored on the headings rather
    // than on line numbers so editing the prose in between cannot silently change what is cut.
    .replace(allowExec ? "" : /\n## Running a command\n[\s\S]*?(?=\n## )/, "");
