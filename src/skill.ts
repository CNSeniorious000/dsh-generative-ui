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
import { CANVAS_DIR, CANVAS_SUFFIX, CAPABILITY_PREFIX, FENCE_LANG } from "./contract.ts";

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
    `The \`-i\` is not optional when the card imports \`${CAPABILITY_PREFIX}/*\`: without it every one of those lines`,
    "is reported as `Cannot find module`, and there is nothing to fix — they resolve at render time.",
    "",
    "**It silences that error rather than typing the calls.** Measured: a map pointing at a file",
    "that does not exist reports `OK` just the same, so `$dsh/*` ends up `any` and a wrong",
    "argument or a misspelt result field passes the check. Everything else in the card is really",
    "type-checked; the capability calls are on you.",
    "",
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

export const skillBody = (typesMap: string | undefined, standaloneMap: string | undefined): string => ((maps) => `# Building a generative UI

## Is this a UI at all

An interface earns its place when the answer has a shape prose has to flatten: numbers to compare, a control to move, options to pick between, something that changes as the user pokes at it.

It does not earn its place when the answer is a sentence. A definition, a yes/no, a recommendation with a reason — wrapping those in a card adds a box and a heading around text that was already fine, and costs the reader a second to work out there is nothing to click. When you find yourself building a component whose whole body is one paragraph, write the paragraph.

Two specific traps:

- **Do not restate the reply as a card.** If the interface only repeats what the prose next to it already said, one of them is redundant, and it is the card.
- **Do not decorate an answer.** A metric with an icon and a border is still just a number. Ship the number.

Conversely: "visualise this", "show me a chart", "make it interactive", "let me try it" are unambiguous requests for the block. Build it directly — don't reach for \`run_code\` or an image; the fence renders in the browser.

## Inline or canvas

They are not two sizes of the same thing; they have different lifetimes.

**Inline** is *one step of the conversation*. It lives in the message where it was said, it is read once, and it scrolls away. Use it when the UI is tied to what you are saying right now: the comparison you just described, the option set you need answered, a small live calculation.

**Canvas** (\`${CANVAS_DIR}/<id>${CANVAS_SUFFIX}\`) is *a place the user comes back to*. It stays in the panel across turns, keeps state, and can hold several views. Use it when the thing has substance — a tool, a dashboard, an editor, anything with more than one screen or worth reopening tomorrow.

The tell is the question "would the user want this again in ten turns?" Yes → canvas. No → inline. When it is genuinely borderline, inline is the cheaper mistake: it is one message, not a file the user now owns.

Two things follow from the lifetime difference:

- An **inline** block that the user acts on — picks an option, submits a choice — should *end that step*: send the result with \`sendMessage\` **and** record what was chosen, so the card still shows it when scrolled back to weeks later. Both halves matter: skip the send and the click goes nowhere, skip the record and the card resets to untouched. A form that looks untouched after submitting reads as broken.
- A **canvas** stays interactive. It does not "complete"; it just sits there working.
- A **canvas outlives the reply that made it**, so data the user puts into it — entries, notes, cards — must survive a reload on its own. There is no persistence hook here yet, so reach for \`localStorage\` under a key named after the canvas. Plain \`useState\` is a bug you cannot see while building: the ledger looks right until the tab reloads and every row is gone.
  **And a reload is not the common case — your own next edit is.** Every revision replaces the
  whole file, so the canvas remounts and anything held only in \`useState\` is gone; change one word
  in a label and the user's half-typed row goes with it. Persist what they typed, not just what
  they saved.
  **A running clock is state too**, and the least obvious kind: a stopwatch or a timer mid-count
  reads 0 again after one edit. Measured — the interval itself is cleaned up correctly, nothing
  stacks up, but the elapsed value is gone. Store the *start timestamp* rather than the elapsed
  count, so the display is derived and survives a remount by arithmetic.

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

Both short. Two or three sentences total. Don't narrate tooling ("now I'll write the file") — say what the user gets. And write in the user's language: if they wrote Chinese, the labels and button text inside the interface are Chinese too.

## Framing

This one runs *opposite* in the two places, and getting it backwards is the most visible mistake:

- **Canvas fills its panel.** It already has a frame and a title bar around it. So take the whole space — \`height: 100%\`, your own padding, backgrounds bleeding to the edges — and do **not** wrap yourself in one more rounded, bordered, tinted box. A card inside the panel is a frame inside a frame.
- **Inline is the card.** It sits between paragraphs, so one bounded box is what tells the reader where it starts and stops.

Either way, don't restage the header. The panel already names the canvas, so a heading repeating that name is the second copy of it; a small-caps kicker above the heading plus a subtitle under it is three lines of chrome before anything happens. One heading at most, often none. A chip in the top right has to be something the user actually tracks, not decoration to balance the layout.

## Layout

- **A border or a background, never both** — where "a background" means one that actually differs from what it sits on. This app's light theme paints every \`bg-*\` layer pure white, so there a raised block has only its border to show for itself and must keep it; on dark the value difference carries it. Setting both is right here, not a violation. Floating surfaces (modals, dropdowns) keep both regardless — they have to occlude.
- **Keep nesting shallow.** A bordered box inside a bordered box is almost always wrong; a divider line does the job.
- **You are a component on someone else's page.** Your root is a normal node inside the chat column or the panel — nothing isolates you. No \`position: fixed\`, no \`100vw\`/\`100vh\`, no portals into \`document.body\`, no global listeners you don't remove. Overlays go in a \`relative\` wrapper you own with \`absolute inset-0\`. Effect libraries default to the wrong thing here and have to be pointed at your own element — \`canvas-confetti\` attaches a fullscreen canvas to \`document.body\` unless you pass one, so \`confetti.create(ref.current, { resize: true, useWorker: true })\` with that \`<canvas>\` absolutely positioned inside your container. Same for anything that says "mounts to body" or "fullscreen".
- **The width is not the viewport's.** The same component lands in a narrow chat column *and* in a wide panel, so a media query tells you nothing useful — measure your own container, or design something that reads at any width. Content grids especially: one comfortable column beats two cramped ones.
- **Layout breaks late, controls break early.** A row of buttons can reflow at a small width; a grid of content cards cannot, because each column has to stay wide enough to read.
- **Icons must name the thing beside them.** \`Sparkles\`, \`WandSparkles\`, \`Wand2\`, \`Stars\`, \`Bot\`, \`BrainCircuit\`, \`Zap\` as decoration say "an AI made this" and nothing else — \`Copy\` on a copy button, \`Languages\` on a translate tab, and nothing on a heading that reads fine without one. Prefer no icon to a decorative one.
- **Every visual change is continuous.** No jump cuts: enter from where the element is, let exits finish, and honour \`prefers-reduced-motion\`.

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

## Running a command

\`bash(command)\` from \`$dsh/exec\` runs one command in the workspace and resolves
with \`{stdout, stderr, exitCode, truncated, timedOut}\`. It runs under the session's own sandbox
mode, so it opens nothing your own bash tool has not already opened.

**A card that re-runs a command needs \`signal\`.** Polling on a timer, or running one per
keystroke, stacks a second command on top of a slow first — and the panel then paints whichever
finishes last, which is not necessarily the newest. Pass an \`AbortController\`'s signal and abort
the previous run: it kills the command itself, not just your wait. The abort rejects, and that
one rejection is not a failure — \`if (error.name === "AbortError") return;\` before you show
anything. In an effect, abort in the cleanup, and stop polling on \`document.hidden\` so a canvas
nobody is looking at is not shelling out every two seconds.

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
stops the generation itself, not just your reading of it. The abort rejects with an
\`AbortError\`, which is the one rejection that is not a failure — return on it rather than
showing it.

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

- **A duplicate key in a style object.** \`{ display: "block", …, display: "flex" }\` keeps the
  last one and silently drops the first. It looked right because \`flex\` was what the button
  wanted — the dead line survives until someone edits the wrong one.
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

## Imports

Bare specifiers resolve from npm at render time — there is no install step, so never tell the user to install anything and never hold back an import because it "isn't available". Importing it *is* installing it.

**Nor because a library might have quirks.** Hand-rolling an SVG chart to avoid \`recharts\`, or a plain textarea to avoid a markdown renderer, is not the safe choice — it is a worse component and several hundred lines you now own. Reach for the real library: \`recharts\` for charts, \`@dnd-kit/core\` for drag, \`motion/react\` for animation, \`lucide-react\` for icons. Write it by hand only when nothing does the job.

Names you half-remember are the main failure mode: a wrong export is not a typo, it is an \`undefined\` component and a blank render, with nothing in the console naming it. So look a name up *before* you write the code, not after it breaks — for lucide, fetching \`https://lucide.dev/icons/<kebab-name>\` answers it outright, since a 404 means the name does not exist. Icons you have actually watched render are fine to reuse from memory.

One lookup costs a few seconds; a wrong name costs a blank card, a confused user, and a repair round-trip.`)(mapNotes(typesMap, standaloneMap));
