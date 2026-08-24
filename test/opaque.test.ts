/**
 * A canvas written by executed code rather than by a file tool.
 *
 * 29 canvas writes in the corpus go through `run_code`, and in 27 of them the path is built
 * from a variable — so nothing in the arguments names the canvas and `collect.ts`, which
 * classifies by argument shape, cannot see any of them. The workspace listing already knows;
 * this predicate is what tells the sweep to ask it again.
 */
import { describe, expect, test } from "bun:test";
import { OPAQUE_WRITE, paintSignature } from "../src/client/canvas/index.ts";

test("code that builds the path from a variable still counts", () => {
  expect(OPAQUE_WRITE.test(String.raw`{"code": "p = base / 'canvases' / f'{name}.ui4a.tsx'; p.write_text(src)"}`)).toBe(true);
});
test("a shell command touching the directory counts", () => {
  expect(OPAQUE_WRITE.test(String.raw`{"command": "cat .dsh/ui4a/canvases/x.ui4a.tsx"}`)).toBe(true);
});
// Without the `canvases` clause an ordinary session re-lists once per command — measured on the
// corpus, one session went from 0 extra listings to 94.
test("ordinary shell work does not", () => {
  expect(OPAQUE_WRITE.test(String.raw`{"command": "ls -la", "description": "list"}`)).toBe(false);
});
// A plain write is `collect.ts`'s job and streams properly; re-listing for it would be waste.
test("a plain write is not opaque", () => {
  expect(OPAQUE_WRITE.test(String.raw`{"file_path": ".dsh/ui4a/canvases/x.ui4a.tsx", "content": "..."}`)).toBe(false);
});

/**
 * The paint signature: what stands between the canvas panel and a React render per streamed token.
 *
 * The sweep runs on every transcript mutation, so every field that belongs in the signature is a
 * repaint that must happen, and every field that does not is dozens of wasted renders a second.
 */
describe("paintSignature", () => {
  const c = (id: string, code: string, streaming = false) => ({ id, code, streaming });

  test("an unchanged sweep produces an identical signature", () => {
    const a = [c("dice", "export default () => <div />")];
    expect(paintSignature(a, ["dice"])).toBe(paintSignature([c("dice", "export default () => <div />")], ["dice"]));
  });

  test("a growing card changes it", () => {
    expect(paintSignature([c("dice", "abc")], [])).not.toBe(paintSignature([c("dice", "abcd")], []));
  });

  test("settling changes it even when the code does not", () => {
    expect(paintSignature([c("dice", "abc", true)], [])).not.toBe(paintSignature([c("dice", "abc", false)], []));
  });

  // Without this the launcher never repaints: closing the last canvas leaves `canvases` empty in
  // both sweeps, so the visible-list half of the signature is the only thing that differs.
  test("the offerable list is part of it", () => {
    expect(paintSignature([], ["dice"])).not.toBe(paintSignature([], ["dice", "notes"]));
  });

  // Same lengths, different canvases: an id-blind signature would skip the repaint entirely.
  test("two different canvases of equal length are distinguishable", () => {
    expect(paintSignature([c("dice", "abc")], [])).not.toBe(paintSignature([c("notes", "abc")], []));
  });
});
