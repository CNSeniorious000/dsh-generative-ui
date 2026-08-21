/**
 * Reads a canvas's current file contents through the plugin's own host route.
 *
 * Needed because `edit`-style tool calls carry a patch rather than the file: after one,
 * the tool-call stream no longer describes the canvas and only the file does.
 */
import { CANVAS_READ_PATH } from "../../contract-assets.ts";

/** Monotonic per-read, so no two reads of one canvas can share a cache entry. */
let readSerial = 0;

/** Every canvas in the workspace, including ones this session never wrote. */
export async function listCanvasIds(cwd: string): Promise<readonly string[]> {
  try {
    const response = await fetch(`${CANVAS_READ_PATH}?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
    return response.ok ? ((await response.json()) as string[]) : [];
  } catch {
    return [];
  }
}

export async function readCanvasFile(cwd: string, id: string): Promise<string | null> {
  // A distinct URL per read on top of `no-store`: the file is re-read precisely because it
  // changed, so any reuse of an earlier response is guaranteed to be the wrong answer.
  readSerial += 1;
  const url = `${CANVAS_READ_PATH}?cwd=${encodeURIComponent(cwd)}&id=${encodeURIComponent(id)}&r=${readSerial}`;
  try {
    // `cache: "no-store"` on the request as well as the response: a canvas is re-read
    // precisely because it just changed, and a cached body is the one answer that is
    // guaranteed wrong.
    const response = await fetch(url, { cache: "no-store" });
    // 404 is ordinary: a canvas whose write is still streaming has no file yet.
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}
