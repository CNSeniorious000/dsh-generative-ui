import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * `eval.sh` is the instrument every prompt measurement goes through, and it has been wrong in ways
 * that produced plausible numbers twice: it wrote its transcript into the workspace the model could
 * edit (and one run in six did edit it), and it had no timeout, so a hung run was indistinguishable
 * from a slow one. Neither failure announced itself.
 */
const script = readFileSync("scripts/eval.sh", "utf8");

test("the transcript lives outside the workspace", () => {
  // `out` must not be built from `$d`, the directory the model works in.
  expect(script).not.toMatch(/out=.*\$d/);
  expect(script).toMatch(/out=\$\(mktemp\)/);
});

test("a hung run is reported separately from a dead one", () => {
  expect(script).toContain("echo \"timeout");
  expect(script).toContain("echo \"crash");
  // and with distinct exit codes, since callers branch on them
  expect(script).toMatch(/exit 3/);
  expect(script).toMatch(/exit 2/);
});

test("the reply path is printed, so a caller can read the card", () => {
  expect(script).toContain("reply=$out");
});

// A rule in the SKILL can only be measured on a run that loaded it. Three conclusions were written
// from runs that never called `skill` — the tool list carried it and was read past every time, so
// it is now the first word on the line.
test("whether the skill loaded is reported, not left in the tool list", () => {
  expect(script).toContain("skill=$skill");
  expect(script).toMatch(/skill=\$\(.*skillx/);
});

// The text assertions above check the shape; this checks the behaviour, because a script can
// contain `exit 3` and still never reach it. One second is enough — the run is killed before the
// model answers, which is exactly the case being tested.
// Skipped rather than failed where dsh is absent (CI). A skip is invisible in the pass count, so
// the three text assertions above deliberately overlap with this one: they hold everywhere.
const hasDsh = Bun.spawnSync(["which", "dsh"]).exitCode === 0;

// Build first, deliberately. The staleness guard exits 4 BEFORE the timeout can fire, and `src/`
// goes "newer" than `lib/` for reasons that are not edits at all — a `git checkout` or a restored
// backup bumps an mtime. Without this the test measures which guard ran first, which is not what
// it is asking about, and it fails on a tree nobody has changed.
test.skipIf(!hasDsh)("a run that exceeds EVAL_TIMEOUT reports timeout and exits 3", () => {
  expect(Bun.spawnSync(["bun", "run", "build"]).exitCode).toBe(0);
  const proc = Bun.spawnSync(["bash", "scripts/eval.sh", "写一个非常复杂的看板应用"], {
    env: { ...process.env, EVAL_TIMEOUT: "1" },
  });
  expect(proc.exitCode).toBe(3);
  expect(new TextDecoder().decode(proc.stdout)).toStartWith("timeout");
}, 120_000);

// The failure that cost an afternoon: the profile's plugin was a symlink to a *different* checkout,
// so six prompt A/Bs in a row measured one unchanged prompt. Nothing about a stale build looks
// wrong — the runs succeed and produce exactly the numbers an ineffective rule would.
test("a plugin symlink pointing elsewhere is refused", () => {
  expect(script).toContain("stale  the headless profile loads");
  expect(script).toMatch(/exit 4/);
});

test("a build older than the source is refused", () => {
  expect(script).toContain("src/ is newer than lib/");
});

// The grid must stop rather than record a stale run as a data point.
test("run-fixtures aborts on a stale plugin", () => {
  const grid = readFileSync("scripts/run-fixtures.sh", "utf8");
  expect(grid).toMatch(/stale\*\)/);
});
