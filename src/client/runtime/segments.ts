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
  return -1;
}

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
    const inlineCode = /^(import|export|const|function|type|interface|let|\/\/)\b/.test(trailing) ? `${trailing}\n` : "";
    const bodyStart = open.index + open[0].length;
    const closeIndex = findClose(rest.slice(bodyStart), open[1]);
    if (closeIndex === -1) {
      segments.push({ code: inlineCode + rest.slice(bodyStart), complete: false });
      return segments;
    }
    segments.push({ code: inlineCode + rest.slice(bodyStart, bodyStart + closeIndex), complete: true });
    rest = rest.slice(bodyStart + closeIndex).replace(new RegExp(String.raw`^${open[1]}[^\n]*\n?`), "");
  }
}
