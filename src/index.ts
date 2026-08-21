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

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-host-webserver";
import type {} from "@deepseek-ai/dsh-system-prompt";
import type {} from "@deepseek-ai/dsh-skill";
// A value import, unlike the others: `llm.stream` rejects a plain `{role, content}` object,
// and this is the constructor that stamps the identity and source tags it requires.
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { AI_STREAM_PATH, ASSET_PREFIX, CANVAS_READ_PATH, FS_PATH, WASM_PATH } from "./contract-assets.ts";
import { CANVAS_DIR, canvasIdOf, canvasPath, isCanvasId } from "./contract.ts";
import { INLINE_PROMPT, PROMPT_SECTION_NAME, PROMPT_SECTION_ORDER } from "./prompt.ts";
import { skillBody, SKILL_DESCRIPTION, SKILL_NAME } from "./skill.ts";

export const name = "dsh-generative-ui";
export const inject = ["systemPrompt"];

// Namespaced by package name because a duplicate (kind, path) throws, and a throw during apply silently fails the whole plugin.
export { ASSET_PREFIX, WASM_PATH } from "./contract-assets.ts";

/** Resolved from this module's own location so pnpm's nested install is anchored against the plugin, not the profile tree. */
const wasmFile = (importMetaUrl: string) => createRequire(importMetaUrl).resolve("@esm.sh/tsx/pkg/tsx_bg.wasm");

/**
 * Absolute path of the import map that types `$dsh/*` for `genui check`.
 *
 * Resolved rather than hard-coded because the plugin lives wherever the profile installed it,
 * and the model runs the checker from the workspace — it has no way to guess that path.
 */
const typesImportMap = (importMetaUrl: string): string | undefined => {
  try {
    return fileURLToPath(new URL("../types/importmap.json", importMetaUrl));
  } catch {
    // Installed in a shape where the package root is not two levels up. The skill drops the
    // `-i` flag rather than passing a path that does not exist.
    return undefined;
  }
};

async function serveAsset(req: IncomingMessage, res: ServerResponse, file: string): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") return void res.writeHead(405).end();
  const pathname = new URL(req.url ?? "/", "http://x").pathname;
  if (pathname !== WASM_PATH) return void res.writeHead(404).end();
  // instantiateStreaming rejects anything whose content-type is not exactly application/wasm.
  res.writeHead(200, { "content-type": "application/wasm", "cache-control": "public, max-age=31536000, immutable" });
  res.end(await readFile(file));
}

/**
 * Serves one canvas file's current contents, or — with no `id` — the ids of every canvas
 * in the workspace.
 *
 * The client could reconstruct a canvas from `write` tool arguments alone, and does while
 * a write streams — but a model routinely follows a write with several `edit` calls, whose
 * arguments carry a patch rather than the file. Reading the file is the only source that
 * stays correct across every way it can change, including edits made outside the agent.
 *
 * Confined to the canvas directory by construction — the id is a path segment and the path
 * is built from the contract — and to a live session's own workspace by the `cwd` check.
 *
 * That check is the security boundary, not a formality. This route answers any page the
 * user has open: a simple GET triggers no preflight, so without it `?cwd=/anywhere` turns
 * the plugin into a file-existence oracle for the whole disk. The client only ever sends
 * the cwd it read off the current session, so matching against live sessions costs nothing.
 */
async function serveCanvas(liveWorkspaces: () => ReadonlySet<string>, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") return void res.writeHead(405).end();
  const url = new URL(req.url ?? "/", "http://x");
  const cwd = url.searchParams.get("cwd");
  const id = url.searchParams.get("id");
  // The id is a path segment by contract; anything else cannot name a canvas.
  if (cwd === null || (id !== null && !isCanvasId(id))) return void res.writeHead(400).end();
  if (!liveWorkspaces().has(cwd)) return void res.writeHead(403).end();
  // No id: list the directory. A canvas outlives the session that wrote it, so the panel
  // needs a source beyond the current transcript to offer one written yesterday.
  if (id === null) {
    const ids = await readdir(join(cwd, CANVAS_DIR)).then((names) => names.flatMap((name) => { const found = canvasIdOf(`${CANVAS_DIR}/${name}`); return found === null ? [] : [found]; }), () => []);
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    return void res.end(JSON.stringify(ids));
  }
  try {
    const code = await readFile(join(cwd, canvasPath(id)), "utf8");
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end(code);
  } catch {
    // A canvas whose write is still streaming has no file yet; the client keeps its own copy.
    res.writeHead(404).end();
  }
}

/** Context shape for the filesystem route; see the SessionStoreCtx note on why it is local. */
type FsCtx = {
  fs: {
    resolve: (path: string, opts?: { cwd?: string }) => Promise<FsTargetLike>;
    readText: (target: FsTargetLike) => Promise<string>;
    listDir: (target: FsTargetLike) => Promise<{ name: string; kind?: string }[]>;
    writeText: (target: FsTargetLike, content: string, expected?: undefined, signal?: AbortSignal, policy?: unknown) => Promise<unknown>;
  };
  sandboxPolicy: { resolve: (request?: { session?: unknown }) => unknown };
  sessions: { list: () => readonly { id?: string; header: { cwd?: string } }[] };
};
type FsTargetLike = { targetKey: unknown; displayPath: string };

/**
 * Reads, lists, and writes on behalf of a generated card.
 *
 * Everything goes through the host's `ctx.fs` carrying the session's own
 * `ctx.sandboxPolicy`, so **a card may do exactly what the session may do** — under
 * `read-only` the write is refused by the same fence that refuses the model's, with the
 * same structured denial. Inventing a narrower boundary here would mean a second policy to
 * keep in sync with the one the user actually sees in the composer.
 *
 * The `cwd` allowlist is still required, for the reason the canvas route documents: any page
 * the user has open can call this, so without it the workspace is not the workspace.
 */
async function serveFs(ctx: FsCtx, liveWorkspaces: () => ReadonlySet<string>, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://x");
  const cwd = url.searchParams.get("cwd");
  const path = url.searchParams.get("path");
  if (cwd === null || path === null || path === "") return void res.writeHead(400).end();
  if (!liveWorkspaces().has(cwd)) return void res.writeHead(403).end();

  const json = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  // A denial is an answer, not a crash: the card needs to tell "you may not" from "it broke".
  const failed = (error: unknown): void => {
    const code = (error as { code?: string } | undefined)?.code;
    json(code === "FS_SANDBOX_DENIED" ? 403 : 404, { error: code ?? (error instanceof Error ? error.message : String(error)) });
  };

  try {
    const target = await ctx.fs.resolve(path, { cwd });
    if (req.method === "GET") {
      if (url.searchParams.get("list") !== null) return json(200, { entries: await ctx.fs.listDir(target) });
      return json(200, { content: await ctx.fs.readText(target) });
    }
    if (req.method !== "POST") return void res.writeHead(405).end();

    let body = "";
    for await (const chunk of req) {
      body += chunk as string;
      if (body.length > MAX_BODY) return void res.writeHead(413).end();
    }
    let content: string;
    try {
      ({ content } = JSON.parse(body) as { content: string });
    } catch {
      return void res.writeHead(400).end();
    }
    if (typeof content !== "string") return void res.writeHead(400).end();
    // The session's policy, not ours: the composer's access mode is what decides. Addressed
    // by id, not found by cwd — several sessions share one workspace, and picking the first
    // of them silently runs the write under a stranger's access mode.
    const sessionId = url.searchParams.get("session");
    const session = sessionId === null ? undefined : ctx.sessions.list().find((entry) => entry.id === sessionId);
    if (session === undefined) return void res.writeHead(400).end();
    await ctx.fs.writeText(target, content, undefined, undefined, ctx.sandboxPolicy.resolve({ session }));
    return json(200, { written: target.displayPath });
  } catch (error) {
    return failed(error);
  }
}

/** Context shape for the two services the AI route needs; see the SessionStoreCtx note. */
type LlmCtx = {
  llm: { stream: (options: { provider: string; model: string; messages: readonly unknown[]; system?: string; signal?: AbortSignal }) => AsyncIterable<{ type: string; text?: string; reason?: { kind: string; failure?: { message?: string } } }> };
  agentDefaultModel: { currentSelection: () => { provider: string; model: string } };
};

/** Largest request body accepted by either POST route, so a runaway card cannot exhaust memory. */
const MAX_BODY = 64 * 1024;

/**
 * Streams one model call on behalf of a generated card.
 *
 * The card cannot call a provider itself — it has no credentials and should never be given
 * any. `ctx.llm` already owns the adapter registry, the retry policy and the keys, and
 * `agentDefaultModel` owns which model the app is set to, so this route is a forwarder:
 * it converts a small JSON request into `llm.stream` and pipes the text deltas back.
 *
 * Same `cwd` allowlist as the canvas route, and for the same reason: any page the user has
 * open can POST here, so without it this is an open model proxy for anything on the machine.
 */
async function serveAi(ctx: LlmCtx, liveWorkspaces: () => ReadonlySet<string>, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return void res.writeHead(405).end();
  const url = new URL(req.url ?? "/", "http://x");
  const cwd = url.searchParams.get("cwd");
  if (cwd === null) return void res.writeHead(400).end();
  if (!liveWorkspaces().has(cwd)) return void res.writeHead(403).end();

  let body = "";
  for await (const chunk of req) {
    body += chunk as string;
    if (body.length > MAX_BODY) return void res.writeHead(413).end();
  }

  let request: { prompt?: string; system?: string };
  try {
    request = JSON.parse(body) as typeof request;
  } catch {
    return void res.writeHead(400).end();
  }
  if (request.prompt === undefined || request.prompt === "") return void res.writeHead(400).end();
  // One user turn, deliberately: `llm.stream` will not take a bare `{role, content}` — a
  // message carries an identity and a source tag — and the assistant-side constructor wants
  // provider, model and replay state, which means a multi-turn API here would be forging
  // turns the model never produced. Anything a card needs from an earlier turn belongs in
  // the prompt it builds.
  const messages = [createUserMessage({ content: [{ type: "text", text: request.prompt }], source: { kind: "plugin", plugin: "dsh-generative-ui" } })];

  const selection = ctx.agentDefaultModel.currentSelection();
  // Abort the model call when the reader navigates away or the card unmounts; without this
  // a closed tab leaves a generation running and billing.
  const controller = new AbortController();
  req.on("close", () => controller.abort());

  res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" });
  try {
    for await (const chunk of ctx.llm.stream({ ...selection, messages, system: request.system, signal: controller.signal })) {
      if (chunk.type === "text-delta" && chunk.text !== undefined) res.write(chunk.text);
      // A failed call finishes rather than throwing, so without this the card sees a clean
      // empty 200 and reports "the model said nothing" — indistinguishable from a real
      // empty answer. Trailing the reason is the only channel left once the body has begun.
      // `reason` is an object with a `kind`, not a string: interpolating it directly writes
      // `[object Object]`, which is how this was first shipped.
      else if (chunk.type === "finish" && chunk.reason !== undefined && chunk.reason.kind !== "stop") res.write(`\n\n[${chunk.reason.kind}${chunk.reason.failure?.message === undefined ? "" : `: ${chunk.reason.failure.message}`}]`);
    }
  } catch (error) {
    // Headers are already out, so this cannot become a status code.
    res.write(`\n\n[error: ${error instanceof Error ? error.message : String(error)}]`);
  }
  res.end();
}

/** Live sessions' workspaces. Typed locally: a global `dsh-session` merge would also rewrite
 *  the client half's `ctx.sessions`, which is a different service entirely. */
type SessionStoreCtx = { sessions: { list: () => readonly { header: { cwd?: string } }[] } };

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.systemPrompt.section({ name: PROMPT_SECTION_NAME, order: PROMPT_SECTION_ORDER, text: INLINE_PROMPT }), "dsh-generative-ui: inline prompt");
  // Both routes only matter to a browser half that exists to consume them. Scoped rather than
  // required so the plugin still teaches the model on a profile with no web server at all —
  // `dsh --profile headless` has no `webServer`, and a required injection there means the
  // prompt and the skill go missing too, which is the whole plugin.
  //
  // `sessions` rides along because the canvas route needs it to authorize a workspace, and
  // cordis enforces injection at access time: reading `ctx.sessions` without declaring it
  // throws "cannot get property ... without inject" inside the request, which the host turns
  // into a bare 400. Declaring it here rather than in the static `inject` keeps the headless
  // profile working, same as the other two.
  ctx.inject(["webServer", "sessions"], (scoped) => {
    const file = wasmFile(import.meta.url);
    const liveWorkspaces = (): ReadonlySet<string> => {
      const sessions = (scoped as unknown as SessionStoreCtx).sessions.list();
      return new Set(sessions.flatMap((session) => (session.header.cwd === undefined ? [] : [session.header.cwd])));
    };
    scoped.effect(() => scoped.webServer.register({ kind: "prefix", path: ASSET_PREFIX, handler: (req, res) => serveAsset(req, res, file) }), "dsh-generative-ui: tsx wasm");
    scoped.effect(() => scoped.webServer.register({ kind: "exact", path: CANVAS_READ_PATH, handler: (req, res) => serveCanvas(liveWorkspaces, req, res) }), "dsh-generative-ui: canvas reads");
    // One level deeper again: a deployment can mount a web server without an LLM runtime, and
    // losing `$dsh/ai` there should not take the wasm and canvas routes down with it.
    // Same shape again: a deployment can serve the web without a sandboxed filesystem, and
    // losing `$dsh/fs` there should not cost the routes above it.
    scoped.inject(["fs", "sandboxPolicy"], (withFs) => {
      withFs.effect(() => withFs.webServer.register({ kind: "exact", path: FS_PATH, handler: (req, res) => serveFs(withFs as unknown as FsCtx, liveWorkspaces, req, res) }), "dsh-generative-ui: workspace files");
    });
    scoped.inject(["llm", "agentDefaultModel"], (withLlm) => {
      withLlm.effect(() => withLlm.webServer.register({ kind: "exact", path: AI_STREAM_PATH, handler: (req, res) => serveAi(withLlm as unknown as LlmCtx, liveWorkspaces, req, res) }), "dsh-generative-ui: model stream");
    });
  });
  // Scoped rather than listed in `inject`: cordis has no optional injection, so naming "skills"
  // there would keep the whole plugin — wasm route included — inactive wherever the skill
  // subsystem is disabled. Nested, only the skill goes missing.
  // Model-only: `/generative-ui` as a user command would just print the guidance at the user.
  ctx.inject(["skills"], (scoped) => {
    scoped.effect(() => scoped.skills.register({ name: SKILL_NAME, description: SKILL_DESCRIPTION, content: skillBody(typesImportMap(import.meta.url)), source: "runtime", invocation: { modelInvocable: true, userInvocable: false } }), "dsh-generative-ui: skill");
  });
}
