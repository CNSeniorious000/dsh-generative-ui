/**
 * The `$dsh/*` capability modules generated code may import.
 *
 * These are real TypeScript that lives in our bundle; generated code reaches them through
 * a per-surface blob shim, because a blob URL cannot carry a query string and the surface
 * identity therefore has to be compiled into the module body.
 *
 * Ported from ui4a-playground, minus what this host cannot back: there is no browser-side
 * filesystem service in dsh (`dsh-fs` is the Node half only) and no client-facing model
 * gateway, so `$dsh/fs` and `$dsh/ai` have no implementation here yet.
 */
import { moduleUrl, registerModules, registryImports } from "./registry.ts";
import { AI_STREAM_PATH, EXEC_PATH, FS_PATH, WEB_SEARCH_PATH } from "../../contract-assets.ts";
import { capabilityModule } from "../../contract.ts";
import { registerRuntimeModules } from "./register.ts";
import { usePersistedState } from "./state.ts";

/** What the plugin's client half lends to generated code. Registered once, at apply. */
export type Ui4aHost = {
  /** Sends a prompt into the current session, exactly as the composer would. */
  send: (text: string) => void;
  /** The current session's workspace, which the AI route authorizes against. */
  cwd: () => string | undefined;
  /** The open session, so a write runs under the access mode the composer shows. */
  sessionId: () => string;
};

const INTERNAL = capabilityModule("internal");
let host: Ui4aHost | null = null;

/** Named so the round trip can be tested against the real code rather than a copy of it. */
export function decodeBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function registerUi4aHost(next: Ui4aHost): () => void {
  host = next;
  return () => {
    if (host === next) host = null;
  };
}

/**
 * The capability surface, one group per `$dsh/<group>` module.
 *
 * A function rather than a constant so the host can be swapped (or torn down) without the
 * already-imported blob modules going stale — they close over `bind`, not over a host.
 */
export function bind() {
  const chat = {
    /**
     * Drives the next turn from inside a card. The text is what the user would have typed:
     * it lands in the transcript as their message, because a turn nobody can see arriving
     * reads as the app talking to itself.
     */
    sendMessage: (text: string) => {
      if (host === null) throw new Error("[dsh-generative-ui] no host bound");
      host.send(text);
    },
  };
  const ai = {
    /**
     * Streams text from the app's own model, one piece per network chunk.
     *
     * Nothing here holds a credential: the Node half forwards to `ctx.llm`, which owns the
     * provider route and the keys. Reach for it when the *content* is the variable part —
     * the recipe, the five candidate names — and skip it when the data is genuinely fixed.
     */
    streamText: (options: Ui4aStreamOptions | string): AsyncIterable<string> => {
      if (host === null) throw new Error("[dsh-generative-ui] no host bound");
      const workspace = host.cwd();
      if (workspace === undefined) throw new Error("[dsh-generative-ui] $dsh/ai needs a session workspace");
      const request = typeof options === "string" ? { prompt: options } : options;
      return streamFrom(workspace, request, request.signal);
    },
  };

  const fs = {
    /** The file's text. Throws when it does not exist or the session may not read it. */
    readFile: (path: string) => request<{ content: string }>("GET", path).then((body) => body.content),
    /**
     * Directory entries: the name, whether it is a file or a directory, and a file's size.
     *
     * An array of objects rather than of names, because without `type` a card cannot draw a
     * tree — it would have to probe every entry with a second call to find out whether it
     * can be descended into. The host has all three already; we used to drop two of them.
     */
    readdir: (path: string) => request<{ entries: Ui4aDirEntry[] }>("GET", path, undefined, "list=1").then((body) => body.entries),
    /**
     * The file's bytes, for anything that is not text.
     *
     * `readFile` decodes as UTF-8, so a .mid, a wav or a png read that way comes back with
     * every byte above 0x7f replaced by U+FFFD — corrupt, and silently so. Anything handed to
     * `decodeAudioData`, a MIDI parser or an image decoder has to come through here.
     */
    readBytes: (path: string) => request<{ base64: string }>("GET", path, undefined, "bytes=1").then((body) => decodeBase64(body.base64)),
    /**
     * Writes the file, subject to the session's own access mode.
     *
     * Under `Read Only` this rejects exactly as the model's own `write` would — the fence
     * is the host's, not ours, so what a card may do never diverges from what the composer
     * says the session may do.
     */
    // `Promise<void>`, not the `Promise<undefined>` a bare `.then(() => undefined)` infers:
    // what a caller may do with the result is the contract, and `types/chat.d.ts` says void.
    writeFile: async (path: string, content: string): Promise<void> => {
      await request<{ written: string }>("POST", path, content);
    },
  };

  const exec = {
    /**
     * Runs one command in the workspace and resolves with its output.
     *
     * A non-zero exit resolves rather than rejects: `git status` failing outside a repo is
     * something a card wants to show, not an outage. Only a failure to run at all rejects.
     * The session's own sandbox mode applies, so this is no wider than the model's own bash.
     */
    bash: (command: string, options?: { signal?: AbortSignal }): Promise<Ui4aExecResult> => {
      if (host === null) throw new Error("[dsh-generative-ui] no host bound");
      const workspace = host.cwd();
      if (workspace === undefined) throw new Error("[dsh-generative-ui] $dsh/exec needs a session workspace");
      return execRequest(workspace, host.sessionId(), command, options?.signal);
    },
  };

  const web = {
    /**
     * One web search, through whichever provider the host composed.
     *
     * Search only: `ctx.web` also does `fetch`, and this deployment turns that off for its own
     * tools because the local backend can reach private-network addresses. A card wanting a page
     * body should ask the user for it or search for a quotable source instead.
     */
    search: (query: string, options?: { maxResults?: number; signal?: AbortSignal }): Promise<Ui4aSearchResult> => {
      if (host === null) throw new Error("[dsh-generative-ui] no host bound");
      const workspace = host.cwd();
      if (workspace === undefined) throw new Error("[dsh-generative-ui] $dsh/web needs a session workspace");
      return searchRequest(workspace, query, options);
    },
  };

  // No host behind this one — `localStorage` and React are both already in the page. It exists
  // because the model reaches for it unprompted: five of six habit-tracker runs wrote
  // `import { usePersistedState } from "$dsh/state"` against a module that did not exist, and a
  // reworded denial in the skill did not stop it. An unresolvable specifier takes the whole module
  // with it, so the card renders blank.
  const state = { usePersistedState };

  return { chat, ai, fs, exec, web, state };
}

/** What one search returns. Mirrors the seam's `WebSearchResult`, which is what the route forwards. */
export type Ui4aSearchResult = {
  /** A provider-generated answer or summary, when the provider makes one (Exa and DeepSeek do not). */
  content?: string;
  sources: readonly { url: string; title?: string; snippet?: string; publishedAt?: string }[];
  /** True when the seam cut `sources` down to the requested bound. */
  truncated: boolean;
};

async function searchRequest(cwd: string, query: string, options?: { maxResults?: number; signal?: AbortSignal }): Promise<Ui4aSearchResult> {
  const response = await fetch(`${WEB_SEARCH_PATH}?cwd=${encodeURIComponent(cwd)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, ...(options?.maxResults === undefined ? {} : { maxResults: options.maxResults }) }),
    signal: options?.signal,
  });
  const body = (await response.json().catch(() => ({}))) as Ui4aSearchResult & { error?: string };
  if (!response.ok) throw new Error(`[dsh-generative-ui] $dsh/web: ${body.error ?? response.statusText}`);
  return body;
}

/** Talks to the fs route, carrying the workspace and the session whose policy applies. */
async function request<T>(method: "GET" | "POST", path: string, content?: string, extra?: string): Promise<T> {
  if (host === null) throw new Error("[dsh-generative-ui] no host bound");
  const workspace = host.cwd();
  if (workspace === undefined) throw new Error("[dsh-generative-ui] $dsh/fs needs a session workspace");
  const query = `cwd=${encodeURIComponent(workspace)}&session=${encodeURIComponent(host.sessionId())}&path=${encodeURIComponent(path)}${extra === undefined ? "" : `&${extra}`}`;
  const response = await fetch(`${FS_PATH}?${query}`, content === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ content }) });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  // A denial is not an outage. Naming it lets the card say "this session is read-only"
  // rather than "something went wrong".
  if (!response.ok) throw new Error(`[dsh-generative-ui] $dsh/fs ${path}: ${body.error ?? response.statusText}`);
  return body as T;
}

/** What a command left behind. `truncated` means the output was cut, not that it failed. */
export type Ui4aExecResult = { stdout: string; stderr: string; exitCode: number | null; truncated: { stdout: boolean; stderr: boolean }; timedOut: boolean };

/** Talks to the exec route. Separate from `request` because the shape and the failure mode differ. */
async function execRequest(cwd: string, sessionId: string, command: string, signal?: AbortSignal): Promise<Ui4aExecResult> {
  const query = `cwd=${encodeURIComponent(cwd)}&session=${encodeURIComponent(sessionId)}`;
  // Aborting really kills the command: the route hangs its own controller off `req.on("close")`,
  // so dropping the request is what a polling card needs to not stack runs on a slow one.
  const response = await fetch(`${EXEC_PATH}?${query}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command }), signal });
  const body = (await response.json().catch(() => ({}))) as Ui4aExecResult & { error?: string };
  if (!response.ok) throw new Error(`[dsh-generative-ui] $dsh/exec: ${body.error ?? response.statusText}`);
  return body;
}

/** One entry of a directory listing. `size` is absent for directories. */
export type Ui4aDirEntry = { name: string; type?: "file" | "directory"; size?: number };

/** One user turn plus an optional system prompt — see the route's note on why not more. */
export type Ui4aStreamOptions = { prompt: string; system?: string; signal?: AbortSignal };

/**
 * Decodes the route's plain-text stream into characters.
 *
 * Character-at-a-time rather than chunk-at-a-time because that is what the consumer wants:
 * generated cards append to a buffer and re-parse it, and a card that grows by whole network
 * chunks reads as stuttering rather than typing.
 */
async function* streamFrom(cwd: string, request: Ui4aStreamOptions, signal?: AbortSignal): AsyncIterable<string> {
  // Aborting stops the model too, not just the reading: the route drops its own generation when
  // the request closes. A card that regenerates per keystroke needs that, or what the reader
  // ends up seeing is whichever of several in-flight calls happens to finish last.
  const response = await fetch(`${AI_STREAM_PATH}?cwd=${encodeURIComponent(cwd)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok) throw new Error(`[dsh-generative-ui] $dsh/ai: ${response.status} ${response.statusText}`);
  if (response.body === null) throw new Error("[dsh-generative-ui] $dsh/ai: no response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // `stream: true` so a multi-byte character split across chunks is not mangled — the
    // failure mode is a replacement character mid-word in any non-ASCII answer.
    //
    // `yield`, not `yield*`: spreading the string hands the consumer one character at a time,
    // which for a card that re-renders per piece is a setState per character. Measured on 560
    // characters of Chinese: 560 iterations spread, 27 by chunk, identical text either way.
    const text = decoder.decode(value, { stream: true });
    if (text !== "") yield text;
  }
}

/** Blob URLs for every `$dsh/*` module, built once and reused by every surface. */
let cached: Record<string, string> | null = null;

export function bindingImports(): Record<string, string> {
  if (cached !== null) return cached;
  // Registered here rather than in `registerUi4aHost`: what goes in the registry is `bind` itself,
  // which does not depend on the host *value*. Hanging it off host registration meant a page with
  // no host — a preview, a harness, the first frame of a session, any profile without
  // `conversation` — got capability blobs importing an EMPTY `$dsh/internal`. The first mount
  // reported `Unresolvable imports` and every one after it rendered silently blank. Verified: with
  // this moved, a `$dsh/state` card mounts and persists with nothing else registered, and a
  // `$dsh/chat` card lays out correctly and only throws `no host bound` when the button is pressed.
  registerModules({ [INTERNAL]: { bind } });
  const internal = moduleUrl(INTERNAL);
  const imports: Record<string, string> = {};
  const bound = bind();
  // Enumerated from `bind()`, not from a list beside it: a group added to the implementation and
  // missed here would simply have no blob module, and a card importing it renders blank with
  // nothing in the console — the failure mode this project spends the most effort on.
  for (const [group, members] of Object.entries(bound)) {
    const names = Object.keys(members);
    // One `export const` per name: ESM export names must be statically visible.
    const source = [`import { bind } from ${JSON.stringify(internal)};`, `const g = bind().${group};`, ...names.map((name) => `export const ${name} = g.${name};`), "export default g;"].join("\n");
    imports[capabilityModule(group)] = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  }
  cached = imports;
  return imports;
}

export function releaseBindings(): void {
  for (const url of Object.values(cached ?? {})) URL.revokeObjectURL(url);
  cached = null;
}

/**
 * Every module generated code can import without reaching the network: the shell's React
 * family, plus the `$dsh/*` capabilities.
 *
 * Exported from the plugin's client entry as well, so `bun run smoke` can build the blob
 * modules and parse them. They are synthesized strings that nothing type-checks, and a
 * syntax error in one fails the way an unresolvable import does — the whole module graph
 * dies and the card renders blank with no console error.
 */
export function localImports(): Record<string, string> {
  registerRuntimeModules();
  return { ...registryImports(), ...bindingImports() };
}
