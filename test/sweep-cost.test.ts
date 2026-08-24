/**
 * The sweep's per-frame cost.
 *
 * `collectCanvases` walks every argument string by hand — that is what makes it correct on a
 * half-arrived JSON prefix, and it costs ~0.16ms per canvas. The sweep runs on **every
 * transcript mutation**, so before the calls key was added, the corpus's busiest session (34
 * canvas writes) spent 3.7ms per streamed token re-deriving a result that had not changed.
 *
 * A timing assertion is a blunt instrument, so this one is deliberately loose: it asserts the
 * cheap path is an order of magnitude cheaper than the walk, which is a property of the
 * algorithm rather than of the machine. Measured 3.725ms against 0.014ms — 265×.
 */
import { expect, test } from "bun:test";
import { collectCanvases, type ToolCallView } from "../src/client/canvas/collect.ts";

const code = await Bun.file("test/cards/2048.ui4a.tsx").text();
const calls: ToolCallView[] = Array.from({ length: 34 }, (_, i) => ({
  name: "write",
  argsRaw: JSON.stringify({ file_path: `/w/.dsh/ui4a/canvases/c${i}.ui4a.tsx`, content: code }),
  settled: true,
}));

/** The same key `mountCanvasHost` computes, kept here so the shape is asserted rather than described. */
const keyOf = (views: readonly ToolCallView[]) => `${views.length}:${views.reduce((total, call) => total + call.argsRaw.length + (call.settled ? 1 : 0) , 0)}`;

/*
 * The BEST of several batches, not the mean of one.
 *
 * A mean measures the machine as much as the code: on a loaded box (this failed at load average
 * 50, with five model evals running) the scheduler can preempt either batch, and whichever it
 * preempts decides the ratio. The minimum is the run that was not interrupted, which is the one
 * that says something about the algorithm — the property under test is a 265x gap, so a sample
 * that lands anywhere near the truth passes easily.
 */
const msPerCall = (run: () => void) => {
  for (let i = 0; i < 5; i++) run();
  let best = Infinity;
  for (let batch = 0; batch < 5; batch++) {
    const start = performance.now();
    for (let i = 0; i < 40; i++) run();
    best = Math.min(best, (performance.now() - start) / 40);
  }
  return best;
};

test("the cheap key is an order of magnitude cheaper than the walk", () => {
  const walk = msPerCall(() => collectCanvases(calls));
  const key = msPerCall(() => keyOf(calls));
  expect(key * 10).toBeLessThan(walk);
});

// The key has to MOVE when a streamed argument grows, or the panel stops updating mid-write —
// which would be a far worse bug than the cost it avoids.
test("a growing argument changes the key", () => {
  const growing = [{ name: "write", argsRaw: '{"file_path":"/w/.dsh/ui4a/canvases/a.ui4a.tsx","content":"exp', settled: false }];
  const before = keyOf(growing);
  growing[0]!.argsRaw += "ort default";
  expect(keyOf(growing)).not.toBe(before);
  // ...and when a call settles, since `complete` flips with no byte added.
  const settling = [{ ...growing[0]!, settled: false }];
  const unsettled = keyOf(settling);
  settling[0]!.settled = true;
  expect(keyOf(settling)).not.toBe(unsettled);
});
