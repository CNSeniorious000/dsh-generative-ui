/**
 * The import-map paths the skill hands the model.
 *
 * These are resolved relative to the built module, so an install shape where the package root is
 * not two levels up produces a path to nothing. `fileURLToPath` does not catch that — it only
 * rejects a malformed URL and will happily return a path for a file that does not exist, which
 * is what this used to do. The model then passes it to `genui check -i`, gets `Cannot find
 * module "$dsh/fs"` on correct code, and "fixes" imports that were right.
 *
 * `mapNotes` already drops the advice when the path is undefined; the whole job here is making
 * sure undefined is what a missing file produces.
 */
import { expect, test } from "bun:test";
import { resolvedMap } from "../src/index.ts";
import { mapNotes } from "../src/skill.ts";

test("a map that is there resolves to an absolute path", () => {
  const path = resolvedMap("../types/importmap.json", import.meta.url);
  expect(path).toBeTypeOf("string");
  expect(path!.endsWith("/types/importmap.json")).toBe(true);
});

test("a map that is not there is undefined, not a path to nothing", () => {
  expect(resolvedMap("../types/no-such-map.json", import.meta.url)).toBeUndefined();
  // The install shape the comment describes: the package root is not where we assumed.
  expect(resolvedMap("../../../../types/importmap.json", import.meta.url)).toBeUndefined();
});

// The consequence, stated where it is visible: no path, no `-i` advice.
test("the skill says nothing about -i when the map is missing", () => {
  expect(mapNotes(undefined, undefined)).toBe("");
  expect(mapNotes(resolvedMap("../types/no-such-map.json", import.meta.url), undefined)).toBe("");
});
