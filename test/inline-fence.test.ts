/**
 * `claimInlineFences` — the claim, the reclaim, and the release.
 *
 * 11 of this module's 14 conditions had no test that would notice them going, including every
 * branch that decides whether a claimed block stays claimed. They are the ones that matter: a
 * wrong answer leaves a stale card on screen with the real block hidden behind it, which is the
 * failure a reader cannot work around.
 *
 * No DOM library is installed, so the blocks are hand-built the way `canvas-sweep.test.ts`
 * builds the panel's frame — the module only touches a handful of members, and a fake keeps the
 * assertions on what was rendered rather than on markup.
 */
import { restoreGlobals } from "./globals.ts";
import { resetTranscriptObservers } from "../src/client/runtime/observe.ts";
import { afterEach, beforeEach, expect, mock, test } from "bun:test";

let painted: { code: string; streaming: boolean }[] = [];
/** The `mount` each render was handed — `report-error` gates on it, so it has to be the real node. */
let renderedLast: (() => boolean)[] = [];
let previews: { code: string; lang?: string }[] = [];
let unmounts = 0;
let frames: (() => void)[] = [];
let blocks: any[] = [];
let observers: { target: any; fire: () => void }[] = [];
let intersections: { target: any; enter: () => void }[] = [];

const paint = () => {
  const due = frames;
  frames = [];
  for (const cb of due) cb();
};

/** A `.md-code-block` wrapper with a `<pre>` inside, plus the members the module touches. */
const makeBlock = (text: string, top = 0) => {
  const pre = { textContent: text };
  const block: any = {
    attrs: {} as Record<string, string>,
    style: {},
    isConnected: true,
    // Where this block sits relative to the viewport. `defer` measures it, so a test that wants
    // an offscreen block sets `top` far below `innerHeight`.
    getBoundingClientRect: () => ({ top, bottom: top + 200, height: 200, width: 300 }),
    children: [] as any[],
    querySelector: (sel: string) => (sel === "pre" ? pre : null),
    // `sweep` skips blocks inside our own preview/mount wrappers — see the comment there. A host
    // block has no such ancestor; `makeOurBlock` below is the one that does.
    closest: () => null,
    setAttribute(k: string, v: string) {
      this.attrs[k] = v;
    },
    removeAttribute(k: string) {
      delete this.attrs[k];
    },
    setText(next: string) {
      pre.textContent = next;
    },
  };
  block.parentElement = { insertBefore: (node: any) => block.children.push(node) };
  blocks.push(block);
  return block;
};

// Restore after EACH test: the stub below is narrower than other files' (a `document` with
// no `querySelectorAll`), and bun shares one global per RUN. Leaving it installed breaks the
// next file, which looks like a bug there. `./globals.ts` holds the pre-stub originals.
afterEach(restoreGlobals);

beforeEach(() => {
  // Another file's leaked sweep would run against ITS captured root, which no longer has a
  // `querySelectorAll` — one stale listener turns every test here red.
  resetTranscriptObservers();
  painted = [];
  renderedLast = [];
  previews = [];
  unmounts = 0;
  frames = [];
  blocks = [];
  observers = [];
  intersections = [];
  (globalThis as any).requestAnimationFrame = (cb: () => void) => {
    frames.push(cb);
    return frames.length;
  };
  (globalThis as any).cancelAnimationFrame = () => {};
  (globalThis as any).innerHeight = 800;
  (globalThis as any).IntersectionObserver = class {
    constructor(private cb: (entries: { target: any; isIntersecting: boolean }[]) => void) {}
    observe(target: any) {
      intersections.push({ target, enter: () => this.cb([{ target, isIntersecting: true }]) });
    }
    unobserve(target: any) {
      intersections = intersections.filter((i) => i.target !== target);
    }
    disconnect() {
      intersections = [];
    }
  };
  (globalThis as any).MutationObserver = class {
    constructor(private cb: () => void) {}
    observe(target: any) {
      observers.push({ target, fire: () => this.cb() });
    }
    disconnect() {
      observers = observers.filter((o) => o.fire !== this.cb);
    }
  };
  // `attrs` matters now: the module mounts TWO roots per claim — the card, and a source preview
  // that stands in for the host's own block while the card compiles — and a test that cannot tell
  // them apart reads one `render` as the other.
  const mount = () => {
    const el: any = { tag: "DIV", textContent: "", attrs: {} as Record<string, string>, remove() {}, querySelectorAll: () => [] };
    el.setAttribute = (k: string, v: string) => {
      el.attrs[k] = v;
    };
    return el;
  };
  (globalThis as any).document = {
    createElement: mount,
    body: { querySelectorAll: (sel: string) => (sel.includes("md-code-block") ? blocks.filter((b) => b.attrs["data-ui4a-claimed"] === undefined) : []) },
  };
});

// Every started sweep is stopped after the test, whether or not it reached its own `stop()`.
// A failing assertion used to leave the module-level listener in `observe.ts` registered, so
// the NEXT test's `paint()` ran a sweep against a torn-down document — one real failure then
// cascaded into a dozen that had nothing wrong with them.
let started: (() => void)[] = [];
afterEach(() => {
  for (const stop of started.splice(0))
    try {
      stop();
    } catch {
      /* already stopped */
    }
});

const start = async (segments: () => any[]) => {
  mock.module("react-dom/client", () => ({
    createRoot: (node: any) => ({
      render: (el: any) => {
        (node.attrs?.["data-ui4a-preview"] === undefined ? painted : previews).push(el.props);
        node.textContent = el.props.code;
      },
      unmount() {
        unmounts += 1;
      },
    }),
  }));
  const { claimInlineFences } = await import(`../src/client/runtime/inline-fence.ts?${Math.random()}`);
  const { scheduleSweep } = await import("../src/client/runtime/observe.ts");
  const stop = claimInlineFences({
    segments,
    render: ({ code, streaming, last }: any) => {
      renderedLast.push(last);
      return { props: { code, streaming } };
    },
  });
  started.push(stop);
  paint();
  return {
    stop,
    again: () => {
      scheduleSweep();
      paint();
    },
  };
};

const segment = (code: string, complete = true) => ({ code, complete, lang: "ui4a/tsx" });

test("a block whose text matches a segment is claimed and rendered", async () => {
  makeBlock("export default () => <div />");
  const { stop } = await start(() => [segment("export default () => <div />")]);
  expect(painted).toEqual([{ code: "export default () => <div />", streaming: false }]);
  expect(blocks[0].attrs["data-ui4a-claimed"]).toBe("");
  stop();
});

test("an unrelated code block is left alone", async () => {
  makeBlock("print('hi')");
  const { stop } = await start(() => [segment("export default () => <div />")]);
  expect(painted).toEqual([]);
  expect(blocks[0].attrs["data-ui4a-claimed"]).toBeUndefined();
  stop();
});

// An empty block has nothing to match on, and matching it against a segment's empty prefix
// would claim every code block in the reply.
test("an empty block is not claimed", async () => {
  makeBlock("");
  const { stop } = await start(() => [segment("")]);
  expect(painted).toEqual([]);
  stop();
});

test("a growing block re-renders with the segment's newer code", async () => {
  const block = makeBlock("export default");
  let code = "export default";
  const { stop, again } = await start(() => [segment(code, false)]);
  expect(painted.at(-1)).toEqual({ code: "export default", streaming: true });
  code = "export default () => <div />";
  block.setText("export default ()");
  again();
  expect(painted.at(-1)).toEqual({ code, streaming: true });
  stop();
});

// The stream ending is a re-render even though the code did not change: `streaming` flips.
test("completion re-renders a block whose code stopped changing", async () => {
  makeBlock("export default () => <div />");
  let complete = false;
  const { stop, again } = await start(() => [segment("export default () => <div />", complete)]);
  const before = painted.length;
  again();
  expect(painted.length).toBe(before);
  complete = true;
  again();
  expect(painted.at(-1)).toEqual({ code: "export default () => <div />", streaming: false });
  stop();
});

/**
 * There is always source on screen until the card paints — never a blank gap.
 *
 * The rule §3.5 records is that hiding at claim time leaves nothing to look at for however long
 * the card takes to have a body. That still holds; what changed is WHICH source is shown. The
 * host's own block is hidden immediately and replaced by one we render, for two measured reasons:
 * its markdown parser truncates `ui4a/tsx` at the slash, so `ui4a` reaches shiki, matches no
 * grammar, and the code renders unhighlighted; and a 300-line card streams for over a minute with
 * every line of it on screen. Ours passes `lang="tsx"` and is capped.
 *
 * So the invariant to protect is not "the block is visible" — it is "a preview exists until the
 * card paints, and is gone afterwards".
 */
test("a highlighted source preview stands in until the card paints", async () => {
  const block = makeBlock("export default () => <div />");
  const { stop } = await start(() => [segment("export default () => <div />")]);
  // claimed: the host's block is out, ours is in, and it asks for the grammar the host could not
  expect(block.style.display).toBe("none");
  expect(previews).toHaveLength(1);
  expect(previews[0]?.lang).toBe("tsx");
  expect(previews[0]?.code).toBe("export default () => <div />");
  observers.at(-1)?.fire();
  paint();
  // painted: the preview is torn down, and the host's block stays hidden behind the card
  await Promise.resolve();
  expect(unmounts).toBe(1);
  expect(block.style.display).toBe("none");
  stop();
});

/**
 * React reconciles `.md-code-block` wrappers positionally, so a re-render can drop unrelated
 * content into the node we hid. Its text stops being a prefix of what we rendered, and holding
 * the claim would leave a stale card over an invisible block.
 */
test("a block that stops being this card's is released and made visible again", async () => {
  const block = makeBlock("export default () => <div />");
  let segments = [segment("export default () => <div />")];
  const { stop, again } = await start(() => segments);
  observers.at(-1)?.fire();
  paint();
  expect(block.style.display).toBe("none");
  segments = [];
  block.setText("something else entirely");
  again();
  expect(block.style.display).toBe("");
  expect(block.attrs["data-ui4a-claimed"]).toBeUndefined();
  expect(unmounts).toBe(1);
  stop();
});

// The snapshot dropping the segment is not the same as the block changing hands: an older page
// scrolling out of the loaded window must leave the last good frame standing.
test("a segment falling out of the snapshot keeps the card that was already rendered", async () => {
  const block = makeBlock("export default () =>");
  let segments = [segment("export default () => <div />")];
  const { stop, again } = await start(() => segments);
  expect(painted).toHaveLength(1);
  segments = [];
  again();
  expect(unmounts).toBe(0);
  expect(block.attrs["data-ui4a-claimed"]).toBe("");
  stop();
});

// A block React removed outright is released without touching it — its style and attributes
// belong to a node that is no longer in the document.
test("a detached block is released without being restored", async () => {
  const block = makeBlock("export default () => <div />");
  const { stop, again } = await start(() => [segment("export default () => <div />")]);
  block.isConnected = false;
  again();
  expect(unmounts).toBe(1);
  expect(block.attrs["data-ui4a-claimed"]).toBe("");
  stop();
});

/**
 * Disposal gives every claimed block back.
 *
 * `stop()` is called nine times above and asserted on zero of them. What it must do is undo the
 * hiding: the blocks belong to the host's React tree, so a claim left behind is a source block
 * permanently `display: none` with an unmounted card sitting over it — the reader loses the code
 * and gets nothing in its place, and only a reload fixes it.
 */
test("disposing restores every block it claimed", async () => {
  const first = makeBlock("export default () => <div>one</div>");
  const second = makeBlock("export default () => <div>two</div>");
  const { stop } = await start(() => [segment("export default () => <div>one</div>"), segment("export default () => <div>two</div>")]);
  for (const observer of observers) observer.fire();
  paint();
  expect([first, second].map((block) => block.style.display)).toEqual(["none", "none"]);
  stop();
  expect([first, second].map((block) => block.style.display)).toEqual(["", ""]);
  expect([first, second].map((block) => block.attrs["data-ui4a-claimed"])).toEqual([undefined, undefined]);
  expect(unmounts).toBe(2);
});

// A block React already removed must not be touched on the way out: its style and attributes
// belong to a node that is no longer in the document.
test("disposing does not touch a block that is already gone", async () => {
  const block = makeBlock("export default () => <div />");
  const { stop } = await start(() => [segment("export default () => <div />")]);
  block.isConnected = false;
  block.style.display = "none";
  stop();
  expect(block.style.display).toBe("none");
  expect(unmounts).toBe(1);
});

/**
 * A card far below the fold costs everything a visible one costs — the compile, a React root,
 * every effect it declares, and its third-party imports off esm.sh. `isConnected` was the only
 * liveness test, and the host keeps a long transcript in the DOM, so scrolling back through
 * twenty cards paid all of that twenty times for cards nobody was looking at. Measured on a real
 * trace: one Monaco card spent 22 seconds of worker time and 571ms registering languages.
 */
const CODE = "export default () => <div />";

test("a settled card far below the viewport waits until it comes near", async () => {
  makeBlock(CODE, 5000); // innerHeight is 800, so this is six screens down
  const { stop } = await start(() => [segment(CODE)]);
  expect(painted).toEqual([]);
  expect(blocks[0].attrs["data-ui4a-claimed"]).toBeUndefined();
  expect(intersections).toHaveLength(1);

  intersections[0]!.enter();
  await Promise.resolve();
  expect(painted).toEqual([{ code: CODE, streaming: false }]);
  expect(blocks[0].attrs["data-ui4a-claimed"]).toBe("");
  stop();
});

// The reader is watching this one arrive. Deferring it would show them the source instead.
test("a streaming card is claimed however far down the page it is", async () => {
  makeBlock(CODE, 5000);
  const { stop } = await start(() => [segment(CODE, false)]);
  expect(painted).toEqual([{ code: CODE, streaming: true }]);
  expect(intersections).toHaveLength(0);
  stop();
});

// A block one screen down is on its way in: compiling now is what makes it ready on arrival.
test("a card just below the fold is claimed immediately", async () => {
  makeBlock(CODE, 900);
  const { stop } = await start(() => [segment(CODE)]);
  expect(painted).toHaveLength(1);
  stop();
});

/**
 * Without an IntersectionObserver — an old browser, or a test harness that does not stub one —
 * every block must be claimed exactly as before. A performance optimisation that silently drops
 * cards on a host it cannot measure is worse than the cost it saves.
 */
test("no IntersectionObserver means no deferral", async () => {
  const saved = (globalThis as any).IntersectionObserver;
  (globalThis as any).IntersectionObserver = undefined;
  try {
    makeBlock(CODE, 5000);
    const { stop } = await start(() => [segment(CODE)]);
    expect(painted).toEqual([{ code: CODE, streaming: false }]);
    stop();
  } finally {
    (globalThis as any).IntersectionObserver = saved;
  }
});

/**
 * A new block must not be handed an OLDER card's code.
 *
 * `matchSegment` matches by prefix and takes the first hit in document order, and every generated
 * card opens the same way. Measured on a real transcript (three cards, all starting
 * `import { useState } from "react"`): the third card's opening 40 characters were still a prefix
 * of the FIRST card's code, so its slot rendered card one in full. When the texts diverged at
 * 276ms the delivery became a `restart`, and the partial buffer had no `export default` until
 * 3118ms — 2.8 seconds of blank between someone else's card and its own.
 */
test("a new block is not given an older card's code", async () => {
  const shared = 'import { useState } from "react"\n';
  const older = `${shared}import { sendMessage } from "$dsh/chat"\nexport default () => <div>old</div>`;
  const newer = `${shared}import * as Tabs from "@radix-ui/react-tabs"\nexport default () => <div>new</div>`;
  // The older card is on screen and claimed; the new one has only streamed the shared line.
  const olderBlock = makeBlock(older);
  let segmentsNow = [segment(older), segment(shared, false)];
  const { stop, again } = await start(() => segmentsNow);
  expect(painted.at(-1)).toEqual({ code: older, streaming: false });
  olderBlock.setText(older);
  const block = makeBlock(shared);
  again();
  expect(painted.at(-1)).toEqual({ code: shared, streaming: true });
  again();
  expect(painted.filter((p) => p.code === older)).toHaveLength(1);
  // And once its own text arrives it settles on its OWN card, not the older one.
  segmentsNow = [segment(older), segment(newer)];
  block.setText(newer);
  again();
  expect(painted.at(-1)).toEqual({ code: newer, streaming: false });
  stop();
});

// Nothing is claimed yet — a reload presents every block at once — so the reservation has to hold
// WITHIN one sweep as well, or all of them match the first segment.
test("blocks claimed in the same sweep do not share a segment", async () => {
  const shared = 'import { useState } from "react"\n';
  const first = `${shared}export default () => <div>first</div>`;
  const second = `${shared}export default () => <div>second</div>`;
  makeBlock(first);
  makeBlock(second);
  const { stop } = await start(() => [segment(first), segment(second)]);
  expect(painted.map((p) => p.code)).toEqual([first, second]);
  stop();
});

/**
 * A replaced block must be able to claim its segment in the SAME sweep the old claim dies in.
 *
 * The host re-renders the transcript on every streamed frame, and React can swap the
 * `.md-code-block` wrapper rather than update it. The claim on the old node is dead but still in
 * `claims`, so building the reservation before releasing it let a corpse hold the segment for one
 * more sweep: the replacement block found nothing free, painted nothing, and the next sweep —
 * with the corpse gone — painted again. Measured as `BLANK, painted, BLANK, painted`: a card that
 * flickers for the whole stream, and only while it is too early to render anything else.
 */
test("a block replaced mid-stream claims without a blank sweep", async () => {
  const code = 'import { useState } from "react"\nexport';
  let block = makeBlock(code);
  const { stop, again } = await start(() => [segment(code, false)]);
  const trace: string[] = [];
  for (let n = 0; n < 4; n += 1) {
    // The wrapper is swapped; the segment has not changed, so nothing else frees the reservation.
    block.isConnected = false;
    blocks.length = 0;
    block = makeBlock(code);
    const before = painted.length;
    again();
    trace.push(painted.length > before ? "painted" : "blank");
  }
  expect(trace).toEqual(["painted", "painted", "painted", "painted"]);
  stop();
});

/**
 * Our own source preview must never be claimed as a block.
 *
 * `CodeBlock` — the host component the preview is rendered with — puts `md-code-block` on its own
 * root, so every preview is itself a match for the sweep's selector. Claiming one mounts a card
 * inside it, whose preview is a third block, and so on.
 *
 * Recorded live, several times a second for the whole stream: `blocks` 1 → 2 → 3 with `mounts` and
 * `prev` climbing alongside, then the whole stack collapsing to 0 and rebuilding. That is the
 * flicker, and it also explains a flood of `blob:` module loads — one compile per mounted card.
 *
 * The segment reservation does NOT cover this. It holds `claim.reserved`, the code from the
 * PREVIOUS frame, while `segments()` has already grown, so mid-stream the two never compare equal
 * and nothing is excluded. Ownership of the NODE is the durable answer.
 */
test("our own preview is never claimed as a block", async () => {
  const code = "export default () => <div />";
  makeBlock(code);
  const { stop, again } = await start(() => [segment(code, false)]);
  expect(painted).toHaveLength(1);

  // The preview React renders one frame later: same class, same text, inside our preview host.
  const preview = makeBlock(code);
  preview.closest = (sel: string) => (sel === "[data-ui4a-preview]" ? preview : null);
  again();

  expect(painted).toHaveLength(1);
  expect(preview.attrs["data-ui4a-claimed"]).toBeUndefined();
  stop();
});

// Same rule for a card that renders a code block of its own: it lives inside our mount, and
// claiming it would mount a card inside a card.
test("a code block a card renders is never claimed", async () => {
  const code = "export default () => <div />";
  makeBlock(code);
  const { stop, again } = await start(() => [segment(code, false)]);
  const inner = makeBlock(code);
  inner.closest = (sel: string) => (sel === "[data-ui4a-mount]" ? inner : null);
  again();
  expect(painted).toHaveLength(1);
  expect(inner.attrs["data-ui4a-claimed"]).toBeUndefined();
  stop();
});

/**
 * A DEFERRED block still owns its segment.
 *
 * `defer` answers "do not mount this yet" for a settled card far off screen — which is exactly the
 * oldest card in a transcript while the reader sits at the bottom watching a new one stream. The
 * claim loop returned early on it WITHOUT reserving, so that card's segment stayed free, and the
 * new block — whose text is still only the opening line every generated card shares — matched it
 * by prefix and painted the OLD card in full where the new one was arriving.
 *
 * Reported from a live session as "a new fence shows the first fence's card instead of its own
 * streaming source". Two earlier fixes to this class of bug (the per-claim reservation, and
 * pruning dead claims before building it) both missed it, because both fixtures claimed every
 * block: with nothing deferred there is no unreserved segment to steal.
 */
test("a card parked off screen still holds its segment against a new block", async () => {
  const shared = 'import { useState } from "react"\n';
  const older = `${shared}export default () => <div>old</div>`;
  // Six screens up: `innerHeight` is 800 in this harness, and `defer` parks anything whose whole
  // box sits beyond one screen in either direction.
  makeBlock(older, -5000);
  const { stop, again } = await start(() => [segment(older), segment(shared, false)]);
  expect(painted).toEqual([]); // the old card is parked, as intended
  expect(intersections).toHaveLength(1);

  makeBlock(shared, 100); // the new one, on screen, still only the shared opening line
  again();
  expect(painted.map((p) => p.code)).not.toContain(older);
  expect(painted.at(-1)).toEqual({ code: shared, streaming: true });
  stop();
});

/**
 * The predicate handed to `render` answers about THIS card, and answers at call time.
 *
 * `report-error.ts` gates both the failure report and the retraction on it, so a predicate that is
 * wrong in either direction is silent: stuck false and no failure ever reaches the model again,
 * stuck true and a superseded card reports forever. Reading it at call time is the whole point —
 * `render` only runs when the code changes, and the question is asked a second later.
 */
test("the predicate is true for the only card and false once a later one arrives", async () => {
  makeBlock("export default () => <div />");
  let list = [segment("export default () => <div />")];
  const { stop } = await start(() => list);
  expect(renderedLast).toHaveLength(1);
  expect(renderedLast[0]()).toBe(true);
  // The model's next reply lands. The captured predicate must now answer false, WITHOUT `render`
  // having been called again — that is the staleness the report-time evaluation exists to avoid.
  list = [segment("export default () => <div />"), segment("export default () => <span />")];
  expect(renderedLast).toHaveLength(1);
  expect(renderedLast[0]()).toBe(false);
  stop();
});
