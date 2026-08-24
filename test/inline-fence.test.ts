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
let unmounts = 0;
let frames: (() => void)[] = [];
let blocks: any[] = [];
let observers: { target: any; fire: () => void }[] = [];

const paint = () => {
  const due = frames;
  frames = [];
  for (const cb of due) cb();
};

/** A `.md-code-block` wrapper with a `<pre>` inside, plus the members the module touches. */
const makeBlock = (text: string) => {
  const pre = { textContent: text };
  const block: any = {
    attrs: {} as Record<string, string>,
    style: {},
    isConnected: true,
    children: [] as any[],
    querySelector: (sel: string) => (sel === "pre" ? pre : null),
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
  unmounts = 0;
  frames = [];
  blocks = [];
  observers = [];
  (globalThis as any).requestAnimationFrame = (cb: () => void) => {
    frames.push(cb);
    return frames.length;
  };
  (globalThis as any).cancelAnimationFrame = () => {};
  (globalThis as any).MutationObserver = class {
    constructor(private cb: () => void) {}
    observe(target: any) {
      observers.push({ target, fire: () => this.cb() });
    }
    disconnect() {
      observers = observers.filter((o) => o.fire !== this.cb);
    }
  };
  const mount = () => ({ tag: "DIV", textContent: "", setAttribute() {}, remove() {}, querySelectorAll: () => [] });
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
        painted.push(el.props);
        node.textContent = el.props.code;
      },
      unmount() {
        unmounts += 1;
      },
    }),
  }));
  const { claimInlineFences } = await import(`../src/client/runtime/inline-fence.ts?${Math.random()}`);
  const { scheduleSweep } = await import("../src/client/runtime/observe.ts");
  const stop = claimInlineFences({ segments, render: (props: any) => ({ props }) });
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
 * The block is hidden only once the card paints, and only then.
 *
 * Hiding at claim time leaves a blank gap for however long the card takes to have a body — with
 * the source sitting right there the whole time.
 */
test("the source block is hidden when the card paints, not when it is claimed", async () => {
  const block = makeBlock("export default () => <div />");
  const { stop } = await start(() => [segment("export default () => <div />")]);
  expect(block.style.display).toBeUndefined();
  observers.at(-1)?.fire();
  paint();
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
