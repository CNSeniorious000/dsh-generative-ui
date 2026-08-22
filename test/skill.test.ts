/**
 * The skill's generated paragraph about which import map serves which command.
 *
 * Three states, because the two maps have genuinely different lifetimes — the type map can
 * exist while the stub one does not. Nesting these interpolations inline is how this file
 * broke twice, and the failure mode is bad advice reaching the model rather than an exception:
 * a wrong `-i` flag makes every `$dsh/*` import report `Cannot find module`, and the model
 * then "fixes" imports that were correct.
 */
import { describe, expect, test } from "bun:test";
import { CAPABILITY_PREFIX } from "../src/contract.ts";
import { mapNotes } from "../src/skill.ts";

describe("mapNotes", () => {
  // No type map means no `-i` advice at all: telling the model to pass a flag pointing at a
  // file that does not exist is worse than saying nothing.
  test("without a type map the paragraph is empty", () => {
    expect(mapNotes(undefined, undefined)).toBe("");
    expect(mapNotes(undefined, "stub.json")).toBe("");
  });

  test("with only a type map, build and dev are called out as unsupported", () => {
    const notes = mapNotes("types.json", undefined);
    expect(notes).toContain(CAPABILITY_PREFIX);
    expect(notes).toContain("`build` and `dev` want runnable JS and will fail on it");
    // Nothing may promise a second map that is not there.
    expect(notes).not.toContain("-i stub.json");
  });

  test("with both maps, build gets the stub map by name", () => {
    const notes = mapNotes("types.json", "stub.json");
    expect(notes).toContain("-i stub.json");
    expect(notes).toContain("build <file>");
    // The earlier wording must not survive alongside the command that contradicts it.
    expect(notes).not.toContain("will fail on it");
  });

  // The tell for the interpolation bug this guards: an unevaluated `${` reaching the model.
  test("no state leaks a raw template placeholder", () => {
    for (const notes of [mapNotes("t.json", "s.json"), mapNotes("t.json", undefined), mapNotes(undefined, undefined)]) {
      expect(notes).not.toContain("${");
      expect(notes).not.toContain("undefined");
      expect(notes).not.toContain("[object Object]");
    }
  });
});
