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
import { CANVAS_DIR, CANVAS_SUFFIX, FENCE_LANG } from "./contract.ts";

export const SKILL_NAME = "generative-ui";

export const SKILL_DESCRIPTION = `How to decide between an inline ${FENCE_LANG} block, a canvas file, and plain prose — and how to lay one out so it reads. Load this before you build any interface.`;

export const SKILL_BODY = `# Building a generative UI

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

## Generating content inside the card

\`streamText\` from \`$dsh/ai\` is for when a literal array in the file would freeze the thing
that should vary — the recipe steps, the itinerary, the candidate names. It inherits the
app's model, so there is no key to ask for and no setup.

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

## Imports

Bare specifiers resolve from npm at render time — there is no install step, so never tell the user to install anything and never hold back an import because it "isn't available". Importing it *is* installing it.

**Nor because a library might have quirks.** Hand-rolling an SVG chart to avoid \`recharts\`, or a plain textarea to avoid a markdown renderer, is not the safe choice — it is a worse component and several hundred lines you now own. Reach for the real library: \`recharts\` for charts, \`@dnd-kit/core\` for drag, \`motion/react\` for animation, \`lucide-react\` for icons. Write it by hand only when nothing does the job.

Names you half-remember are the main failure mode: a wrong export is not a typo, it is an \`undefined\` component and a blank render, with nothing in the console naming it. So look a name up *before* you write the code, not after it breaks — for lucide, fetching \`https://lucide.dev/icons/<kebab-name>\` answers it outright, since a 404 means the name does not exist. Icons you have actually watched render are fine to reuse from memory.

One lookup costs a few seconds; a wrong name costs a blank card, a confused user, and a repair round-trip.`;
