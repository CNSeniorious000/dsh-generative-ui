import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

/**
 * `CLAUDE.md` is 5600 lines and every edit anchors on a phrase. A phrase that turns out not to be
 * unique — or that sits in the wrong section — drops a new section into the middle of an old one,
 * splitting an argument in half. That happened today and was found by reading, which does not
 * scale.
 *
 * Dated sections are appended, so they should be in date order. This is a cheap structural check
 * for the failure mode that reading is worst at catching.
 */
const record = readFileSync(`${import.meta.dir}/../CLAUDE.md`, "utf8");
const sections = [...record.matchAll(/^### (.*?) \((\d{4}-\d{2}-\d{2})\)$/gm)].map((m) => ({ title: m[1], date: m[2] }));

test("the record has dated sections to check", () => {
  expect(sections.length).toBeGreaterThan(100);
});

test("dated sections are in date order", () => {
  const wrong = sections.filter((s, i) => i > 0 && s.date < sections[i - 1].date).map((s) => `${s.date} ${s.title}`);
  expect(wrong).toEqual([]);
});

test("no section title appears twice", () => {
  const seen = new Map<string, number>();
  for (const { title, date } of sections) seen.set(`${title} (${date})`, (seen.get(`${title} (${date})`) ?? 0) + 1);
  expect([...seen].filter(([, n]) => n > 1).map(([k]) => k)).toEqual([]);
});

/**
 * Every repo path the record names should exist, or the reader goes looking for a file that was
 * deleted a week ago. Two were dangling when this was written: one already flagged in-line as
 * fictional, one a historical account of a script since removed.
 *
 * Paths inside a *historical* passage are legitimate — the fix is a note saying so, not deleting
 * the story — so a line may opt out by saying the file is gone.
 */
const paths = [...record.matchAll(/`((?:scripts|test|src)\/[\w./-]+\.(?:ts|tsx|sh|py|mjs|md|json))`/g)];

test("every repo path the record names exists", () => {
  const missing = new Set<string>();
  for (const match of paths) {
    const path = match[1];
    if (existsSync(`${import.meta.dir}/../${path}`)) continue;
    // The paragraph around it may explain that the file is gone, or that it belongs to another
    // repository — `obsidian-ui4a-renderer`'s `src/styling.ts` is named as a reference, not as
    // something here.
    const around = record.slice(Math.max(0, match.index - 900), match.index + 900);
    if (/does not exist|is gone|since removed|was removed|no longer exists|deleted/.test(around)) continue;
    const line = record.slice(record.lastIndexOf("\n", match.index) + 1, record.indexOf("\n", match.index));
    if (/`[\w-]+\/[\w-]+`'s|from [\w-]+\/[\w-]+|upstream|another repo/.test(line)) continue;
    missing.add(path);
  }
  expect([...missing]).toEqual([]);
});
