/**
 * The mutator behind `scripts/mutation-audit.sh`.
 *
 * It has now silently mis-audited the whole tree three times: a regex that could not match
 * parens turned 27 conditions into syntax errors, and a "skip prose" guard anchored at `^`
 * skipped every *indented* statement — which is nearly all of them, and made 118 covered
 * conditions report as unconstrained. Both failures look identical to a clean audit from the
 * outside, so the mutator is checked here rather than trusted.
 */
import { expect, test } from "bun:test";

const invert = async (line: string) => {
  const file = `/tmp/invert-ifs-${Math.random().toString(36).slice(2)}.ts`;
  await Bun.write(file, line);
  await Bun.$`bun ${import.meta.dir}/../scripts/invert-ifs.mjs ${file}`.quiet();
  return (await Bun.file(file).text()).replace(/\n$/, "");
};

test("an indented statement is mutated", async () => {
  expect(await invert('    if (host === null) throw new Error("no host");')).toBe('    if (!(host === null)) throw new Error("no host");');
});

// A regex stops at the first `)`; the parens have to be counted.
test("a condition containing a call keeps its own parens", async () => {
  expect(await invert("if (!DRAWS.has(tag) && !tag.includes('-')) continue;")).toBe("if (!(!DRAWS.has(tag) && !tag.includes('-'))) continue;");
});

test("an else-if is a branch and is mutated", async () => {
  expect(await invert("  else if (chunk.type === \"finish\") write();")).toBe("  else if (!(chunk.type === \"finish\")) write();");
});

// `skill.ts` documents the AbortError check inside its prompt template. Prose is not a branch.
test("an if inside a string is left alone", async () => {
  const prose = 'one rejection is not a failure — `if (error.name === "AbortError") return;` before';
  expect(await invert(prose)).toBe(prose);
});
