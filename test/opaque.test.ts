/**
 * A canvas written by executed code rather than by a file tool.
 *
 * 29 canvas writes in the corpus go through `run_code`, and in 27 of them the path is built
 * from a variable — so nothing in the arguments names the canvas and `collect.ts`, which
 * classifies by argument shape, cannot see any of them. The workspace listing already knows;
 * this predicate is what tells the sweep to ask it again.
 */
import { expect, test } from "bun:test";
import { OPAQUE_WRITE } from "../src/client/canvas/index.ts";

test("code that builds the path from a variable still counts", () => { expect(OPAQUE_WRITE.test(String.raw`{"code": "p = base / 'canvases' / f'{name}.ui4a.tsx'; p.write_text(src)"}`)).toBe(true); });
test("a shell command touching the directory counts", () => { expect(OPAQUE_WRITE.test(String.raw`{"command": "cat .dsh/ui4a/canvases/x.ui4a.tsx"}`)).toBe(true); });
// Without the `canvases` clause an ordinary session re-lists once per command — measured on the
// corpus, one session went from 0 extra listings to 94.
test("ordinary shell work does not", () => { expect(OPAQUE_WRITE.test(String.raw`{"command": "ls -la", "description": "list"}`)).toBe(false); });
// A plain write is `collect.ts`'s job and streams properly; re-listing for it would be waste.
test("a plain write is not opaque", () => { expect(OPAQUE_WRITE.test(String.raw`{"file_path": ".dsh/ui4a/canvases/x.ui4a.tsx", "content": "..."}`)).toBe(false); });
