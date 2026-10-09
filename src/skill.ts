/**
 * Runtime registration for the packaged skill entrypoint and its references.
 *
 * `dsh-base` mounts `dsh-skill` + `dsh-tool-skill` by default, so a runtime registration here
 * shows up in the model's `<available_skills>` catalog and its body is fetched only when the
 * model calls `skill({ name })`. The entrypoint then routes to packaged references, which are
 * read only when the card needs them. The resident prompt stays short for pure-prose turns.
 *
 * The catalog carries `name` and `description` **only** — not `whenToUse`, not the body — so the
 * description is the entire routing signal and has to name the trigger, not summarise the content.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CANVAS_DIR, CANVAS_SUFFIX, CAPABILITY_PREFIX, FENCE_LANG } from "./contract.ts";

/** The checker, from pkg.pr.new: @genui/cli is a private workspace package and not on npm. Exported for `scripts/site.ts`, which builds the landing page with the same CLI. */
export const CLI_URL = "https://pkg.pr.new/MindLab-Research/macaron-genui-demo/@genui/cli@main";
// How to run `@genui/cli` straight from that URL. One constant because the two places that print a
// command must not drift apart, and because each runner needs something different from the others —
// see the paragraph under "Check it before you hand it over", where all three are spelled out.
const RUN_CLI = `BUN_INSTALL_CACHE_DIR="$TMPDIR/bun-cache" bunx --yes genui@${CLI_URL}`;

export const SKILL_NAME = "generative-ui";

export const SKILL_DESCRIPTION = `How to decide between an inline ${FENCE_LANG} block, a canvas file, and plain prose — and how to lay one out so it reads. Load it **before you decide**, not after — including when your first instinct is that prose is enough. Most of the questions that should have been an interface do not ask for one.`;

/**
 * Checker map notes added to the entrypoint at runtime.
 *
 * A function of the import-map path because that path is only known at runtime — the plugin
 * lives wherever the profile installed it, and the model runs the checker from the workspace.
 * Without the map, `check` reports `Cannot find module "$dsh/chat"` on every card that uses
 * one, and a false error is worse than no check: the model goes and "fixes" it.
 */
/**
 * The paragraph about which import map serves which command.
 *
 * Built here rather than inline: nesting one template interpolation inside another inside the
 * body is how this file broke twice, and the two maps have genuinely different lifetimes —
 * the type one may exist while the stub one does not.
 */
/** The checker paths are only known after the package is installed. */
export function mapNotes(typesMap: string | undefined, standaloneMap: string | undefined): string {
  if (typesMap === undefined) return "";
  const check = [
    // A card is created BY its path. Checking a draft somewhere else therefore produces a card
    // nothing will ever mount — measured once in wave 8: a complete 150-line routine written to
    // `rutina.tsx` in the workspace root, because the model planned "write a temp file, then run
    // the checker" and the checker step never finished. It reads as the model declining to build.
    `**Check the canvas file itself, at \`${CANVAS_DIR}/<id>${CANVAS_SUFFIX}\`.** Writing that path is what creates the`,
    "canvas, so there is no draft stage to check first: a `.tsx` anywhere else is a file the user",
    "will never see, however correct it is. Write it where it belongs, then check it there and fix",
    "it in place — the panel streams as you write and re-renders as you edit.",
    "",
    `The \`-i\` is not optional when the card imports \`${CAPABILITY_PREFIX}/*\`: without it every one of those lines`,
    "is reported as `Cannot find module`, and there is nothing to fix — they resolve at render time.",
    "",
    "**It silences that error rather than typing the calls.** Measured: a map pointing at a file",
    "that does not exist reports `OK` just the same, so `$dsh/*` ends up `any` and a wrong",
    "argument or a misspelt result field passes the check. Everything else in the card is really",
    "type-checked; the capability calls are on you.",
    "",
    "",
    "One more diagnostic never to skim past: *referenced directly or indirectly in its own initializer*. It means",
    "a `const` shadows something of the same name and now refers to itself — `const rows = useMemo(() => rows(x), [x])`",
    "beside a top-level `function rows`. That throws on the first render and the card is blank, and it arrives",
    "surrounded by ordinary `implicitly has an 'any' type` lines that are safe to ignore. Rename the local.",
    "That map holds type declarations, so it serves `check` and `lint`.",
  ].join("\n");
  if (standaloneMap === undefined) return `${check} \`build\` and \`dev\` want runnable JS and will fail on it.`;
  return [
    `${check} \`build\` and \`dev\` want runnable JS, so they take a different one:`,
    "",
    "```",
    `${RUN_CLI} build <file> -i ${standaloneMap}`,
    "```",
    "",
    `That second map stubs \`${CAPABILITY_PREFIX}/*\` — the exported page has no dsh around it, so those calls log to`,
    "the console and return empty instead of working. The layout, the styling and everything that",
    "does not touch the harness are real; anything that does is inert. Useful for showing someone a",
    "snapshot, not for testing the interactive parts.",
  ].join("\n");
}

/**
 * The directory is beside both src/skill.ts and lib/index.js. dsh includes this base in the
 * skill tool result, so relative references resolve against the installed package.
 */
export const skillResourceBase = { kind: "directory", path: fileURLToPath(new URL("../skill/", import.meta.url)) } as const;
export const skillPath = fileURLToPath(new URL("../skill/SKILL.md", import.meta.url));

const readSkill = (relative: string): string => readFileSync(new URL(`../skill/${relative}`, import.meta.url), "utf8");
const stripFrontmatter = (text: string): string => text.replace(/^---\n[\s\S]*?\n---\n\n/, "");
const EXEC_REFERENCE = "<!-- exec-reference: included only on hosts where the command route is enabled -->";

/** Only this entrypoint is sent by the skill tool; topic references stay on disk until needed. */
export function skillEntry(typesMap: string | undefined, standaloneMap: string | undefined, allowExec = false): string {
  const core = stripFrontmatter(readSkill("SKILL.md")).replace(EXEC_REFERENCE, allowExec ? "- For non-destructive workspace commands: [commands.md](references/commands.md)." : "");
  const maps = mapNotes(typesMap, standaloneMap);
  return core + (maps ? `\n## Checker import maps\n\n${maps}\n` : "\n## Checker import maps\n\nNo type import map is installed here. Omit `-i` from `check`; use the live panel to verify harness calls.\n");
}

/** Complete text for consistency checks; production registers only skillEntry(). */
export function skillBody(typesMap: string | undefined, standaloneMap: string | undefined, allowExec = false): string {
  const refs = ["lifetime", "layout", "accessibility", "sound", "runtime", ...(allowExec ? ["commands"] : []), "web", "files", "ai", "checking", "imports"];
  return skillEntry(typesMap, standaloneMap, allowExec) + refs.map((name) => `\n${readSkill(`references/${name}.md`)}`).join("");
}
