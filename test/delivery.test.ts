import { expect, test } from "bun:test";
import { deliveryFor } from "../src/client/runtime/GenUISurface.tsx";

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
