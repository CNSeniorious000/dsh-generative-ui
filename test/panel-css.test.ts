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

/**
 * Every class the panel renders is styled, and every class styled is rendered.
 *
 * The stylesheet and the components are separate files with no compiler between them, so a
 * renamed class is an unstyled panel that still mounts — no error, just a column of unformatted
 * markup over the conversation. The reverse direction is cheaper to fix and worth knowing too:
 * a rule nobody matches is a rule that will be edited under the impression it does something.
 */
test("the stylesheet and the components agree on every class name", async () => {
  const markup = (await Promise.all(["CanvasPanel.tsx", "CanvasLauncher.tsx"].map((name) => Bun.file(`src/client/canvas/${name}`).text()))).join("\n");
  const styled = new Set([...css.matchAll(/\.(dgu-[a-z-]+)/g)].map((m) => m[1]!));
  const used = new Set([...markup.matchAll(/className="([^"]+)"/g)].flatMap((m) => m[1]!.split(/\s+/)).filter((name) => name.startsWith("dgu-")));
  expect([...used].filter((name) => !styled.has(name))).toEqual([]);
  expect([...styled].filter((name) => !used.has(name))).toEqual([]);
});
