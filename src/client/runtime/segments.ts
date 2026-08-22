/**
 * Splits assistant prose into markdown and inline-ui4a segments.
 *
 * Ported from ui4a-playground/src/components/chat/segments.ts. We only consume the ui4a
 * side — the host renders the markdown — but the parser must still walk the whole text,
 * because a fence's position depends on everything before it.
 */
import { FENCE_LANG } from "../../contract.ts";

export type Ui4aSegment = { code: string; complete: boolean };

/**
 * Opening fence. Both tolerances here were measured; do not tighten them.
 *
 * - **The fence need not start a line.** The prompt says "on its own line", but the model
 *   routinely continues it straight after a sentence (`……完整元素周期表。\`\`\`\`ui4a/tsx`).
 *   Anchoring with `^` drops that whole reply back to markdown, and hundreds of lines of
 *   TSX get pasted into the conversation as prose — far worse than a loose match. So the
 *   only requirement is that a backtick does not precede it (which would cut a longer
 *   fence in half).
 * - **No newline is required after the language.** Same cause: the model glues the first
 *   line of code onto the fence line. `[^\n]*` was there for meta like `title=`, and it
 *   swallows that code too — hence `inlineCode` below hands it back.
 */
const FENCE = new RegExp(String.raw`(?<!\x60)(\x60{3,})${FENCE_LANG.replace("/", "\\/")}([^\n]*)(\n|$)`);

/**
 * Where the closing fence is, or `-1`.
 *
 * Try the line-anchored form first (nearly every case) and only then scan for an inline
 * one. Running the permissive regex alone would make the lookbehind re-test at every
 * character — and the closing fence is absent for the whole streaming phase, so that is
 * the most expensive possible scan of the whole body, once per frame (measured on a 25KB
 * body: 1µs → 121µs).
 */
function findClose(body: string, fence: string): number {
  const anchored = body.indexOf(`\n${fence}`);
  if (anchored >= 0 && /^[^\S\n]*(?:\n|$)/.test(body.slice(anchored + 1 + fence.length)) && body[anchored + 1 + fence.length] !== "`") return anchored + 1;
  for (let at = body.indexOf(fence); at >= 0; at = body.indexOf(fence, at + 1)) {
    if (body[at - 1] === "`" || body[at + fence.length] === "`") continue;
    if (/^[^\S\n]*(?:\n|$)/.test(body.slice(at + fence.length))) return at;
  }
  // A closer SHORTER than the opener. Markdown says this does not close the fence, and the
  // model writes it anyway: 18 of 385 openers in the corpus are closed by a shorter run
  // (`open=6 close=4` nine times), and each one is a card that streams forever because nothing
  // ever ends it. Accepting any standalone run of three-plus rescues 16 and cuts 0 short — the
  // single card where a shorter run precedes the matching one had closed itself twice, so
  // cutting at the first is the same body. Tried last so an exact match always wins.
  const short = /(?:^|\n)[^\S\n]*(`{3,})[^\S\n]*(?:\n|$)/.exec(body);
  return short === undefined || short === null ? -1 : short.index + (short[0].startsWith("\n") ? 1 : 0);
}

/**
 * Tool-call markup the model leaked into its own prose. The reply ends mid-fence with the
 * closing tags glued to the last line of TSX, so the body reaches the compiler with those tags
 * in it and fails to parse — the whole card is lost, not just the closing fence.
 *
 * Two spellings, and the rarer one was found first: `</parameter></invoke>` appeared once in
 * the corpus, while the model's own `</｜｜DSML｜｜parameter>` form accounts for three more and
 * was invisible to a regex written from that single sample. Those full-width bars are U+FF5C,
 * not ASCII `|`. Only stripped at the very end of an unterminated body, where nothing
 * legitimate can follow.
 */
const TOOL_CALL_MARKUP = /\n?(?:<\/(?:antml:|｜｜DSML｜｜)?(?:parameter|invoke|tool_calls)>\s*)+$/;

/**
 * The prompt asks for four backticks — generated TSX contains triple-backtick strings often
 * enough that a triple-backtick fence would be closed early by its own body. Three or more
 * are accepted anyway: models do not always comply, and one backtick short should not
 * demote the whole block to a plain code listing. The closing fence matches the opening
 * length, so the four-backtick form still tolerates triples inside.
 *
 * An unterminated fence still yields a segment with `complete: false` — that is exactly the
 * frame a streaming reply is in, and rendering it is the entire point.
 */
const CODE_LINE = /^(import|export|const|function|type|interface|let|\/\/)\b/;
const FENCE_META = /^[\w-]+=/;

export function parseUi4aSegments(text: string): Ui4aSegment[] {
  const segments: Ui4aSegment[] = [];
  let rest = text;
  while (true) {
    const open = FENCE.exec(rest);
    if (open === null) return segments;
    // Leftovers after `ui4a/tsx` on the fence line: normally empty (or meta like `title=`),
    // but the model sometimes puts the first line of code there. If it looks like code,
    // hand it back as the body's first line rather than dropping it.
    const trailing = open[2].trim();
    const bodyStart = open.index + open[0].length;
    // A fence opener the model is *talking about* rather than opening. Measured: 19 of 405
    // openers in the corpus are prose, and 14 of them put the sentence right after the
    // language (`\`\`\`\`ui4a/tsx\`\`\`\` 块，原地渲染成…`). Anything that is not code and not
    // `key=value` meta is one; skipping the whole opener costs 0 of 390 real cards.
    if (trailing !== "" && !CODE_LINE.test(trailing) && !FENCE_META.test(trailing)) { rest = rest.slice(bodyStart); continue; }
    const inlineCode = CODE_LINE.test(trailing) ? `${trailing}\n` : "";
    const closeIndex = findClose(rest.slice(bodyStart), open[1]);
    if (closeIndex === -1) {
      segments.push({ code: (inlineCode + rest.slice(bodyStart)).replace(TOOL_CALL_MARKUP, ""), complete: false });
      return segments;
    }
    segments.push({ code: inlineCode + rest.slice(bodyStart, bodyStart + closeIndex), complete: true });
    rest = rest.slice(bodyStart + closeIndex).replace(new RegExp(String.raw`^${open[1]}[^\n]*\n?`), "");
  }
}
