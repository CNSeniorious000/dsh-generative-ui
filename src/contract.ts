/**
 * The ui4a path contract — the single place that decides what counts as a canvas.
 * Shared by both halves; never re-derive these patterns with an inline regex.
 */

/**
 * Where generated files live, under the workspace's own dsh directory.
 *
 * `.dsh/` is the harness's project convention, not ours — `dsh-skill-filesystem` reads
 * `join(projectRoot, ".dsh/skills")` and labels that source `project-dsh`. Sitting beside
 * it keeps a plain `ls` of the user's repo clean and puts our files where they would look
 * for anything dsh wrote. `ui4a` beneath it names the format, which is the honest nesting:
 * this is a dsh plugin writing ui4a files, not a ui4a project with a dsh corner.
 */
export const UI4A_DIR = ".dsh/ui4a";
export const CANVAS_DIR = `${UI4A_DIR}/canvases`;
export const CANVAS_SUFFIX = ".ui4a.tsx";
/**
 * Info string of an inline fence, as the model writes it. Slash, not dash — matches
 * ui4a-playground. Note the host's markdown renderer truncates it at the first
 * non-identifier character, so it reaches the DOM as `ui4a`; nothing matches on it.
 */
export const FENCE_LANG = "ui4a/tsx";

/**
 * Import prefix for the capabilities the plugin lends to generated code.
 *
 * `$dsh/`, not `$ui4a/`: what these expose is the harness — the conversation, its model,
 * its filesystem — and none of it is part of the ui4a rendering contract that `FENCE_LANG`
 * and the canvas paths above define. A card written against them only runs inside dsh.
 */
export const CAPABILITY_PREFIX = "$dsh";
export const capabilityModule = (group: string) => `${CAPABILITY_PREFIX}/${group}`;

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

/**
 * Resolves a relative specifier written inside `<id>.ui4a.tsx` to a workspace path.
 *
 * The canvas file sits in `${CANVAS_DIR}/`, so `./<id>/deck` lands in that canvas's own
 * child directory — which is the only place it may land. Every segment goes through the
 * same exclusion test as an id (no separators, no dots, no traversal), so `..` cannot
 * appear and the result cannot escape `canvasChildDir(id)`.
 *
 * Returns null for anything outside that shape rather than throwing: the caller is a
 * route answering an arbitrary page, and a bad specifier is a 400, not a crash.
 */
export function canvasChildPath(id: string, specifier: string): string | null {
  if (!isCanvasId(id)) return null;
  const bare = specifier.replace(/^\.\//, "");
  const segments = bare.split("/");
  // The specifier is written relative to the canvases dir, so it must open with the id itself.
  if (segments.length < 2 || segments[0] !== id) return null;
  if (!segments.every(isCanvasId)) return null;
  return `${canvasChildDir(id)}/${segments.slice(1).join("/")}`;
}

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
