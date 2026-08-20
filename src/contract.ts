/**
 * The ui4a path contract — the single place that decides what counts as a canvas.
 * Shared by both halves; never re-derive these patterns with an inline regex.
 */

export const UI4A_DIR = "ui4a";
export const CANVAS_DIR = `${UI4A_DIR}/canvases`;
export const STATE_DIR = `${UI4A_DIR}/state`;
export const CANVAS_SUFFIX = ".ui4a.tsx";
/**
 * Info string of an inline fence, as the model writes it. Slash, not dash — matches
 * ui4a-playground. Note the host's markdown renderer truncates it at the first
 * non-identifier character, so it reaches the DOM as `ui4a`; nothing matches on it.
 */
export const FENCE_LANG = "ui4a/tsx";

/**
 * Canvas ids are path segments, so anything that could escape the directory is not one.
 *
 * Stated as an exclusion rather than an allowlist: `[\w-]+` reads as "safe" but is really
 * "ASCII", and a model answering in Chinese names the file in Chinese — `背单词.ui4a.tsx`
 * was silently not a canvas, so the panel never opened and the reply still said it had.
 * What actually has to be barred is separators and traversal; the rest is a filename.
 */
const CANVAS_ID = /^[^/\\.\s]+$/;

export const isCanvasId = (id: string) => CANVAS_ID.test(id);

export const canvasPath = (id: string) => `${CANVAS_DIR}/${id}${CANVAS_SUFFIX}`;
export const canvasChildDir = (id: string) => `${CANVAS_DIR}/${id}`;
export const statePath = (id: string) => `${STATE_DIR}/${id}/states.json`;

/**
 * Reduces a path to its workspace-relative form.
 *
 * Tool arguments carry absolute paths, so the contract is matched on the trailing
 * `ui4a/canvases/…` portion rather than anchored at the string start.
 */
const normalize = (path: string) => {
  const at = path.replace(/\\/g, "/").lastIndexOf(`${CANVAS_DIR}/`);
  return at === -1 ? path.replace(/^\.?\//, "") : path.slice(at);
};

/** The canvas id of an entry path, or null when the path is not a canvas entry. */
export function canvasIdOf(path: string): string | null {
  const relative = normalize(path);
  if (!relative.startsWith(`${CANVAS_DIR}/`) || !relative.endsWith(CANVAS_SUFFIX)) return null;
  const id = relative.slice(CANVAS_DIR.length + 1, -CANVAS_SUFFIX.length);
  return isCanvasId(id) ? id : null;
}

/** The owning canvas of any path under the contract — entry file or child module. */
export function owningCanvasIdOf(path: string): string | null {
  const direct = canvasIdOf(path);
  if (direct !== null) return direct;
  const relative = normalize(path);
  if (!relative.startsWith(`${CANVAS_DIR}/`)) return null;
  const id = relative.slice(CANVAS_DIR.length + 1).split("/")[0];
  return id !== undefined && isCanvasId(id) ? id : null;
}
