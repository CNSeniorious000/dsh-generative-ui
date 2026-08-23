import { expect, test } from "bun:test";
import { deliver, deliveryFor } from "../src/client/runtime/GenUISurface.tsx";

/**
 * The frame-delivery decision. `pushCode` APPENDS while a session event carries the whole
 * prefix so far — the reason this is a state machine at all, and the reason getting it wrong
 * doubles the buffer on every frame rather than failing loudly.
 *
 * It lived inside an effect behind three refs, so none of its four answers was constrained.
 */
test("a settled frame replaces the buffer outright", () => {
  expect(deliveryFor("full card", "", false)).toEqual({ do: "replace", code: "full card" });
});

test("a settled frame identical to what is painted does nothing", () => {
  // The common case: the effect re-runs because another dependency changed.
  expect(deliveryFor("full card", "full card", false)).toEqual({ do: "nothing" });
});

test("a streaming frame appends only the delta", () => {
  expect(deliveryFor("abcdef", "abc", true)).toEqual({ do: "append", delta: "def" });
});

test("a streaming frame that grew by nothing does nothing", () => {
  // A closing fence adds no text — the case that kept `inline-fence` on the streaming path.
  expect(deliveryFor("abc", "abc", true)).toEqual({ do: "nothing" });
});

test("a rewritten prefix restarts with the whole frame", () => {
  // A re-delivered history page, or an edit. Appending the delta here is meaningless because
  // there is no delta — the buffer holds text this frame does not contain.
  expect(deliveryFor("xyz", "abc", true)).toEqual({ do: "restart", code: "xyz" });
});

test("settled is decided before the prefix relationship", () => {
  // A settled frame that is NOT a prefix extension still replaces rather than restarts: there
  // is no partial state to preserve, and `restart` would clear the surface for nothing.
  expect(deliveryFor("xyz", "abc", false)).toEqual({ do: "replace", code: "xyz" });
});

test("the first streaming frame appends everything", () => {
  expect(deliveryFor("abc", "", true)).toEqual({ do: "append", delta: "abc" });
});

test("an empty settled frame with a painted buffer still replaces", () => {
  // A card edited down to nothing must clear, not silently keep the old render.
  expect(deliveryFor("", "abc", false)).toEqual({ do: "replace", code: "" });
});

/**
 * The other half: routing a `Delivery` to the renderer. `render` REPLACES the buffer and
 * `pushCode` APPENDS to it, so swapping them doubles the card on every streamed frame — a
 * one-word difference that used to live inside an effect where nothing could reach it.
 */
const spy = () => {
  const calls: string[] = [];
  const renderer = {
    render: (code: string) => void calls.push(`render:${code}`),
    pushCode: (delta: string) => void calls.push(`push:${delta}`),
    clear: (options: { preserveVisualState: boolean }) => void calls.push(`clear:${options.preserveVisualState}`),
  };
  return { renderer, calls };
};

test("nothing calls nothing, and tells the caller not to advance", () => {
  const { renderer, calls } = spy();
  expect(deliver(renderer, { do: "nothing" })).toBe(false);
  expect(calls).toEqual([]);
});

test("replace renders the whole code", () => {
  const { renderer, calls } = spy();
  expect(deliver(renderer, { do: "replace", code: "abc" })).toBe(true);
  expect(calls).toEqual(["render:abc"]);
});

test("append pushes only the delta", () => {
  const { renderer, calls } = spy();
  expect(deliver(renderer, { do: "append", delta: "def" })).toBe(true);
  expect(calls).toEqual(["push:def"]);
});

/**
 * `preserveVisualState: true` is the whole point of the restart path — clearing without it blanks
 * a surface that was showing a working card, on every re-delivered history page.
 */
test("restart clears without blanking, then pushes the whole code", () => {
  const { renderer, calls } = spy();
  expect(deliver(renderer, { do: "restart", code: "xyz" })).toBe(true);
  expect(calls).toEqual(["clear:true", "push:xyz"]);
});
