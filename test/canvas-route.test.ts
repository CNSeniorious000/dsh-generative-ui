/**
 * The canvas read route, against a real directory.
 *
 * The listing is the launcher's only source of truth for a canvas this session did not write —
 * including one written by executed code, which `collect.ts` cannot see at all (see the
 * `OPAQUE_WRITE` note in `client/canvas/index.ts`). Nothing tested it until that fix landed,
 * so "the listing already knows" was an assumption about a route with no coverage.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CANVAS_DIR } from "../src/contract.ts";
import { serveCanvas } from "../src/index.ts";

const cwd = mkdtempSync(join(tmpdir(), "ui4a-route-"));
mkdirSync(join(cwd, CANVAS_DIR), { recursive: true });
writeFileSync(join(cwd, CANVAS_DIR, "dice.ui4a.tsx"), "export default () => <div />");
writeFileSync(join(cwd, CANVAS_DIR, "背单词.ui4a.tsx"), "export default () => <div />");
writeFileSync(join(cwd, CANVAS_DIR, "notes.txt"), "not a canvas");
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

/** A minimal ServerResponse: the handler only ever calls writeHead/end. */
const call = async (query: string, live: ReadonlySet<string> = new Set([cwd])) => {
  let status = 0, body = "";
  const res = { writeHead(code: number) { status = code; return res }, end(chunk?: string) { body = chunk ?? ""; return res } };
  await serveCanvas(() => live, { method: "GET", url: `/x?${query}` } as never, res as never);
  return { status, body };
};

describe("canvas listing", () => {
  test("lists every canvas, non-ASCII ids included", async () => {
    const { status, body } = await call(`cwd=${encodeURIComponent(cwd)}`);
    expect(status).toBe(200);
    expect(JSON.parse(body).toSorted()).toEqual(["dice", "背单词"]);
  });

  test("a file that is not a canvas is not listed", async () => {
    expect(JSON.parse((await call(`cwd=${encodeURIComponent(cwd)}`)).body)).not.toContain("notes");
  });

  // The fence that makes the route safe to expose: a cwd the session does not own is refused
  // before any filesystem call, so the route cannot be used to read arbitrary directories.
  test("a workspace this session does not own is refused", async () => {
    expect((await call(`cwd=${encodeURIComponent(cwd)}`, new Set())).status).toBe(403);
  });

  // The claim the OPAQUE_WRITE fix rests on: a canvas that appears on disk mid-session, named
  // by nothing in any tool call, is visible to a second listing. Without this the fix is an
  // assumption — re-listing is only worth anything if the listing sees what arrived after it.
  test("a canvas that appears after the first listing shows up in the next one", async () => {
    const before = JSON.parse((await call(`cwd=${encodeURIComponent(cwd)}`)).body) as string[];
    expect(before).not.toContain("late-arrival");
    writeFileSync(join(cwd, CANVAS_DIR, "late-arrival.ui4a.tsx"), "export default () => <div />");
    expect(JSON.parse((await call(`cwd=${encodeURIComponent(cwd)}`)).body)).toContain("late-arrival");
  });

  test("a missing canvases directory lists empty rather than failing", async () => {
    const bare = mkdtempSync(join(tmpdir(), "ui4a-bare-"));
    const { status, body } = await call(`cwd=${encodeURIComponent(bare)}`, new Set([bare]));
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual([]);
    rmSync(bare, { recursive: true, force: true });
  });
});

describe("sub-page reads", () => {
  test("a sibling specifier resolves to the child file", async () => {
    mkdirSync(join(cwd, CANVAS_DIR, "tarot"), { recursive: true });
    writeFileSync(join(cwd, CANVAS_DIR, "tarot", "deck.tsx"), "export const DECK = []");
    const { status, body } = await call(`cwd=${encodeURIComponent(cwd)}&id=tarot&child=${encodeURIComponent("./deck")}&from=${encodeURIComponent(`${CANVAS_DIR}/tarot/board.tsx`)}`);
    expect(status).toBe(200);
    expect(body).toBe("export const DECK = []");
  });

  // The fence. `canvasChildPath` is unit-tested, but nothing checked that the ROUTE refuses what
  // it rejects — and this is the parameter an attacker controls.
  //
  // Each escape must name a file that REALLY EXISTS and really is outside the child directory.
  // The first version of this test used `../../../../etc/passwd` and passed with the entire
  // fence deleted: relative to a tmpdir that path resolves to nothing, so the 404 looked like a
  // refusal. A traversal test that cannot reach a real file tests nothing.
  test("a specifier escaping the child directory is refused", async () => {
    writeFileSync(join(cwd, "secret.txt"), "SECRET");
    mkdirSync(join(cwd, CANVAS_DIR, "other"), { recursive: true });
    writeFileSync(join(cwd, CANVAS_DIR, "other", "private.tsx"), "OTHER CANVAS");
    const from = encodeURIComponent(`${CANVAS_DIR}/tarot/board.tsx`);
    for (const escape of ["../../../secret.txt", "../other/private", "./../other/private"]) {
      const { status, body } = await call(`cwd=${encodeURIComponent(cwd)}&id=tarot&child=${encodeURIComponent(escape)}&from=${from}`);
      expect(status).toBe(400);
      expect(body).not.toContain("SECRET");
      expect(body).not.toContain("OTHER CANVAS");
    }
  });

  test("a specifier naming no file is a 404, not a 200 with an empty body", async () => {
    const { status } = await call(`cwd=${encodeURIComponent(cwd)}&id=tarot&child=${encodeURIComponent("./missing")}&from=${encodeURIComponent(`${CANVAS_DIR}/tarot/board.tsx`)}`);
    expect(status).toBe(404);
  });
});
