/**
 * Splits assistant prose into markdown and inline-ui4a segments.
 *
 * Ported from ui4a-playground/src/components/chat/segments.ts. We only consume the ui4a
 * side — the host renders the markdown — but the parser must still walk the whole text,
 * because a fence's position depends on everything before it.
 */
import { FENCE_LANG } from "../../contract.ts";

export type Ui4aSegment = { code: string; complete: boolean };

const FENCE = new RegExp(String.raw`^ {0,3}(\x60{3,})${FENCE_LANG.replace("/", "\\/")}[^\n]*\n`, "m");

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
    const bodyStart = open.index + open[0].length;
    const closeIndex = rest.slice(bodyStart).search(new RegExp(String.raw`^ {0,3}${open[1]}\s*$`, "m"));
    if (closeIndex === -1) {
      segments.push({ code: rest.slice(bodyStart), complete: false });
      return segments;
    }
    segments.push({ code: rest.slice(bodyStart, bodyStart + closeIndex), complete: true });
    rest = rest.slice(bodyStart + closeIndex).replace(new RegExp(String.raw`^ {0,3}${open[1]}[^\n]*\n?`), "");
  }
}
