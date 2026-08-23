/**
 * What the panel shows, and what its "other canvases" menu offers.
 *
 * Both decide what the reader is looking at, and both were inline in a component that needs a
 * DOM to render — so neither had ever been exercised. The interesting cases are the ones that
 * happen mid-stream: a canvas arriving while another is selected, and a selected canvas
 * vanishing when the session's calls are re-read.
 */
import { expect, test } from "bun:test";
import { activeCanvas, otherCanvases } from "../src/client/canvas/CanvasPanel.tsx";

const canvas = (id: string) => ({ id, code: "", streaming: false });

test("with nothing selected, the newest canvas is shown", () => {
  expect(activeCanvas([canvas("a"), canvas("b")], null)?.id).toBe("b");
});

test("a selection is honoured, and a newer canvas does not steal it", () => {
  expect(activeCanvas([canvas("a"), canvas("b")], "a")?.id).toBe("a");
  expect(activeCanvas([canvas("a"), canvas("b"), canvas("c")], "a")?.id).toBe("a");
});

/**
 * A selected canvas that disappears falls back rather than blanking.
 *
 * This happens for real: the panel is driven by the session's tool calls, and a re-read that
 * drops the call the reader had selected would otherwise leave them staring at nothing with no
 * way back.
 */
test("a selection that no longer exists falls back to the newest", () => {
  expect(activeCanvas([canvas("a"), canvas("b")], "gone")?.id).toBe("b");
  expect(activeCanvas([], "gone")).toBeUndefined();
});

test("the menu offers only what is not already a tab", () => {
  expect(otherCanvases([canvas("a")], ["a", "b", "c"])).toEqual(["b", "c"]);
  expect(otherCanvases([canvas("a"), canvas("b")], ["a", "b"])).toEqual([]);
  expect(otherCanvases([], ["a"])).toEqual(["a"]);
});
