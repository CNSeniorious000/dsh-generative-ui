import { expect, test, beforeEach } from "bun:test";
import { cardRendered, forgetReportedErrors, reportBody, reportCardError } from "../src/client/runtime/report-error.ts";

beforeEach(forgetReportedErrors);

// The whole point: before this existed, `onError` had no consumer and a card that failed to
// compile was a red panel the reader saw and the model never did. Measured on a real session —
// the surface printed `has no export named 'MonacoEditor'; module exports: Workspace, errors,
// hydrate, init, lazy`, which contains the fix, and the transcript ends with the model never
// having seen the string.
const settle = () => new Promise((r) => setTimeout(r, 1100));

test("a reported error reaches the model", async () => {
  const sent: string[] = [];
  reportCardError((t) => sent.push(t), "has no export named 'MonacoEditor'", "compile");
  await settle();
  expect(sent.length).toBe(1);
  expect(sent[0]).toContain("has no export named 'MonacoEditor'");
});

// `isUnfinishedFrame` excludes the RENDER phase deliberately — a card whose own render throws is
// usually a real error — but a half-written component rendering mid-stream throws too, and the
// next frame is fine. Measured in a browser: a card that ultimately rendered correctly reported
// `Cannot read properties of undefined (reading 'getCurrentStack')`, a React internal, to the
// model. A red panel for one frame costs nothing; a message about a card that then worked costs
// the model a turn fixing what is not broken.
test("an error the next frame makes untrue is never sent", async () => {
  const sent: string[] = [];
  reportCardError((t) => sent.push(t), "Cannot read properties of undefined", "render");
  cardRendered();
  await settle();
  expect(sent).toEqual([]);
});

// …but a paint BEFORE the failure must not silence it: that is the ordinary case of a card that
// rendered for a while and then broke on an edit.
test("a paint before the error does not cancel it", async () => {
  const sent: string[] = [];
  cardRendered();
  reportCardError((t) => sent.push(t), "TypeError: x is not a function", "render");
  await settle();
  expect(sent.length).toBe(1);
});

// A settled card that fails re-renders on every later frame in the transcript. One message per
// render is a loop the user has to kill by closing the tab.
test("the same failure is sent once, not once per render", async () => {
  const sent: string[] = [];
  const send = (t: string) => sent.push(t);
  for (let i = 0; i < 5; i++) reportCardError(send, "same failure", "compile");
  await settle();
  expect(sent.length).toBe(1);
  // A different failure is still worth sending — the model fixed one thing and broke another.
  reportCardError(send, "a different failure", "compile");
  await settle();
  expect(sent.length).toBe(2);
});

// The model is about to read a user-role message nobody typed. Without saying so it apologises to
// a person who said nothing, and burns the turn on that instead of on the fix.
test("the message says it is automatic and that the user did not speak", () => {
  const body = reportBody("boom", "compile");
  expect(body).toContain("[automatic]");
  expect(body).toContain("nobody typed it");
});

// English, like every other word this plugin puts in front of the model. This is the only text it
// injects into the conversation, and in Chinese it read as a different voice from the prompt and
// the skill — and worse, a card has to be written in the language the USER wrote in, so a Chinese
// interruption pushes the model toward the wrong language for the rest of the turn. The rule the
// message itself carries ("answer in the language the user has been writing in") is the belt; this
// is the braces.
test("the message is in English, like the prompt and the skill", () => {
  expect(reportBody("boom", "compile")).not.toMatch(/[\u4e00-\u9fff]/);
});

// The belt to the test above's braces. An English interruption with no language instruction is
// WORSE than a Chinese one: it silently pulls a Spanish conversation into English for the rest of
// the turn. The English-ness above is only safe because this sentence is here.
test("the message tells the model to answer in the user's language", () => {
  expect(reportBody("boom", "compile")).toContain("language the user has been writing in");
});

// A host with no chat channel is not an error; it is a headless or embedded surface.
test("no channel is a no-op, not a throw", () => {
  expect(() => reportCardError(undefined, "boom", "compile")).not.toThrow();
});

// partial-react answers a render throw by re-mounting the LAST GOOD component (`runtime.ts:416-419`,
// whenever `preserve` is on — which is every inline card). That re-mount PAINTS, and painting used
// to cancel the report the same throw had just armed, so the one case this feature exists for — a
// card that worked and then broke on an edit — showed stale content and told the model nothing.
test("a restore-to-last-good does not cancel the report it was armed by", async () => {
  forgetReportedErrors();
  const sent: string[] = [];
  reportCardError((t) => sent.push(t), "no export named MonacoEditor", "compile");
  cardRendered(true); // the restore's paint, ~16ms later
  await new Promise((r) => setTimeout(r, 1100));
  expect(sent).toHaveLength(1);
});

// The dedup key is claimed when the message is SENT. Claiming it at arm time meant a cancelled
// report still burned it, so the same failure on a later edit reported nothing at all.
test("a cancelled report leaves its message reportable", async () => {
  forgetReportedErrors();
  const sent: string[] = [];
  reportCardError((t) => sent.push(t), "same message", "compile");
  cardRendered(); // a genuine paint — the next frame fixed it
  await new Promise((r) => setTimeout(r, 1100));
  expect(sent).toHaveLength(0);

  reportCardError((t) => sent.push(t), "same message", "compile");
  await new Promise((r) => setTimeout(r, 1100));
  expect(sent).toEqual([expect.stringContaining("same message")]);
});
