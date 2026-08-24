import { expect, test, beforeEach } from "bun:test";
import { forgetReportedErrors, reportBody, reportCardError } from "../src/client/runtime/report-error.ts";

beforeEach(forgetReportedErrors);

// The whole point: before this existed, `onError` had no consumer and a card that failed to
// compile was a red panel the reader saw and the model never did. Measured on a real session —
// the surface printed `has no export named 'MonacoEditor'; module exports: Workspace, errors,
// hydrate, init, lazy`, which contains the fix, and the transcript ends with the model never
// having seen the string.
test("a reported error reaches the model", () => {
  const sent: string[] = [];
  reportCardError((t) => sent.push(t), "has no export named 'MonacoEditor'", "compile");
  expect(sent.length).toBe(1);
  expect(sent[0]).toContain("has no export named 'MonacoEditor'");
});

// A settled card that fails re-renders on every later frame in the transcript. One message per
// render is a loop the user has to kill by closing the tab.
test("the same failure is sent once, not once per render", () => {
  const sent: string[] = [];
  const send = (t: string) => sent.push(t);
  for (let i = 0; i < 5; i++) reportCardError(send, "same failure", "compile");
  expect(sent.length).toBe(1);
  // A different failure is still worth sending — the model fixed one thing and broke another.
  reportCardError(send, "a different failure", "compile");
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

// A host with no chat channel is not an error; it is a headless or embedded surface.
test("no channel is a no-op, not a throw", () => {
  expect(() => reportCardError(undefined, "boom", "compile")).not.toThrow();
});
