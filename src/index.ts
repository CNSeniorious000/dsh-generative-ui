/**
 * Host half — serves the @esm.sh/tsx wasm the browser half compiles TSX with.
 *
 * The shell's /plugins route hard-codes the `/client.js` and `/client.js.map`
 * suffixes and 404s everything else, and dsh-host-frontend-static owns the sole
 * fallback seat (and answers misses with index.html + 200, so dropping the wasm
 * there would fail as a confusing magic-word error). A plugin-owned webServer
 * route is the way to ship bytes; dsh-latex-tools serves MathJax the same way.
 * @module dsh-generative-ui
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-host-webserver";
import type {} from "@deepseek-ai/dsh-system-prompt";
import type {} from "@deepseek-ai/dsh-skill";
import { ASSET_PREFIX, CANVAS_READ_PATH, WASM_PATH } from "./contract-assets.ts";
import { canvasPath, isCanvasId } from "./contract.ts";
import { INLINE_PROMPT, PROMPT_SECTION_NAME, PROMPT_SECTION_ORDER } from "./prompt.ts";
import { SKILL_BODY, SKILL_DESCRIPTION, SKILL_NAME } from "./skill.ts";

export const name = "dsh-generative-ui";
export const inject = ["systemPrompt"];

// Namespaced by package name because a duplicate (kind, path) throws, and a throw during apply silently fails the whole plugin.
export { ASSET_PREFIX, WASM_PATH } from "./contract-assets.ts";

/** Resolved from this module's own location so pnpm's nested install is anchored against the plugin, not the profile tree. */
const wasmFile = (importMetaUrl: string) => createRequire(importMetaUrl).resolve("@esm.sh/tsx/pkg/tsx_bg.wasm");

async function serveAsset(req: IncomingMessage, res: ServerResponse, file: string): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") return void res.writeHead(405).end();
  const pathname = new URL(req.url ?? "/", "http://x").pathname;
  if (pathname !== WASM_PATH) return void res.writeHead(404).end();
  // instantiateStreaming rejects anything whose content-type is not exactly application/wasm.
  res.writeHead(200, { "content-type": "application/wasm", "cache-control": "public, max-age=31536000, immutable" });
  res.end(await readFile(file));
}

/**
 * Serves one canvas file's current contents.
 *
 * The client could reconstruct a canvas from `write` tool arguments alone, and does while
 * a write streams — but a model routinely follows a write with several `edit` calls, whose
 * arguments carry a patch rather than the file. Reading the file is the only source that
 * stays correct across every way it can change, including edits made outside the agent.
 *
 * Confined to the canvas directory by construction: the caller passes a workspace and a
 * canvas id, and the path is built from the contract rather than taken from the request.
 */
async function serveCanvas(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") return void res.writeHead(405).end();
  const url = new URL(req.url ?? "/", "http://x");
  const cwd = url.searchParams.get("cwd");
  const id = url.searchParams.get("id");
  // The id is a path segment by contract; anything else cannot name a canvas.
  if (cwd === null || id === null || !isCanvasId(id)) return void res.writeHead(400).end();
  try {
    const code = await readFile(join(cwd, canvasPath(id)), "utf8");
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end(code);
  } catch {
    // A canvas whose write is still streaming has no file yet; the client keeps its own copy.
    res.writeHead(404).end();
  }
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.systemPrompt.section({ name: PROMPT_SECTION_NAME, order: PROMPT_SECTION_ORDER, text: INLINE_PROMPT }), "dsh-generative-ui: inline prompt");
  // Both routes only matter to a browser half that exists to consume them. Scoped rather than
  // required so the plugin still teaches the model on a profile with no web server at all —
  // `dsh --profile headless` has no `webServer`, and a required injection there means the
  // prompt and the skill go missing too, which is the whole plugin.
  ctx.inject(["webServer"], (scoped) => {
    const file = wasmFile(import.meta.url);
    scoped.effect(() => scoped.webServer.register({ kind: "prefix", path: ASSET_PREFIX, handler: (req, res) => serveAsset(req, res, file) }), "dsh-generative-ui: tsx wasm");
    scoped.effect(() => scoped.webServer.register({ kind: "exact", path: CANVAS_READ_PATH, handler: serveCanvas }), "dsh-generative-ui: canvas reads");
  });
  // Scoped rather than listed in `inject`: cordis has no optional injection, so naming "skills"
  // there would keep the whole plugin — wasm route included — inactive wherever the skill
  // subsystem is disabled. Nested, only the skill goes missing.
  // Model-only: `/generative-ui` as a user command would just print the guidance at the user.
  ctx.inject(["skills"], (scoped) => {
    scoped.effect(() => scoped.skills.register({ name: SKILL_NAME, description: SKILL_DESCRIPTION, content: SKILL_BODY, source: "runtime", invocation: { modelInvocable: true, userInvocable: false } }), "dsh-generative-ui: skill");
  });
}
