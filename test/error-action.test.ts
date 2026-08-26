import { expect, test } from "bun:test";
import { dispatchError, errorAction } from "../src/client/runtime/GenUISurface.tsx";

/**
 * The three-way decision the renderer's `onError` makes. Both predicates behind it were already
 * constrained; the routing between them was not, because it lived inside a callback inside an
 * effect — and it is where the two costly mistakes are:
 *
 * - reporting a mid-stream parse error shows the reader a failure that fixes itself next frame
 * - retrying a RENDER-phase network error re-imports three times, 2.4s of blank surface, for an
 *   error that was ready immediately
 */
test("a half-arrived frame is ignored while streaming", () => {
  expect(errorAction("No default export found", "compile", true, 0)).toBe("ignore");
  expect(errorAction("Unexpected eof", "transform", true, 0)).toBe("ignore");
});

test("the same message on a settled surface is reported, not ignored", () => {
  expect(errorAction("No default export found", "compile", false, 0)).toBe("report");
});

/**
 * The phase is the whole distinction. `Failed to fetch` from COMPILE is a dependency that did not
 * arrive — busting the URLs fixes it. The identical message from RENDER is the card's own fetch,
 * where re-importing changes nothing.
 */
test("a settled dependency failure retries", () => {
  expect(errorAction("Failed to fetch", "compile", false, 0)).toBe("retry");
});

test("the same message from the card's own render is reported", () => {
  expect(errorAction("Failed to fetch", "render", false, 0)).toBe("report");
});

test("a dependency failure mid-stream is not retried — the next frame re-delivers", () => {
  expect(errorAction("Failed to fetch", "compile", true, 0)).toBe("report");
});

test("retries stop after three", () => {
  expect(errorAction("Failed to fetch", "compile", false, 2)).toBe("retry");
  expect(errorAction("Failed to fetch", "compile", false, 3)).toBe("report");
});

test("an ordinary compile error is reported at once", () => {
  expect(errorAction("Expected '</', got '}'", "compile", false, 0)).toBe("report");
  expect(errorAction("Expected '</', got '}'", "compile", true, 0)).toBe("report");
});

/**
 * The dispatch, not the decision. `errorAction` above says WHICH of the three; these say what
 * each one does — and the audit could not constrain any of it before, because the only caller
 * was inside a `GenUIRenderer.create` callback that needs a DOM.
 */
const spy = () => {
  const calls: string[] = [];
  let attempts = 0;
  return {
    calls,
    read: () => attempts,
    effects: {
      attempts: () => attempts,
      setAttempts: (n: number) => {
        attempts = n;
        calls.push(`attempts=${n}`);
      },
      schedule: (ms: number) => calls.push(`schedule ${ms}`),
      report: () => calls.push("report"),
    },
  };
};

test("ignore does nothing at all — a streaming frame is not a failed attempt", () => {
  const s = spy();
  dispatchError("ignore", s.effects);
  expect(s.calls).toEqual([]);
});

test("retry counts first, then schedules on the new count", () => {
  // ORDER is the property here, not the delays — `retry.test.ts` owns those, and pinning both in
  // one test made retuning the backoff look like an ordering regression.
  const s = spy();
  dispatchError("retry", s.effects);
  expect(s.calls.map((c) => c.split(" ")[0])).toEqual(["attempts=1", "schedule"]);
  dispatchError("retry", s.effects);
  expect(s.calls.slice(2).map((c) => c.split(" ")[0])).toEqual(["attempts=2", "schedule"]);
});

test("report tells the caller and leaves the counter alone", () => {
  const s = spy();
  dispatchError("report", s.effects);
  expect(s.calls).toEqual(["report"]);
  expect(s.read()).toBe(0);
});
