/**
 * Asset URLs shared by both halves. Kept apart from index.ts so the browser half
 * can import them without dragging node:fs and createRequire into its bundle.
 */
export const ASSET_PREFIX = "/dsh-generative-ui/assets";
export const WASM_PATH = `${ASSET_PREFIX}/tsx_bg.wasm`;

/** Reads one canvas file from the session's workspace: `?cwd=<workspace>&id=<canvas>`. */
export const CANVAS_READ_PATH = "/dsh-generative-ui/canvas";

/**
 * Streams one model call for a generated card: POST `{prompt|messages, system?}`.
 *
 * The host owns the credentials and the provider route, so this forwards to `ctx.llm`
 * rather than carrying a key of its own.
 */
export const AI_STREAM_PATH = "/dsh-generative-ui/ai";
