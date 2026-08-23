import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

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
