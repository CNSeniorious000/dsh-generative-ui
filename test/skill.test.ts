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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderSkillContent } from "@deepseek-ai/dsh-skill";
import { CAPABILITY_PREFIX } from "../src/contract.ts";
import { CLI_URL, mapNotes, skillEntry, skillPath, skillResourceBase, SKILL_DESCRIPTION, SKILL_NAME } from "../src/skill.ts";

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

test("the packaged entrypoint and reference base agree with the registration", () => {
  const source = readFileSync(skillPath, "utf8");
  expect(source).toContain(`name: ${SKILL_NAME}`);
  expect(source).toContain(`description: ${SKILL_DESCRIPTION}`);
  expect(readFileSync(join(skillResourceBase.path, "references/checking.md"), "utf8")).toContain(CLI_URL);
  const rendered = renderSkillContent({ name: SKILL_NAME, provider: "runtime", resourceBase: skillResourceBase, content: skillEntry("types.json", "standalone.json", true) });
  expect(rendered).toContain(`Base directory for this skill: ${skillResourceBase.path}`);
  expect(rendered).toContain("references/layout.md");
  expect(rendered).not.toContain("## Layout");
});
