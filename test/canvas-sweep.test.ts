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
import { beforeEach, describe, expect, mock, test } from "bun:test";

let painted: any[] = [];
let listed: string[] = [];
let files: Record<string, string> = {};
let reads: string[] = [];
let frames: (() => void)[] = [];

const paint = () => { const due = frames; frames = []; for (const cb of due) cb() };
/** Force another sweep, the way a streamed token would. */
let scheduleSweepAgain = () => {};

/** Let queued microtasks (the fetch mocks) settle, then run whatever frames they scheduled. */
const settle = async () => { for (let i = 0; i < 6; i++) { await Promise.resolve(); paint() } };

beforeEach(() => {
  painted = []; listed = []; files = {}; reads = []; frames = [];
  (globalThis as any).requestAnimationFrame = (cb: () => void) => { frames.push(cb); return frames.length };
  (globalThis as any).cancelAnimationFrame = () => {};
  (globalThis as any).MutationObserver = class { observe() {} disconnect() {} };
  const el = () => ({ style: { setProperty() {} }, setAttribute() {}, append() {}, remove() {}, prepend() {}, querySelector: () => null, classList: { add() {}, remove() {} } });
  (globalThis as any).document = { body: el(), head: el(), createElement: el, querySelector: () => el() };
  (globalThis as any).fetch = (url: string) => {
    const parsed = new URL(url, "http://x");
    const id = parsed.searchParams.get("id");
    if (id === null) return Promise.resolve(new Response(JSON.stringify(listed)));
    reads.push(id);
    const body = files[id];
    return Promise.resolve(body === undefined ? new Response("", { status: 404 }) : new Response(body));
  };
});

/** Mount the host with a fixed set of tool calls, and return what the panel was rendered with. */
const sweep = async (calls: any[], over: { cwd?: string; sweeps?: number } = {}) => {
  // `mock.module`, not namespace assignment: an ESM namespace object is read-only, and the
  // module resolves its import binding at evaluation time — so the mock has to be registered
  // before `index.ts` is imported, which is why the import below is dynamic.
  mock.module("react-dom/client", () => ({ createRoot: () => ({ render: (node: any) => painted.push(node), unmount() {} }) }));
  const suffix = Math.random();
  const { mountCanvasHost } = await import(`../src/client/canvas/index.ts?${suffix}`);
  // The same `observe.ts` instance the host subscribed to — a fresh import would be a different
  // module with its own listener set and would drive nothing.
  scheduleSweepAgain = (await import(`../src/client/runtime/observe.ts?${suffix}`)).scheduleSweep;
  const host = mountCanvasHost({ calls: () => calls, cwd: () => over.cwd ?? "/w", sessionId: () => "s1" });
  await settle();
  // Extra sweeps stand in for the stream continuing — the observer fires once per token.
  for (let i = 1; i < (over.sweeps ?? 1); i++) { scheduleSweepAgain(); await settle() }
  host.dispose();
  // The panel is the first child whose props carry `canvases`.
  const withCanvases = painted.map((n) => n?.props).filter((p) => p && Array.isArray(p.canvases)).at(-1);
  return { canvases: (withCanvases?.canvases ?? []) as any[], offerable: (withCanvases?.offerable ?? []) as string[] };
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
