/**
 * `canvasChildPath` and `owningCanvasIdOf` — where a relative import inside a card resolves.
 *
 * `routes.test.ts` says "`canvasChildPath` is unit-tested"; it was not. Two conditions had no
 * test that would notice them going, and both are the fence: one decides that a sibling-form
 * specifier written beside the entry must open with the canvas id, the other decides whether a
 * path is under the contract at all. Removing either widens what a route will read.
 */
import { expect, test } from "bun:test";
import { CANVAS_DIR, canvasChildDir, canvasChildPath, owningCanvasIdOf } from "../src/contract.ts";

const id = "deck";

test("a specifier beside the entry file must open with the canvas id", () => {
  expect(canvasChildPath(id, "./deck/board")).toBe(`${canvasChildDir(id)}/board`);
  // Without the id it names nothing: the entry writes `./<id>/…`, so `./board` alone would
  // resolve into another canvas's directory if the leading segment were not checked.
  expect(canvasChildPath(id, "./board")).toBeNull();
  expect(canvasChildPath(id, "./other/board")).toBeNull();
});

// Written beside a CHILD, the id never appears — the sibling form is the whole point of `from`.
test("a specifier beside a child file resolves as a sibling", () => {
  expect(canvasChildPath(id, "./types", `${canvasChildDir(id)}/board.tsx`)).toBe(`${canvasChildDir(id)}/types`);
  expect(canvasChildPath(id, "./types", `${canvasChildDir(id)}/nested/board.tsx`)).toBe(`${canvasChildDir(id)}/nested/types`);
});

// `..` is rejected outright rather than normalised, so there is no arithmetic to defeat.
test("traversal is rejected rather than normalised", () => {
  expect(canvasChildPath(id, "./deck/../../secret")).toBeNull();
  expect(canvasChildPath(id, "./deck/..", `${canvasChildDir(id)}/board.tsx`)).toBeNull();
  expect(canvasChildPath("../etc", "./x")).toBeNull();
});

test("a path outside the canvases directory owns no canvas", () => {
  expect(owningCanvasIdOf(`/w/${CANVAS_DIR}/deck.ui4a.tsx`)).toBe(id);
  expect(owningCanvasIdOf(`/w/${CANVAS_DIR}/deck/board.tsx`)).toBe(id);
  expect(owningCanvasIdOf("/w/.dsh/ui4a/notes/deck.tsx")).toBeNull();
  expect(owningCanvasIdOf("/etc/passwd")).toBeNull();
});
