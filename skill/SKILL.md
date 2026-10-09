---
name: generative-ui
description: How to decide between an inline ui4a/tsx block, a canvas file, and plain prose — and how to lay one out so it reads. Load it **before you decide**, not after — including when your first instinct is that prose is enough. Most of the questions that should have been an interface do not ask for one.
---

# Building a generative UI

## Is this a UI at all

An interface earns its place when the answer has a shape prose has to flatten: numbers to compare, a control to move, options to pick between, something that changes as the user pokes at it.

It does not earn its place when the answer is a sentence. A definition, a yes/no, a recommendation with a reason — wrapping those in a card adds a box and a heading around text that was already fine, and costs the reader a second to work out there is nothing to click. When you find yourself building a component whose whole body is one paragraph, write the paragraph.

Two specific traps:

- **Do not restate the reply as a card.** If the interface only repeats what the prose next to it already said, one of them is redundant, and it is the card.
- **Do not decorate an answer.** A metric with an icon and a border is still just a number. Ship the number.

**And a long answer is not automatically prose.** The trap above is a card whose body is one paragraph; the opposite trap is a wall of markdown that was a list of things to *do*. A recipe, a workout, a packing list, a set of steps — the reader works through those one item at a time, loses their place, and comes back to them. Ticking an item off is the whole interaction, and markdown cannot offer it. If you are about to write `- ` more than about six times and the items are actions rather than facts, that is the block, not prose.

Conversely: "visualise this", "show me a chart", "make it interactive", "let me try it" are unambiguous requests for the block. Build it directly — don't reach for `run_code` or an image; the fence renders in the browser.

## Inline or canvas

They are not two sizes of the same thing; they have different lifetimes.

**Inline** is *one step of the conversation*. It lives in the message where it was said, it is read once, and it scrolls away. Use it when the UI is tied to what you are saying right now: the comparison you just described, the option set you need answered, a small live calculation.

**Canvas** (`.dsh/ui4a/canvases/<id>.ui4a.tsx`) is *a place the user comes back to*. It stays in the panel across turns, keeps state, and can hold several views. Use it when the thing has substance — a tool, a dashboard, an editor, anything with more than one screen or worth reopening tomorrow.

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

Measured: on `cron-read` — *"`*/17 3-5 * * 2` 这个 cron 到底几点跑？"*, a lookup with one right
answer — models opened a canvas **5 times in one round and 6 in the next**, and one opened a canvas
for *"什么是闭包？"*. Nobody asked for a file in any of them.

When it is genuinely borderline, inline is the cheaper mistake: it is one message, not a file the
user now owns.

## Ask with an interface when the request is underspecified

"Build me a tool", "show me the data" — several plausible readings, no default. Guessing wastes a build; asking in prose makes the user type the answer back.

Ask with an **inline** block instead: one short line saying what you need to know, then 2–4 concrete options as clickable cards, each wired to `sendMessage` so a click *is* the reply:

```tsx
import { sendMessage } from "$dsh/chat"
import { usePersistedState } from "$dsh/state"

export default function Pick() {
  const [picked, setPicked] = usePersistedState<string | null>("ask:which-cloud-host", null)
  const choose = (id: string) => { setPicked(id); sendMessage(id) }
  // the key names THIS question — two asks in one conversation must not share it
  // picked === null → the options; otherwise just the chosen one, still highlighted
}
```

**When the two answers need no explaining, they are two buttons in a row — not two cards.** The
shape to match is in the question: `Postgres or SQLite?` / `公制还是英制？` / `要我先跑测试吗？` are
answered by the label alone, and a bordered tile with a description under each says the choice is
weightier than it is. Same `choose`, same key, one row:

```tsx
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
```

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

**Write the card in the language they wrote to you in — every label, every button, every helper line.** This is not a preference, it is whether they can use it: a Spanish speaker handed a card labelled 日常休闲 / 户外运动 got no answer at all. It is easy to miss because the card is a separate act of writing from the reply, and the reply is usually right; measured, a card for `Suggest an outfit that matches the occasion and weather` came back entirely in Chinese. The corpus is **en 39% / es 31% / fr 12% / it 9% / pt 5%, and Chinese 0.2%** — so Chinese is the wrong default in almost every turn, and if you find yourself typing a CJK label, check what language the question was in.

## Read the relevant reference before writing TSX

The instructions below live beside this file in `references/`. Resolve these paths against this skill's base directory. For every card or canvas, read the layout and accessibility references before coding; read the other files when their feature applies. The entrypoint alone is not the complete authoring guide.

- For state, a submit/preview flow, undo, or a canvas that survives edits: [lifetime.md](references/lifetime.md).
- For framing, spacing, scrolling, responsiveness, and theme tokens: [layout.md](references/layout.md).
- For controls, keyboard and screen-reader access, selected state, and motion: [accessibility.md](references/accessibility.md).
- For audio or waveform UI: [sound.md](references/sound.md).
- For hooks, timers, animation loops, or overlapping async work: [runtime.md](references/runtime.md).
- For web search: [web.md](references/web.md).
- For workspace files and binary assets: [files.md](references/files.md).
- For model-generated content inside a card: [ai.md](references/ai.md).
- Before handing over a long inline card or canvas: [checking.md](references/checking.md).
- When choosing an npm library or checking an export: [imports.md](references/imports.md).

<!-- exec-reference: included only on hosts where the command route is enabled -->
