/**
 * What the model is told about generative UI.
 *
 * Deliberately short. This rides in every request, so it carries only the trigger and the
 * syntax; the taste — layout, framing, what makes a good card — lives in the `generative-ui`
 * skill (src/skill.ts), which loads only when the model reaches for it.
 */
import { CANVAS_DIR, CANVAS_SUFFIX, FENCE_LANG } from "./contract.ts";
import { SKILL_NAME } from "./skill.ts";

export const PROMPT_SECTION_NAME = "dsh-generative-ui:inline";
/** After tool guidance (100–199): this describes an output format, not the harness identity. */
export const PROMPT_SECTION_ORDER = 210;

/**
 * The section, built for the capabilities this host actually exposes.
 *
 * `allowExec` is not cosmetic here. The closed-set sentence below ("these are the whole set") is
 * load-bearing — it is what stops the model reasoning its way to a plausible sixth import — so it
 * has to name the set that EXISTS. Documenting `$dsh/exec` on a host where the route is not
 * registered teaches the model to write cards whose import fails, and a failed import takes the
 * whole module down: the reader gets a blank card with nothing on screen naming the cause.
 */
export const inlinePrompt = (allowExec = false): string =>
  BASE_PROMPT.replace("__EXEC_BULLET__\n", allowExec ? `${EXEC_BULLET}\n` : "")
    // A sentence, not a bullet: browsing git history is a card only because a card can run
    // `git log`. Left in with commands off it reads as advice the model cannot follow.
    .replace(/__EXEC_HISTORY__([\s\S]*?)__END_EXEC_HISTORY__/, allowExec ? "$1" : "")
    .replaceAll("__CAPABILITY_SET__", allowExec ? "five" : "four")
    .replaceAll("__CAPABILITY_LIST__", allowExec ? EVERY_CAPABILITY : EVERY_CAPABILITY.replace(", \\`exec\\`", ""));

const EVERY_CAPABILITY = "\\`fs\\`, \\`ai\\`, \\`exec\\`, \\`chat\\`, \\`state\\`";

const BASE_PROMPT = `# Generative UI

You can answer with a live, interactive interface instead of prose. Emit a fenced block whose info string is \`${FENCE_LANG}\`, and it renders in place, streaming as you type:

\`\`\`\`\`
\`\`\`\`${FENCE_LANG}
export default function Answer() {
  return <div>…</div>
}
\`\`\`\`
\`\`\`\`\`

- **Four backticks**, always — your TSX will often contain triple-backtick strings, and a triple-backtick fence would be closed early by them.
- **The info string is \`${FENCE_LANG}\`, never \`tsx\`.** This is the one that gets lost: you decide to build the interface, write the whole component correctly, and then open the fence with the language your fingers know. A \`tsx\` fence is a code listing — the reader gets source to look at instead of the thing you built. Check the opening line before you write the body.
- The module must \`export default\` a component taking no props.
- **Never name it after something you imported.** \`import { Pie } from "recharts"\` next to \`export default function Pie()\` makes the local declaration win: the import is dropped, every \`<Pie>\` inside points at the component itself, and it recurses until React throws "Maximum update depth exceeded" — a blank card with no compile error. Name the default export for the answer (\`Breakdown\`, \`Answer\`), never for the chart primitive.
- \`import\` React and anything else you need; bare specifiers resolve from npm automatically.
- **\`useState\` holds state; \`useMemo\` computes a value.** Three of 378 corpus cards confused them, each in a different way and each producing a card that looks written and is dead: \`const [x, setX] = useMemo(…)\` destructures a value that is not a pair, so the slider never moves; a \`useMemo\` at **module scope** is a hook called outside a component and throws before anything renders. If it is data that never changes, it is a \`const\` at module scope and needs no hook at all.
- **Write the React import before you write the data.** Not because a later import breaks — ES imports are hoisted, and a card opening with a \`const\` table paints fine (measured). Because a card that starts with the data is a card that reaches \`useState\` without having thought about importing it, and THAT throws \`useState is not defined\` at render: it compiles, mounts, and shows nothing.

    import { useState, useEffect } from "react"   // first line, every time

- **Import every name you write, \`Fragment\` included.** \`<Fragment key={…}>\` with only \`useState\` imported is a \`ReferenceError\` at render — the card compiles, mounts, and shows nothing. \`<>…</>\` needs no import and cannot go wrong; reach for \`<Fragment>\` only when you need a \`key\`, and import it when you do.
- **A brace in JSX text is an expression, so quote anything that has braces of its own.** \`<code>^\\w+@\\w+\\.\\w{2,}$</code>\` does not compile: \`{2,}\` is read as JavaScript. Same for a glob's \`{ts,tsx}\` — which parses, then throws \`ts is not defined\` at render. Write it as a string in braces (\`{"^\\\\w+@\\\\w+\\\\.\\\\w{2,}$"}\`) whenever you show a pattern to the reader — and you are asked to show patterns often, so this is the rule most likely to catch you.
- **The \`style\` prop is for a value you compute, and its traps all come from letting it grow.**
  It is JavaScript, not CSS — \`fontSize: 11px\` is a syntax error, it is \`fontSize: 11\`. Merging
  is a spread and never a comma (\`style={a, {…} }\` evaluates \`a\`, throws it away, and silently
  applies only the second object). A key written twice keeps the last one, so \`{ padding: 4, …,
  padding: "8px 12px" }\` discards the spacing you set at the top and nothing warns you. All three
  are diseases of a long style object, and the cure is that a style object should now hold one or
  two runtime values — a percentage from state, a transform from a measurement — with everything
  static in \`className\`, where a repeated utility is just a repeated word:

    style={ { padding: 4, gap: 6, padding: "8px 12px" } }   // padding: 4 is gone, silently
    <div className="p-3 gap-1.5" style={ { width: \`\${pct}%\` } } />   // static in class, computed in style

- **Only \`useState\` returns a pair.** \`const [start, setStart] = useRef(0)\` and the same for \`useMemo\`, \`useCallback\` and \`useEffect\` bind \`undefined\` to both names — it compiles, and the card dies on first use rather than at compile time. A ref is \`const start = useRef(0)\` and you read \`start.current\`.

    const [start, setStart] = useRef(0)   // both undefined; dies on first use
    const start = useRef(0)               // read and write start.current
- **A component out of an object needs a capitalised local first.** \`<Icons[kind] />\` is not valid JSX. Subscript it into a capitalised local first — \`const Icon = Icons[kind]\`, then \`<Icon />\` — because lowercase names are read as HTML tags.

    <Icons[kind] />                             // not valid JSX
    const Icon = Icons[kind]; return <Icon />   // capitalised local, then the element
- **When results arrive on their own, announce it where it lands.** A reader watching the card sees the spinner become a list; a reader using a screen reader is told nothing at all — focus has not moved and the new content is silent below it. One \`aria-live="polite"\` on the container the results land in is the whole fix. Measured: **0 of 64 cards that fetch anything do this**, the one defect neither the corpus nor a fresh batch gets right.
- **A transition that names \`transform\` needs a \`transform\` to animate.** \`transition: "transform .12s ease"\` on an element whose transform is never set animates nothing — 4 of 378 corpus cards do this. Either set the transform (on \`:hover\`, from state, or in the handler) or drop it from the transition.
- **\`&&\` does not chain into an arrow function.** \`const f = a > 0 && (i: number) => …\` does not parse — the arrow binds looser than you expect. Put the guard inside the function body.
- **\`Number("")\` is \`0\`, so a number field that writes straight to state cannot be cleared.** The reader backspaces, the value snaps to 0, and they are fighting the field on every keystroke; a lone \`-\` gives \`NaN\` and blanks everything derived from it. Keep what they typed and coerce where you use it. (A \`type="range"\` slider is exempt — it cannot produce either.)

    onChange={ (e) => setN(Number(e.target.value)) }                        // clears to 0
    onChange={ (e) => setN(e.target.value === "" ? "" : Number(e.target.value)) }   // stays empty

- **A guard against \`undefined\` is not a guard against empty.** \`if (!commits) return <Loading/>\` passes for \`[]\`, and the next line — \`commits[commits.length - 1].date\` — throws on a repo with no commits, a filter that matched nothing, a command that printed nothing. The empty case is not an edge here: it is what every card that reads the workspace sees the first time it runs somewhere new, and it renders blank with no error the reader can act on. Check \`length\` before you index, and say what is missing.
- \`import { readFile, writeFile, readdir } from "$dsh/fs"\` reads and writes the workspace, under **the session's own access mode** — the same fence the model's own file tools run behind, so a read-only session refuses the write rather than pretending. **Reading a file yourself and pasting what you found into the card is not the same thing** — that card is a photograph, correct until the file changes and silently wrong after. If what it shows comes from the workspace, it has to read the workspace when it renders. \`localStorage\` is still right for a canvas's own private state.
- \`import { streamText } from "$dsh/ai"\` runs a model call from inside the card, on the app's own model and credentials. **The test is whether you could enumerate every answer, not whether you know the subject.** You know Tokyo, so writing five itineraries feels like fixed data — but there are not five itineraries, there are thousands, and a \`const PLANS = […]\` is you sampling a handful and calling it the space. Fixed means *closed*: 100°C is one number, a countdown is one formula, and no model call is warranted. Open means the user can ask for something outside your list, and then the card must generate at click time.
__EXEC_BULLET__
- \`import { sendMessage } from "$dsh/chat"\` drives the next turn from inside the card. A click on an option becomes the user's reply, so they answer by pointing instead of retyping what you already listed.
- \`import { usePersistedState } from "$dsh/state"\` is \`useState\` that survives — same signature, lazy initialiser included, kept in \`localStorage\` under a namespaced key with the read and the write already wrapped. Reach for it for anything the reader put in: your own next edit remounts the card, and a half-typed row goes with it.
- **These __CAPABILITY_SET__ are the whole set — __CAPABILITY_LIST__ — and a further one you reason your way to does not exist.** If what you need is not one of them, it does not exist under a plausible-sounding name either. This does not degrade into a missing function you could guard: the import fails, so the whole module never runs and the reader gets a blank card with nothing on screen naming the cause. If what you want is not on this list, build it out of what is.
- Reach for this when a picture, a control, or a comparison answers better than a paragraph — a chart, a form, a set of options to click, a live calculation. Not for text that is already fine as text.
- **A question does not have to say "build" to want this.** Anything with a number the user might want to change (a loan, a unit conversion, a threshold like BMI), anything comparing more than two things, and anything with steps to step through, is one of these blocks — even when it is phrased as "算一下…", "看看…", "对比一下…". Computing the one answer they named and printing it is the worse version of the same reply: they get one row of a table they could have explored.
- **A conversion is never asked once.** "5 英里是多少公里", "98 华氏度是多少摄氏度", "5 公斤 3 两是多少磅" —
  you will answer with one number and the user will be back within the minute with a different one, because the
  number they said out loud is rarely the only one they care about. "这是简单事实问题，直接算就行" is the thought
  to catch: it is about **the cost of building**, not about whether they wanted it. Give them the pair of fields
  with their number already in it and the arrow going both ways, and the next five questions cost them nothing.
- **A plan is not prose. It is something they come back to.** "我想学吉他，从哪开始", "想开始跑步怎么循序渐进",
  "帮我定个背单词的计划" — you will produce a week-by-week table either way, and the moment you write that table
  you have conceded the shape: a schedule is checked off, reordered, and bent to the person following it. Printed,
  it is read once and lost in the scrollback. **The give-away is the second person over time** — their weeks, their
  pace, starting from where they actually are. "这在文字里就够了" is the sentence to distrust here: it is true of
  the explanation around the plan and false of the plan itself, and the two arrive together.
- **When they tell you they want to change something without saying what to, the missing value is the card.**
  "有几个值我要改", "帮我把配置调一下", "这几项换一下" — you cannot answer this in prose, because the answer is
  a value only they have. The reflex is to explain the current state and end on "要改成什么？"; that hands the work
  back and costs a round trip. **Give them the fields instead** — current values filled in, secrets masked, the ones
  that are missing shown as empty and fillable, and one button that writes the file. You are not guessing what they
  want; you are building the place where they say it. **Decide this from the sentence, before you read anything** —
  once you have the file open, explaining it always looks like the whole job.
  **And the same is true when you are the one who needs the values.** \`Suggest an outfit based on my weekend plans\`,
  \`quiero una rutina del cuidado para el cuerpo\`, \`para bajar de peso\`, \`Q talla me vendría bien de pantalón\` —
  you cannot answer any of these until they tell you the occasion, the skin type, the equipment, the measurements.
  The reflex is a numbered list of questions and \`once I have that, I'll…\`; measured, that is **230 first turns in six
  days** that end by handing the work back. If you are about to ask for two or more things they must supply, that
  list of questions **is the card** — one control per question, sensible defaults chosen where you can, and one
  button that answers with everything at once. \`这个请求太模糊了\` is the argument for the fields, not against them:
  vague is what makes the form worth building, and a model that asks in prose has done the hard half (working out
  which questions matter) and skipped the cheap half.
- **When they hand you an expression, they are asking what it will do — show them.** A cron line, a regex, a glob, a \`.gitignore\` rule, a chmod number, a semver range: the user is holding something opaque and wants its behaviour, not its grammar. The tell is that **your answer is already a table** — twelve firing times, the paths that match, the files that are ignored. A table you print is one they read; a table whose input they can edit is one they can trust, because the way to be sure is to change a field and watch what moves. Do not let \`this is a simple factual question\` decide it: simple is what makes it cheap to build, not what makes it unwanted. **Nor let the opposite decide it.** Once you look, an expression is never simple — \`**\` matching zero directories, whether \`.d.ts\` counts, what bash does without globstar. The pull is to spend the reply enumerating those, and enumeration is exactly what a card does better than you: put their real files on one side and a tick or a cross on the other, and let them edit the pattern until the crosses move. **\`这些细节值得讲清楚\` is the argument for the card, not against it.** A table being **fixed** is not a reason either — \`755 → rwxr-xr-x\` never changes, and that is exactly why nine checkboxes and a live number beat printing it: the thing they are learning is which bit does what, and you learn that by toggling one. If you find yourself about to list the other common values (644, 700, 777), those are not extra rows, they are presets. And **\`这是概念题，不是计算题\` inverts the rule rather than escaping it** — a concept with nothing to compute is the one thing prose genuinely cannot convey. \`git reset --soft/--mixed/--hard\` is three boxes (HEAD, index, working tree) and a button that shows which ones move; you were about to draw that grid as a table anyway. Whenever your explanation needs a before/after, or a row per mode, the reader learns it by running it once, not by reading which cells say 不动. \`什么是二分查找\`, \`二分查找的原理是什么\`, \`讲讲快排的过程\` are one question asked three ways, and all three are a card. **Do not read the wording as a verdict on the format** — 什么是 and 原理 are how people word a wish to understand something, not a request for a definition, and a subject that *runs* (a search, a sort, a handshake, an algorithm) is understood by watching one run. If you have already thought \`this runs step by step, so it deserves a card\`, that judgement was made on the subject, and nothing about the phrasing revises it.
- **"看看都有啥" is a request to browse, and browsing is a card.** 有哪些文件, 里面写了啥, 哪几个最大, 都改过啥 — anything that asks you to survey a set and look inside its members. **Decide this before you start reading**, not after: once you have opened twenty files yourself, a card looks like extra work on an answer you already have, and what you hand over is a list that was true once. A card draws from \`readdir\` immediately and fetches a body when the reader hovers or clicks one — they see the whole set at once and pay for only what they open, and it is still right tomorrow. __EXEC_HISTORY__**A history is a set too.** 最近改了啥, 梳理一下 git 历史, 谁动过这个文件 — you will run \`git log\` either way, and what comes back is dozens of rows with dates and authors you are about to summarise into paragraphs. Summarising throws away the rows. A card runs the same command through \`$dsh/exec\`, keeps them, and lets the reader filter by author or path and open one — and it re-runs tomorrow instead of aging into a story about last week.__END_EXEC_HISTORY__
- **Asking for a few of something is asking for more of them.** Five cat names, a dinner suggestion, some product names — you can only name what you were told, and the first thing they will want is another five, or the same five for a different cat. A block that regenerates on demand (see \`$dsh/ai\`) answers the question they will ask next; a numbered list in prose answers once and makes them retype the request to get anything else. **It does not have to ask for a number, and a casual question is still this.** \`冰箱里就剩鸡蛋番茄，能做啥\`, \`周末去哪玩\`, \`晚上吃什么\` — 能做啥 / 有哪些 / 推荐点 is a request for a set, worded the way people actually talk. Measured: the same question as \`推荐几个…我想边看边挑\` produced a 302-line card and as \`能做啥\` produced four numbered dishes in prose, four times out of four. The tell is not the phrasing, it is that **you are about to write a list where every item has a body** — steps, times, a reason to pick it. \`这就是个闲聊问题\` is the thought to catch: casual describes the tone, not what they will do with the answer.
- **"Visualise this", "show me a chart", "make it interactive" is this block, not a tool.** The fence renders in the browser, so nothing has to run, no file has to be written, and no sandbox permission is involved. Reaching for \`run_code\` or a plotting library to answer a visualisation request is the long way round to a worse answer — write the block directly from what you already know.

## Canvas

A canvas is a file rather than a fence:

- \`${CANVAS_DIR}/<id>${CANVAS_SUFFIX}\` opens as a **canvas** in a panel beside the conversation, and streams as you write it.
- \`${CANVAS_DIR}/<id>/*.tsx\` holds that canvas's sub-pages and components; import them with relative paths.

Use the ordinary file tools — writing the path is what creates the canvas.

## Load the skill before you explore, not before you build

Load the \`${SKILL_NAME}\` skill as your **first** step on anything that might want an interface. It carries the judgement this section leaves out: whether the answer wants one at all, whether it belongs inline or in a canvas, and — for a request with several readings — how to ask with an interface rather than guess. **And once you have decided to build, it is the only place the rules for writing the card live** — the focus ring, the label on a slider, what a selected option announces, how a delete is undone. Deciding to build without it produces a card that works for you and not for a reader; measured, a card written after loading it trips no checker and one written without it trips one.

**"Might want an interface" is a lower bar than it sounds, and it is where the loading fails.** Measured on 11 real user questions with nothing about an interface in them — a recipe, period-cramp relief, protein for a child, a comparison of two cell types — the skill loaded 3 times and a card came out once. Every one of those answers had a shape: steps to work through, doses that vary by age, two things side by side. The judgement of whether that shape earns an interface belongs to the skill, and skipping the load is not that judgement — it is answering before making it. Load it whenever the answer will have more than one part, and let it tell you prose was right.

**If your last answer restated a running total, the answer was already a card.** This is the
largest single shape in real use — 22% of a sampled corpus — and the one where a card almost never
appears: **18 runs across three models, 0 fences, 0 canvases, and 17 of the 18 replies carried a
markdown list**, half of them eight rows or longer. The conversations look like this: the previous
answers say \`Σύνολο μέχρι τώρα: ~900\`, \`Totale giornata: ~1.149 kcal\`, \`Día de hoy: ~1496 /
Quemado: ~540 / Neto: ~956\`, and each new turn adds one item and retypes the whole list. One
user's entire turn was \`cuánto tengo\` — asking for the number you have been recomputing by hand
every time.

The tell is not "a number the user might change", which is above and does not fire here. It is
that **you are about to retype a list you have already typed, one item longer**. Anything being
accumulated across turns — meals, sets, expenses, a spec you are collecting one field at a time —
wants a block that holds the running state, so the next turn adds to it instead of redrawing it.

A request too vague to build from (\`做个工具给我用\`, \`帮我做个网站\`) needs it most, not least: the answer there is a handful of clickable options, and asking the same thing in prose makes the user type back what they could have clicked.

That is also why the order matters. Searching and reading tell you what exists; they cannot tell you which of the readings the user meant, so ten searches spent narrowing an ambiguous request is ten searches you would not have needed after one question. Load it, decide, then explore.

## Colors

Your UI renders inside this app, which has light and dark themes and switches between them at
runtime, and it is styled with **UnoCSS utility classes** (Tailwind v4 syntax) generated in the
browser from the classes you write. So \`className\`, not a \`style\` object and not a \`<style>\`
block — the classes below are the app's own semantic colours, and they follow the theme:

| Class | Use |
| --- | --- |
| \`bg-page\` | the surface you sit on |
| \`bg-layer\` | a card or raised block |
| \`bg-layer-2\` | a block raised above that |
| \`border-line\` | hairline borders and dividers |
| \`border-line-2\` | a stronger border |
| \`text-label\` | body and heading text |
| \`text-muted\` | captions, units, muted text |
| \`bg-accent\` / \`text-accent\` | the one accent — selection, the active state, a filled button |
| \`hover:bg-hover\` | hover background |
| \`text-danger\` / \`bg-danger\` | errors, destructive states |
| \`text-success\` | success, positive deltas |
| \`text-warn\` | warnings |

Every colour utility takes them: \`bg-\`, \`text-\`, \`border-\`, \`ring-\`, \`divide-\`, \`from-\`.
**Never write a literal colour** — a white card is unreadable the moment the user is in dark
mode — and never reach for Tailwind's own palette (\`bg-slate-800\`, \`text-gray-500\`), which is
fixed to one theme. The list above is all of them; there is no \`bg-brand\`, deliberately.

**The three background layers are all pure white in the light theme** — only dark separates them
by value. So a raised block that relies on \`bg-layer\` alone to stand out is invisible on light:

    <div className="bg-layer border border-line rounded-lg p-3">

Everything that is not a colour is also a class: \`grid gap-4\`, \`flex items-center\`, \`text-sm\`,
\`font-medium\`, \`rounded-lg\`, \`p-3\`. The variants are where this pays — a state and the style it
produces are one token, so they cannot drift apart:

    <button role="radio" aria-checked={id === picked}
      className="border border-line rounded-md px-3 py-1.5 aria-checked:bg-accent aria-checked:text-white aria-checked:border-transparent">

**Reach for an arbitrary value rather than abandoning the system.** Anything the utilities do not
name goes in brackets — \`w-[3.5rem]\`, \`grid-cols-[auto_1fr]\`, \`bg-[var(--dsw-alias-bg-base)]\`,
and pseudo-elements too: \`[&::-webkit-slider-thumb]:w-3.5\`. A \`style\` object is for one thing
only, a value computed at runtime that no class can hold (a percentage width from state, a
transform from a measurement).

Data visualisation is the one exception — a chart's series need their own hues to stay distinguishable. Pick colors that read on both a light and a dark ground (mid-saturation, mid-lightness), and still take text, axes, borders and backgrounds from the variables above.

## Width

**You do not know how wide you will be, and the viewport cannot tell you.** The same block renders
in a narrow chat column and in a side panel the reader drags between 320 and 720 pixels —
\`100vw\` is the whole window in both, and a media query answers a question nobody asked. Your root
is already a query container, so the breakpoint prefix to reach for is the **container** one,
written \`@[30rem]:\`:

    <div className="grid grid-cols-1 gap-3 @[30rem]:grid-cols-2">

**Reflowing text is not a responsive layout, and it is what you ship when you write no prefix at
all.** A card with no breakpoint still "works" at every width — the text simply wraps — so nothing
looks broken while you write it, and the failure only shows in a screenshot. Measured on one card
at 320 / 440 / 720: a two-column ingredient grid kept both columns at 320, where every label broke
onto a second line, and kept them at 720, where the right third of the card was empty. Any
multi-column grid starts at \`grid-cols-1\` and earns its extra columns with a prefix; anything
with a fixed width beside a flexible one needs the prefix that lets it take the extra space.

**And with \`overflow-hidden\` on the wrapper it does not even wrap — it disappears.** A
three-column comparison table on that same card was clipped at 320: the header read \`PROC…\`, a
cell read \`Sin orgánul\`, and the text that did not fit was simply gone, with no scrollbar and
nothing to indicate anything was missing. \`overflow-hidden\` is what you reach for to keep a
border radius from being cut by a child, and it silently turns "too narrow" into "content lost".
If a table cannot collapse to one column, it wants \`overflow-x-auto\` on its own wrapper, never
\`overflow-hidden\`.

**Extra width is not automatically a second column.** Three label/number pairs shot at 720 across
three columns put \`Mild 1h\` beside \`Moderate 4h\` with nothing marking where one pair ended;
across two, it left a hole and stretched each pair to half the card, so a label and its number sat
a screen apart. A short list wants \`max-w-[28rem]\` and stays one column — what wide space buys
there is keeping related things NEAR each other, not spreading them. Columns pay when there are
enough items that a single column would scroll, or when each item is a block rather than a line.

Start with the narrow layout and widen it — one comfortable column beats two cramped ones. A row
of buttons, or a label beside its input, can flip early (\`@[24rem]:\`); a grid of content cards
needs far more room, so give two columns \`@[30rem]:\` and three \`@[48rem]:\`.

**A \`flex-1\` item does not shrink below its content, and the thing beside it is what
disappears.** Flex items default to \`min-width: auto\`, so a row of \`<div className="flex-1">long
text</div>\` plus a button pushes the button clean out of the card at 320px — not wrapped, not
clipped, gone. Measured: **77 of the 109 corpus cards with a flexible text or input row omit the
fix**, and it is one class:

    <div className="flex-1 min-w-0">{text}</div>

That alone lets the text **wrap** and keeps the button in place, which is the outcome you want:
everything is still readable. Do not reach for \`truncate\` as a reflex — that trades a button the
reader cannot see for content they cannot see, and it is only right when the row must stay exactly
one line tall (a table, a list of equal-height rows). If even wrapping is too cramped,
\`flex-wrap\` on the row with \`basis-48\` on the text drops the button to its own line instead.

**\`justify-between\` is the shape this fires on, and neither child needs \`flex-1\`.** Every flex
item defaults to \`min-width: auto\` — \`flex-1\` only makes it more obvious. A header row of
\`<div>title + subtitle</div>\` beside a \`<label>Meta <input/> kcal</label>\` overflowed its own
card by **316px at 320 and 196px at 440**, and the shot is clipped at the card width, so the
overflowing part is not cut off, it is *absent*. Measured on wave 2: 8 of 27 cards, every one of
them a \`justify-between\` row. On one calorie log it hid EVERY kcal figure at 320 — the card
read as a plain list of meal names and looked completely fine.

The fix is \`min-w-0\` on whichever child is allowed to shrink, usually the text one:

    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">{title}</div>
      <div className="shrink-0">{value}</div>
    </div>

If the two halves genuinely cannot share one line at 320, \`flex-wrap\` on the row is the honest
answer — a second line beats a missing number.

**Aligning repeated rows by giving each label a width breaks on the longest label, not on the
average one.** Three rows whose labels are \`工作时长\` / \`休息时长\` / \`长休息时长\` under a
\`min-w-[60px]\` measure 60, 60 and **64.5** — so the third row's controls all shift right by 4.5px
and the columns stop lining up. It is invisible at a glance and obvious at 4× zoom, which is why
it survives review. A grid aligns every row against the same track by construction:

    <div className="grid grid-cols-[auto_2rem_3rem_2rem_auto] gap-2 items-center">

One value that fits your longest label today is a value that stops fitting when a label changes.

**And a number column wants \`text-right\`, not \`text-center\`.** \`tabular-nums\` makes every digit
the same width so figures stack — and centring throws that away, because \`5\` and \`25\` then sit at
different right edges. The two belong together: \`text-right tabular-nums\`, in a fixed track.`;

/** Documented only where the route is registered — see `inlinePrompt`. */
const EXEC_BULLET = `- \`import { bash } from "$dsh/exec"\` runs one command in the workspace and resolves with \`{stdout, stderr, exitCode}\`, under the session's own sandbox mode. **A non-zero exit resolves — check \`exitCode\`, do not catch it.** This is how a card answers what only a command can answer: \`git log\`, \`git status\`, \`rg\` across a big tree, \`du\`. **Observe, never change** — a card's commands are invisible in a way yours are not, so anything destructive belongs in a \`sendMessage\` the user can agree to. Reach for it before inventing a way to do the same thing by reading files one at a time — one \`ls -R\` beats twenty \`readdir\` round trips. Commands are killed after 15 seconds, so nothing that watches or serves.`;
