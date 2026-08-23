/**
 * The canvas sweep — what the panel decides to show, and when it asks the disk.
 *
 * 12 conditions that no test reached. Extraction was tried and reverted (the body-resolution
 * logic only type-checks inline, where the checker can narrow `version` across an early return),
 * so the sweep is exercised where it lives: `mountCanvasHost` takes its inputs as callbacks, and
 * the only globals it needs are the ones `observe.test.ts` already stubs plus a `createRoot`
 * that records what it was handed.
 *
 * That last part is what makes this worth doing — the assertions are on the `Canvas[]` the panel
 * is rendered with, which is exactly what the reader sees.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

let painted: any[] = [];
let listed: string[] = [];
let files: Record<string, string> = {};
let reads: string[] = [];
let listings = 0;
let frame: any;
let widths: number[] = [];
let unmounts = 0;
let columnRemoved = 0;
let frames: (() => void)[] = [];

const paint = () => { const due = frames; frames = []; for (const cb of due) cb() };
/** Force another sweep, the way a streamed token would. */
let scheduleSweepAgain = () => {};

/** Let queued microtasks (the fetch mocks) settle, then run whatever frames they scheduled. */
const settle = async () => { for (let i = 0; i < 6; i++) { await Promise.resolve(); paint() } };

// The globals below are shared with every other test FILE; leaving them installed breaks
// whichever one bun runs next — see the note in `read.test.ts`.
const real = { fetch: globalThis.fetch, document: (globalThis as any).document, requestAnimationFrame: globalThis.requestAnimationFrame, MutationObserver: (globalThis as any).MutationObserver };
afterAll(() => { Object.assign(globalThis, real) });

beforeEach(() => {
  painted = []; listed = []; files = {}; reads = []; frames = []; listings = 0; widths = []; unmounts = 0; columnRemoved = 0;
  (globalThis as any).requestAnimationFrame = (cb: () => void) => { frames.push(cb); return frames.length };
  (globalThis as any).cancelAnimationFrame = () => {};
  (globalThis as any).MutationObserver = class { observe() {} disconnect() {} };
  const el = () => ({ style: { setProperty() {} }, setAttribute() {}, append() {}, remove() { columnRemoved += 1 }, prepend() {}, querySelector: () => null, classList: { add() {}, remove() {} } });
  // One frame element, reused: `createColumn` reads and writes its `paddingRight`, which is how
  // `setWidth(0)` is observable — it restores whatever padding the frame had before the panel.
  // `setWidth` is only observable through the frame's `paddingRight`, so the setter records it:
  // 0 means "collapsed back to the original padding", which is the branch under test.
  frame = { ...el(), style: { setProperty() {}, _p: "8px", get paddingRight() { return this._p }, set paddingRight(v: string) { this._p = v; widths.push(v.endsWith("px") && v !== "8px" ? Number.parseInt(v, 10) : 0) } } };
  (globalThis as any).document = { body: el(), head: el(), createElement: el, querySelector: () => frame };
  (globalThis as any).fetch = (url: string) => {
    const parsed = new URL(url, "http://x");
    const id = parsed.searchParams.get("id");
    if (id === null) { listings++; return Promise.resolve(new Response(JSON.stringify(listed))) }
    reads.push(id);
    const body = files[id];
    return Promise.resolve(body === undefined ? new Response("", { status: 404 }) : new Response(body));
  };
});

/** Mount the host with a fixed set of tool calls, and return what the panel was rendered with. */
const sweep = async (calls: any[], over: { cwd?: string; sweeps?: number; between?: () => void; open?: string; width?: number } = {}) => {
  // `mock.module`, not namespace assignment: an ESM namespace object is read-only, and the
  // module resolves its import binding at evaluation time — so the mock has to be registered
  // before `index.ts` is imported, which is why the import below is dynamic.
  mock.module("react-dom/client", () => ({ createRoot: () => ({ render: (node: any) => painted.push(node), unmount() { unmounts += 1 } }) }));
  // Renders from a previous `sweep()` in the same test would make `.at(-1)` pick a stale panel.
  painted = [];
  const { mountCanvasHost } = await import(`../src/client/canvas/index.ts?${Math.random()}`);
  // Canonical specifier, NO suffix. `index.ts` imports `../runtime/observe.ts` plainly, so that
  // is the instance holding its listener; importing `observe.ts?<anything>` yields a separate
  // module whose `scheduleSweep` drives nothing — which is how the first version of this test
  // sat green while `paint` never ran a second time.
  scheduleSweepAgain = (await import("../src/client/runtime/observe.ts")).scheduleSweep;
  const host = mountCanvasHost({ calls: () => calls, cwd: () => over.cwd ?? "/w", sessionId: () => "s1" });
  await settle();
  if (over.open !== undefined) { host.show(over.open); await settle() }
  // Stand in for the user having dragged the panel wider, so a collapse is observable.
  if (over.width !== undefined) { const panel = painted.map((n) => n?.props).filter((p) => p?.onWidth).at(-1); panel?.onWidth(over.width) }
  // Extra sweeps stand in for the stream continuing — the observer fires once per token.
  for (let i = 1; i < (over.sweeps ?? 1); i++) { over.between?.(); scheduleSweepAgain(); await settle() }
  host.dispose();
  // The panel is the first child whose props carry `canvases`.
  const withCanvases = painted.map((n) => n?.props).filter((p) => p && Array.isArray(p.canvases)).at(-1);
  return { canvases: (withCanvases?.canvases ?? []) as any[], offerable: (withCanvases?.offerable ?? []) as string[], renders: painted.length };
};

const write = (id: string, code: string, settled = true) => ({ argsRaw: JSON.stringify({ file_path: `/w/.dsh/ui4a/canvases/${id}.ui4a.tsx`, content: code }), settled });
const patch = (id: string) => ({ argsRaw: JSON.stringify({ file_path: `/w/.dsh/ui4a/canvases/${id}.ui4a.tsx`, old_string: "a", new_string: "b" }), settled: true });

describe("what the panel shows", () => {
  test("a write's own arguments are the canvas, streaming included", async () => {
    const { canvases } = await sweep([write("dice", "export default () => <div />", false)]);
    expect(canvases.map((c) => [c.id, c.streaming])).toEqual([["dice", true]]);
  });

  // After a patch the arguments describe a change rather than the file, so only the file is
  // correct — and the sweep has to go and read it.
  test("a patched canvas is re-read from disk", async () => {
    files.dice = "export default () => <div>from disk</div>";
    const { canvases } = await sweep([write("dice", "old body"), patch("dice")]);
    expect(reads).toContain("dice");
    expect(canvases[0].code).toBe("export default () => <div>from disk</div>");
  });

  // A read that 404s keeps its cache entry rather than dropping it. The canvas stays visible
  // either way — it is still in `collected` — so the thing to assert is the READ COUNT: dropping
  // the entry makes the next sweep fire the same failing read, and the sweep runs once per
  // streamed token. Asserting on the canvas list here passed with the guard deleted.
  test("a failed read is not retried on every sweep", async () => {
    const { canvases } = await sweep([write("dice", "body"), patch("dice")], { sweeps: 5 });
    expect(canvases.map((c) => c.id)).toEqual(["dice"]);
    expect(reads.filter((id) => id === "dice").length).toBe(1);
  });
});

describe("when the sweep asks the disk", () => {
  // The listing backs the launcher and is fetched once per workspace — the sweep runs per
  // streamed token and a directory read is not free.
  test("the workspace is listed once, not per sweep", async () => {
    listed = ["notes"];
    await sweep([write("dice", "body")], { sweeps: 6 });
    expect(listings).toBe(1);
  });

  // A call that ran arbitrary code may have written a canvas without naming it: 29 corpus writes
  // go through `run_code` and 27 build the path from a variable, so `collect.ts` sees nothing.
  // The listing already knows; this is what makes it ask again.
  test("code that mentions the canvases directory triggers a fresh listing", async () => {
    listed = [];
    // The call has to ARRIVE, not merely be present: the re-list is keyed on the settled-opaque
    // count changing. One that was already there when the panel mounted is covered by the first
    // listing, so a test that includes it from the start sees exactly one listing and proves
    // nothing — which is what the first version of this test did.
    const calls: any[] = [write("dice", "body")];
    await sweep(calls, { sweeps: 2, between: () => calls.push({ argsRaw: JSON.stringify({ code: "p = base / 'canvases' / f'{n}.ui4a.tsx'; p.write_text(src)" }), settled: true }) });
    expect(listings).toBe(2);
  });

  // Without the `canvases` clause an ordinary shell session re-lists once per command — measured
  // on the corpus, one session went from 0 extra listings to 94.
  test("ordinary shell work does not", async () => {
    // Arriving mid-stream, for the same reason as the test above: a call that was already there
    // when the panel mounted never changes the count, so including it from the start passes with
    // the `canvases` clause deleted. This is the mutation that caught it.
    const calls: any[] = [write("dice", "body")];
    await sweep(calls, { sweeps: 3, between: () => calls.push({ argsRaw: JSON.stringify({ command: "ls -la", description: "list" }), settled: true }) });
    expect(listings).toBe(1);
  });
});

describe("the launcher", () => {
  // A canvas outlives the session that wrote it, so the launcher offers everything on disk plus
  // anything written this session whose file has not landed yet.
  test("offers what is on disk and what this session wrote", async () => {
    listed = ["yesterday"];
    const { offerable } = await sweep([write("today", "body")]);
    expect(offerable).toEqual(["today", "yesterday"]);
  });

  // Opening one has no tool call to reconstruct it from, so its body comes off disk.
  test("opening a canvas from the launcher reads its body", async () => {
    listed = ["yesterday"];
    files.yesterday = "export default () => <div>from yesterday</div>";
    const { canvases } = await sweep([write("today", "body")], { open: "yesterday" });
    expect(canvases.map((c) => c.id).toSorted()).toEqual(["today", "yesterday"]);
    expect(canvases.find((c) => c.id === "yesterday")?.code).toBe("export default () => <div>from yesterday</div>");
  });

  // Read once and kept: nothing this session does can change a canvas it never wrote.
  test("a launcher-opened body is not re-read on later sweeps", async () => {
    listed = ["yesterday"];
    files.yesterday = "body";
    await sweep([write("today", "x")], { open: "yesterday", sweeps: 4 });
    expect(reads.filter((id) => id === "yesterday").length).toBe(1);
  });
});

// Opening from the launcher something this session already wrote. Without the dedup guard the
// same id is pushed twice and the reader gets two identical panels — and the second carries the
// disk body, so a streaming canvas would show its stale file beside itself.
test("a canvas already shown is not added twice by the launcher", async () => {
  listed = ["dice"];
  files.dice = "stale body from disk";
  const { canvases } = await sweep([write("dice", "live body")], { open: "dice" });
  expect(canvases.map((c) => c.id)).toEqual(["dice"]);
  expect(canvases[0].code).toBe("live body");
});

describe("what the sweep does not do", () => {
  // The observer fires on every streamed token. Without the signature check every one of those
  // is a React render of the whole panel — this is what stands between the panel and that.
  test("an unchanged sweep does not re-render", async () => {
    // Two renders, not one: the first paint happens before the workspace listing resolves, and
    // the listing changes the offerable half of the signature. What matters is that the count
    // does not grow with the sweep count — the observer fires once per streamed token, so a
    // panel that re-rendered per sweep would re-render dozens of times a second.
    //
    // Counted inside ONE mount: `painted` accumulates across calls and `beforeEach` only resets
    // between tests, so comparing two separate `sweep()` calls compares 2 against 2+2.
    const { renders } = await sweep([write("dice", "body")], { sweeps: 12 });
    expect(renders).toBeLessThanOrEqual(2);
  });

  // The column collapses and the frame gets its original padding back when the last canvas goes
  // away — otherwise closing the panel leaves a gap where it used to be.
  //
  // The canvas has to be shown FIRST and then dismissed. Mounting with none never calls
  // `setWidth` at all, so asserting on the padding there passes with the collapse deleted — the
  // padding was simply never touched.
  test("the frame's padding is restored when the last canvas goes away", async () => {
    const calls: any[] = [write("dice", "body")];
    await sweep(calls, { sweeps: 3, width: 420, between: () => calls.splice(0, calls.length) });
    expect(widths).toContain(420);
    // The collapse happens WHILE the host is alive, not at teardown. `dispose` restores the
    // padding too, so both the working and the broken version end at 0 — the difference is that
    // the working one records an extra collapse before it. Asserting on the final value passed
    // with the line deleted three times running; asserting that a collapse happened before
    // teardown is what actually distinguishes them.
    expect(widths.slice(0, -1)).toContain(0);
  });

  // ...and only then. The assertion above says a collapse happened before teardown; it does not
  // say the collapse was caused by the canvas going away, so it passes just as well when the
  // condition is inverted and the panel collapses while a canvas is on screen. Measured: with
  // `if (canvases.length === 0)` inverted, every test above stayed green.
  test("the panel does not collapse while a canvas is still there", async () => {
    const calls: any[] = [write("dice", "body")];
    await sweep(calls, { sweeps: 3, width: 420, between: () => calls.push(write("die2", "body2")) });
    expect(widths.slice(0, -1)).not.toContain(0);
  });
});

/**
 * Teardown, which the helper above has always called and nothing has ever asserted.
 *
 * The host owns a React root, a column element appended to `document.body`, an injected
 * stylesheet and a transcript listener. `dispose` is what the shell calls on every HMR round,
 * so a disposer that stops short leaks one of each per round — and the visible symptom is a
 * second panel appearing beside the first, not a console error.
 */
test("dispose unmounts the panel and removes its column", async () => {
  await sweep([write("dice", "export default () => <div />")]);
  expect(unmounts).toBeGreaterThan(0);
  expect(columnRemoved).toBeGreaterThan(0);
});
