/**
 * The two places the panel's default width is written.
 *
 * `panel.css` paints the panel before React's inline style lands, so its `--dgu-panel-width`
 * fallback is the width of the first frame; `DEFAULT_WIDTH` is where the resize state starts.
 * They are necessarily separate — a stylesheet cannot import a constant — and if they diverge
 * the panel visibly jumps the moment it mounts.
 */
import { expect, test } from "bun:test";
import { DEFAULT_WIDTH, MIN_WIDTH_FOR_TEST, MAX_WIDTH_FOR_TEST } from "../src/client/canvas/CanvasPanel.tsx";

const css = await Bun.file("src/client/canvas/panel.css").text();

test("the stylesheet's default width matches the component's", () => {
  const found = /--dgu-panel-width:\s*(\d+)px/.exec(css);
  expect(found).not.toBeNull();
  expect(Number(found![1])).toBe(DEFAULT_WIDTH);
});

// The default has to be a width the reader could have dragged to, or the first resize snaps.
test("the default sits inside the drag bounds", () => {
  expect(DEFAULT_WIDTH).toBeGreaterThanOrEqual(MIN_WIDTH_FOR_TEST);
  expect(DEFAULT_WIDTH).toBeLessThanOrEqual(MAX_WIDTH_FOR_TEST);
});
