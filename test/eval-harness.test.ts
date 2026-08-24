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

// The text assertions above check the shape; this checks the behaviour, because a script can
// contain `exit 3` and still never reach it. One second is enough — the run is killed before the
// model answers, which is exactly the case being tested.
// Skipped rather than failed where dsh is absent (CI). A skip is invisible in the pass count, so
// the three text assertions above deliberately overlap with this one: they hold everywhere.
const hasDsh = Bun.spawnSync(["which", "dsh"]).exitCode === 0;

test.skipIf(!hasDsh)("a run that exceeds EVAL_TIMEOUT reports timeout and exits 3", () => {
  const proc = Bun.spawnSync(["bash", "scripts/eval.sh", "写一个非常复杂的看板应用"], {
    env: { ...process.env, EVAL_TIMEOUT: "1" },
  });
  expect(proc.exitCode).toBe(3);
  expect(new TextDecoder().decode(proc.stdout)).toStartWith("timeout");
}, 60_000);

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
