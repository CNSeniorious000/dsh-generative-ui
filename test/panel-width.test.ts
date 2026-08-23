/**
 * The resize arithmetic, which is all of `useResize` that is not the DOM.
 *
 * The panel is anchored to the right edge, so its width is the distance from the pointer to the
 * viewport's right — a flipped subtraction gives a panel that grows as you drag it closed. The
 * clamp matters as much: below `MIN_WIDTH` a card has no room to lay out, and above `MAX_WIDTH`
 * the conversation is squeezed out of the window it was reading in.
 */
import { expect, test } from "bun:test";
import { widthForPointer } from "../src/client/canvas/CanvasPanel.tsx";

test("the width is the distance from the pointer to the right edge", () => {
  expect(widthForPointer(1000, 1400)).toBe(400);
  // Dragging LEFT widens: the panel is on the right.
  expect(widthForPointer(900, 1400)).toBeGreaterThan(widthForPointer(1000, 1400));
});

test("the width is clamped at both ends", () => {
  expect(widthForPointer(1399, 1400)).toBe(320);
  expect(widthForPointer(0, 1400)).toBe(720);
  // Past the edges, in both directions, including a pointer outside the window.
  expect(widthForPointer(-500, 1400)).toBe(720);
  expect(widthForPointer(5000, 1400)).toBe(320);
});

// A narrow window cannot make the panel wider than the window itself is useful — the clamp is
// on the panel, not on what is left over, so this is the case that decides the reading pane.
test("a viewport narrower than the minimum still yields the minimum", () => {
  expect(widthForPointer(0, 300)).toBe(320);
});
