import { expect, test } from "bun:test";
import { chatNodes, perNode } from "../src/client/session.ts";
import type { ChatNodeView } from "../src/client/session.ts";

/**
 * `chatNodes` runs on every frame of a streaming reply, and both of its guards are states the
 * host really produces: no session open yet, and a session id whose binding has gone. Neither
 * was constrained — the mutation audit could not see this file at all, because its glob listed
 * two directories at one depth and `src/client/` was not one of them.
 */
const ctxWith = (current: string | undefined, binding: unknown) => ({ sessions: { list: { getSnapshot: () => ({ current }) }, binding: () => binding } }) as never;

const node = (kind: string, seq: number): ChatNodeView => ({ kind, data: {}, anchorSeq: seq });

test("no open session yields no nodes", () => {
  expect(chatNodes(ctxWith(undefined, null))).toEqual([]);
});

test("a session whose binding has gone yields no nodes", () => {
  expect(chatNodes(ctxWith("s1", undefined))).toEqual([]);
  // A binding that exists but whose session snapshot does not is the same state, reached
  // differently — the optional chain and the undefined check are two separate guards.
  expect(chatNodes(ctxWith("s1", { session: { getSnapshot: () => undefined } }))).toEqual([]);
});

test("an open session yields its nodes in order", () => {
  const nodes = new Map([
    ["a", node("text", 1)],
    ["b", node("tool", 2)],
  ]);
  const ctx = ctxWith("s1", { session: { getSnapshot: () => ({ chat: { nodes } }) } });
  expect(chatNodes(ctx).map((n) => n.kind)).toEqual(["text", "tool"]);
});

test("perNode reuses a result while the key is unchanged and drops what left the window", () => {
  let derived = 0;
  const run = perNode<string>(
    (n) => `${n.kind}:${n.anchorSeq}`,
    (n) => {
      derived += 1;
      return `${n.kind}!`;
    },
  );
  const a = node("text", 1),
    b = node("tool", 2);
  expect(run([a, b])).toEqual(["text!", "tool!"]);
  expect(derived).toBe(2);
  run([a, b]);
  expect(derived).toBe(2); // both keys unchanged: nothing re-derived
  run([b]); // `a` leaves the loaded window
  expect(derived).toBe(2);
  run([a, b]); // and comes back — its cache entry was dropped, so it re-derives
  expect(derived).toBe(3);
});

test("a changed key re-derives that node and not its neighbours", () => {
  let derived = 0;
  const run = perNode<number>(
    (n) => `${n.anchorSeq}`,
    () => ++derived,
  );
  const a = node("text", 1);
  run([a, node("text", 2)]);
  expect(derived).toBe(2);
  run([a, node("text", 3)]); // only the tail node grew, which is the streaming case
  expect(derived).toBe(3);
});
