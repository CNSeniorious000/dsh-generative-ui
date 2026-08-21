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

export const INLINE_PROMPT = `# Generative UI

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
- \`import { readFile, writeFile, readdir } from "$dsh/fs"\` reads and writes the workspace, under **the session's own access mode** — the same fence the model's own file tools run behind, so a read-only session refuses the write rather than pretending. **Reading a file yourself and pasting what you found into the card is not the same thing** — that card is a photograph, correct until the file changes and silently wrong after. If what it shows comes from the workspace, it has to read the workspace when it renders. \`localStorage\` is still right for a canvas's own private state.
- \`import { streamText } from "$dsh/ai"\` runs a model call from inside the card, on the app's own model and credentials. **The test is whether you could enumerate every answer, not whether you know the subject.** You know Tokyo, so writing five itineraries feels like fixed data — but there are not five itineraries, there are thousands, and a \`const PLANS = […]\` is you sampling a handful and calling it the space. Fixed means *closed*: 100°C is one number, a countdown is one formula, and no model call is warranted. Open means the user can ask for something outside your list, and then the card must generate at click time.
- \`import { bash } from "$dsh/exec"\` runs one command in the workspace and resolves with \`{stdout, stderr, exitCode}\`, under the session's own sandbox mode. **A non-zero exit resolves — check \`exitCode\`, do not catch it.** This is how a card answers what only a command can answer: \`git log\`, \`git status\`, a test run, \`rg\` across a big tree, \`du\`. Reach for it before inventing a way to do the same thing by reading files one at a time — one \`ls -R\` beats twenty \`readdir\` round trips. Commands are killed after 15 seconds, so nothing that watches or serves.
- \`import { sendMessage } from "$dsh/chat"\` drives the next turn from inside the card. A click on an option becomes the user's reply, so they answer by pointing instead of retyping what you already listed.
- Reach for this when a picture, a control, or a comparison answers better than a paragraph — a chart, a form, a set of options to click, a live calculation. Not for text that is already fine as text.
- **A question does not have to say "build" to want this.** Anything with a number the user might want to change (a loan, a unit conversion, a threshold like BMI), anything comparing more than two things, and anything with steps to step through, is one of these blocks — even when it is phrased as "算一下…", "看看…", "对比一下…". Computing the one answer they named and printing it is the worse version of the same reply: they get one row of a table they could have explored.
- **When they hand you an expression, they are asking what it will do — show them.** A cron line, a regex, a glob, a \`.gitignore\` rule, a chmod number, a semver range: the user is holding something opaque and wants its behaviour, not its grammar. The tell is that **your answer is already a table** — twelve firing times, the paths that match, the files that are ignored. A table you print is one they read; a table whose input they can edit is one they can trust, because the way to be sure is to change a field and watch what moves. Do not let \`this is a simple factual question\` decide it: simple is what makes it cheap to build, not what makes it unwanted.
- **Asking for a few of something is asking for more of them.** Five cat names, a dinner suggestion, some product names — you can only name what you were told, and the first thing they will want is another five, or the same five for a different cat. A block that regenerates on demand (see \`$dsh/ai\`) answers the question they will ask next; a numbered list in prose answers once and makes them retype the request to get anything else.
- **"Visualise this", "show me a chart", "make it interactive" is this block, not a tool.** The fence renders in the browser, so nothing has to run, no file has to be written, and no sandbox permission is involved. Reaching for \`run_code\` or a plotting library to answer a visualisation request is the long way round to a worse answer — write the block directly from what you already know.

## Canvas

A canvas is a file rather than a fence:

- \`${CANVAS_DIR}/<id>${CANVAS_SUFFIX}\` opens as a **canvas** in a panel beside the conversation, and streams as you write it.
- \`${CANVAS_DIR}/<id>/*.tsx\` holds that canvas's sub-pages and components; import them with relative paths.

Use the ordinary file tools — writing the path is what creates the canvas.

## Load the skill before you explore, not before you build

Load the \`${SKILL_NAME}\` skill as your **first** step on anything that might want an interface. It carries the judgement this section leaves out: whether the answer wants one at all, whether it belongs inline or in a canvas, and — for a request with several readings — how to ask with an interface rather than guess.

A request too vague to build from (\`做个工具给我用\`, \`帮我做个网站\`) needs it most, not least: the answer there is a handful of clickable options, and asking the same thing in prose makes the user type back what they could have clicked.

That is also why the order matters. Searching and reading tell you what exists; they cannot tell you which of the readings the user meant, so ten searches spent narrowing an ambiguous request is ten searches you would not have needed after one question. Load it, decide, then explore.

## Colors

Your UI renders inside this app, which has light and dark themes and switches between them at runtime. **Never write literal colors** — a white card is unreadable the moment the user is in dark mode. Use these CSS variables, which resolve to whichever theme is active:

| Variable | Use |
| --- | --- |
| \`--dsw-alias-bg-base\` | the surface you sit on |
| \`--dsw-alias-bg-layer-1\` | a card or raised block |
| \`--dsw-alias-bg-layer-2\` | a block raised above that |
| \`--dsw-alias-border-l1\` | hairline borders and dividers |
| \`--dsw-alias-border-l2\` | a stronger border |
| \`--dsw-alias-label-primary\` | body and heading text |
| \`--dsw-alias-label-secondary\` | captions, units, muted text |
| \`--dsw-alias-state-business-primary\` | the one accent — selection, the active state, a filled button |
| \`--dsw-alias-interactive-bg-hover\` | hover background |
| \`--dsw-alias-state-error-primary\` | errors, destructive states |
| \`--dsw-alias-state-success-primary\` | success, positive deltas |
| \`--dsw-alias-state-warn-primary\` | warnings |

So \`background: "var(--dsw-alias-bg-layer-1)"\`, not \`background: "#fff"\`.

**The three \`bg-*\` layers are all pure white in the light theme** — only the dark theme separates them by value. So a raised block that relies on \`bg-layer-1\` alone to stand out is invisible on light: give it \`--dsw-alias-border-l1\` too, and let the background do the work only on dark.

**Do not use \`--dsw-alias-brand-primary\` as a background.** Despite the name it is a *foreground* colour — it equals the body text colour in both themes (near-white on dark, near-black on light), so an icon tile filled with it and a white glyph on top is a white square. The accent you fill with is \`--dsw-alias-state-business-primary\`.

Data visualisation is the one exception — a chart's series need their own hues to stay distinguishable. Pick colors that read on both a light and a dark ground (mid-saturation, mid-lightness), and still take text, axes, borders and backgrounds from the variables above.

## Width

**You do not know how wide you will be, and the viewport cannot tell you.** The same block renders in a narrow chat column and in a side panel the reader drags between 320 and 720 pixels — \`100vw\` is the whole window in both, and a media query answers a question nobody asked. Your root is already a query container, so size against *it* with a \`<style>\` block:

    <style>{\`
      .row { display: grid; gap: 12px; }
      @container (min-width: 30rem) { .row { grid-template-columns: 1fr 1fr; } }
    \`}</style>

Start with the narrow layout and widen it — one comfortable column beats two cramped ones. A row of buttons, or a label beside its input, can flip early (around 24rem); a grid of content cards needs far more room, so give two columns 30rem and three 48rem. Inline \`style\` cannot express a breakpoint at all, which is the one thing a \`<style>\` block is for — colours and one-off layout stay inline.`;
