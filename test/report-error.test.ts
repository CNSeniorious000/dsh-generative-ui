import { expect, test, beforeEach } from "bun:test";
import { cancelPendingReport, cardRendered, forgetReportedErrors, reportCardError } from "../src/client/runtime/report-error.ts";

beforeEach(forgetReportedErrors);

type Report = { message: string; phase: string } | null;

// The whole point: before this existed, `onError` had no consumer and a card that failed to
// compile was a red panel the reader saw and the model never did. Measured on a real session —
// the surface printed `has no export named 'MonacoEditor'; module exports: Workspace, errors,
// hydrate, init, lazy`, which contains the fix, and the transcript ends with the model never
// having seen the string.
const settle = () => new Promise((r) => setTimeout(r, 1100));

test("a reported error reaches the host", async () => {
  const sent: Report[] = [];
  reportCardError((r) => sent.push(r), "has no export named 'MonacoEditor'", "compile");
  await settle();
  expect(sent).toEqual([{ message: "has no export named 'MonacoEditor'", phase: "compile" }]);
});

// A half-written component rendering mid-stream throws, and the next frame is fine. Measured in a
// browser: a card that ultimately rendered correctly reported `Cannot read properties of undefined
// (reading 'getCurrentStack')`, a React internal. A red panel for one frame costs nothing; a
// message about a card that then worked costs the model a turn fixing what is not broken.
test("an error the next frame makes untrue is never sent", async () => {
  const sent: Report[] = [];
  reportCardError((r) => sent.push(r), "Cannot read properties of undefined", "render");
  cardRendered();
  await settle();
  expect(sent).toEqual([]);
});

// …but a paint BEFORE the failure must not silence it: that is the ordinary case of a card that
// rendered for a while and then broke on an edit.
test("a paint before the error does not cancel it", async () => {
  const sent: Report[] = [];
  cardRendered();
  reportCardError((r) => sent.push(r), "TypeError: x is not a function", "render");
  await settle();
  expect(sent).toHaveLength(1);
});

/**
 * Recovery is reported, because the report is STATE.
 *
 * The host keeps the failure in the model's runtime context until it hears otherwise, so a card
 * that starts working has to say so — otherwise the model reads about a failure that no longer
 * exists on every step for the rest of the session. As a chat message this was not expressible at
 * all, which is the reason the old body had to explain that nobody had typed it.
 */
test("a card that starts working is reported as recovered", async () => {
  const sent: Report[] = [];
  const send = (r: Report) => sent.push(r);
  reportCardError(send, "boom", "compile");
  await settle();
  expect(sent).toEqual([{ message: "boom", phase: "compile" }]);
  cardRendered();
  expect(sent).toEqual([{ message: "boom", phase: "compile" }, null]);
});

// Only once, though: a settled card that fails re-renders on every later frame of the transcript,
// and a clear per paint is a request per paint.
test("recovery is reported once, not once per paint", async () => {
  const sent: Report[] = [];
  const send = (r: Report) => sent.push(r);
  reportCardError(send, "boom", "compile");
  await settle();
  cardRendered();
  cardRendered();
  cardRendered();
  expect(sent.filter((r) => r === null)).toHaveLength(1);
});

// Nothing was ever delivered, so there is nothing to take back.
test("a paint with no outstanding failure sends nothing", () => {
  const sent: Report[] = [];
  reportCardError((r) => sent.push(r), "boom", "compile");
  cardRendered();
  expect(sent).toEqual([]);
});

// A host with no channel is not an error; it is a headless or embedded surface.
test("no channel is a no-op, not a throw", () => {
  expect(() => reportCardError(undefined, "boom", "compile")).not.toThrow();
});

// partial-react answers a render throw by re-mounting the LAST GOOD component (`runtime.ts:416-419`,
// whenever `preserve` is on — which is every inline card). That re-mount PAINTS, and painting used
// to cancel the report the same throw had just armed, so the one case this feature exists for — a
// card that worked and then broke on an edit — showed stale content and told the model nothing.
test("a restore-to-last-good does not cancel the report it was armed by", async () => {
  const sent: Report[] = [];
  reportCardError((r) => sent.push(r), "no export named MonacoEditor", "compile");
  cardRendered(true); // the restore's paint, ~16ms later
  await settle();
  expect(sent).toHaveLength(1);
});

/**
 * The page going away is not a recovery.
 *
 * Teardown runs the same cancel the next paint would, and routing both through `cardRendered`
 * meant closing a tab told the host the card was fine — clearing a failure that is still there
 * for whoever opens the session next.
 */
test("teardown drops a pending report without claiming the card is fixed", async () => {
  const sent: Report[] = [];
  reportCardError((r) => sent.push(r), "boom", "compile");
  cancelPendingReport();
  await settle();
  expect(sent).toEqual([]);
});
