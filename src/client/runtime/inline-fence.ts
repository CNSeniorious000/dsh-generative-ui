/**
 * Renders ```` ```ui4a/tsx ```` blocks in assistant prose live, in place, between the
 * surrounding paragraphs — the ui4a-playground inline contract.
 *
 * Two sources, each doing what only it can:
 *
 * - **The session snapshot owns the code.** The host's markdown renderer withholds a
 *   fence's info string until the closing fence arrives, so a DOM-only implementation
 *   cannot tell a half-written ui4a block from any other code block, and can only claim
 *   it after the model has stopped typing. The raw assistant text has the opening fence
 *   from its very first token, so that is where the code and its language come from.
 * - **The DOM owns the position.** There is no slot for a markdown code block, so the
 *   rendered block is what tells us where in the prose to mount. `md-code-block` is a
 *   hard-coded class on the host's CodeBlock wrapper.
 *
 * Blocks are matched to segments by content (a rendered block's text is a prefix of, or
 * equal to, its segment's code), not by order, so unrelated code blocks in the same reply
 * are left alone.
 *
 * The claimed block is hidden rather than removed: it belongs to the host's React tree,
 * and detaching a node React still owns invites a NotFoundError on its next commit.
 */
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import type { Ui4aSegment } from "./segments.ts";
import { observeTranscript } from "./observe.ts";

const CLAIMED = "data-ui4a-claimed";
const MOUNT = "data-ui4a-mount";

type Claim = { block: HTMLElement; mount: HTMLElement; root: Root; code: string; complete: boolean; rendered: string; painted: MutationObserver | null };

/**
 * Whether the card has actually painted something a reader can see.
 *
 * **Compiling is not the same as having something to look at.** Mid-stream the default
 * export usually exists while the body is still an empty shell, so hiding the source block
 * at claim time leaves a blank gap that fills in with a pop seconds later — and the source
 * was sitting right there the whole time. Text or an svg (icons and charts carry no text)
 * is the signal; a wrapper div with layout classes is not.
 */
const hasPainted = (mount: HTMLElement) => (mount.textContent ?? "").trim() !== "" || mount.querySelector("svg") !== null;

/** The block's source. `pre` when the grammar was unknown, the highlighted div otherwise. */
const codeOf = (block: HTMLElement) => block.querySelector("pre")?.textContent ?? "";

/** CodeBlock trims one trailing newline for display, so compare on trimmed ends. */
const sameCode = (a: string, b: string) => a.trimEnd() === b.trimEnd();

/**
 * The segment a rendered block belongs to.
 *
 * Mid-stream the block shows a prefix of its segment; once settled the two are equal.
 */
const matchSegment = (segments: readonly Ui4aSegment[], rendered: string) => segments.find((segment) => sameCode(segment.code, rendered) || segment.code.startsWith(rendered));

export type InlineFenceOptions = {
  /** Every ui4a segment currently in the transcript, in document order. */
  segments: () => readonly Ui4aSegment[];
  render: (props: { code: string; streaming: boolean }) => ReactElement;
  scope?: HTMLElement;
};

export function claimInlineFences({ segments, render, scope }: InlineFenceOptions): () => void {
  const claims = new Map<HTMLElement, Claim>();
  const root = scope ?? document.body;

  const release = (claim: Claim, restore: boolean) => {
    claim.painted?.disconnect();
    claim.root.unmount();
    claim.mount.remove();
    if (restore && claim.block.isConnected) {
      claim.block.style.display = "";
      claim.block.removeAttribute(CLAIMED);
    }
    claims.delete(claim.block);
  };

  const sweep = () => {
    const current = segments();

    for (const block of root.querySelectorAll<HTMLElement>(`.md-code-block:not([${CLAIMED}])`)) {
      const code = codeOf(block);
      if (code === "") continue;
      // A streaming block's rendered text is a prefix of its segment; a settled one equals it.
      const segment = matchSegment(current, code);
      if (segment === undefined) continue;
      block.setAttribute(CLAIMED, "");
      const mount = document.createElement("div");
      mount.setAttribute(MOUNT, "");
      block.parentElement?.insertBefore(mount, block.nextSibling);
      const claim: Claim = { block, mount, root: createRoot(mount), code: "", complete: false, rendered: "", painted: null };
      // The source stays visible until the card paints. Checked at most once per frame and
      // torn down the moment it fires: a streaming card mutates thousands of times, and
      // `textContent` walks the whole subtree, so a per-mutation check would be
      // O(mutations x subtree). The cost only exists during the gap it closes.
      let queued = 0;
      claim.painted = new MutationObserver(() => {
        if (queued !== 0) return;
        queued = requestAnimationFrame(() => {
          queued = 0;
          if (!hasPainted(mount)) return;
          claim.painted?.disconnect();
          claim.painted = null;
          if (claim.block.isConnected) claim.block.style.display = "none";
        });
      });
      claim.painted.observe(mount, { childList: true, subtree: true, characterData: true });
      claims.set(block, claim);
    }

    for (const claim of claims.values()) {
      if (!claim.block.isConnected) {
        release(claim, false);
        continue;
      }
      const rendered = codeOf(claim.block);
      // The block's own text is what locates its segment, so an unchanged block cannot
      // have changed its match — skip the scan rather than re-run it every frame.
      if (rendered === claim.rendered && claim.code !== "") continue;
      claim.rendered = rendered;
      const segment = matchSegment(current, rendered);
      // The snapshot is authoritative while it still describes this block: mid-stream its
      // code runs ahead of what markdown has painted. Once it stops describing it — an
      // older page dropped out of the loaded window — the last good frame stands, because
      // re-deriving from the hidden block would hand the renderer a truncated prefix and
      // blank a card that was already complete.
      //
      // Unless the block stopped being this card's at all: React reconciles `.md-code-block`
      // wrappers positionally, so a re-render can drop unrelated content into the very node
      // we hid. Its text is then no longer a prefix of what we rendered, and holding the
      // claim would leave a stale card on screen with the real block invisible behind it.
      if (segment === undefined) {
        if (claim.code.startsWith(rendered)) continue;
        release(claim, true);
        continue;
      }
      const { code, complete } = segment;
      if (code === claim.code && complete === claim.complete) continue;
      claim.code = code;
      claim.complete = complete;
      claim.root.render(render({ code, streaming: !complete }));
    }
  };

  const stop = observeTranscript(sweep);

  return () => {
    stop();
    for (const claim of claims.values()) release(claim, true);
  };
}
