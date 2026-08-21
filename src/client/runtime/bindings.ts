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
import { AI_STREAM_PATH, FS_PATH } from "../../contract-assets.ts";
import { capabilityModule } from "../../contract.ts";
import { registerRuntimeModules } from "./register.ts";

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

export function registerUi4aHost(next: Ui4aHost): () => void {
  host = next;
  registerModules({ [INTERNAL]: { bind } });
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
     * Streams text from the app's own model, yielded character by character.
     *
     * Nothing here holds a credential: the Node half forwards to `ctx.llm`, which owns the
     * provider route and the keys. Reach for it when the *content* is the variable part —
     * the recipe, the five candidate names — and skip it when the data is genuinely fixed.
     */
    streamText: (options: Ui4aStreamOptions | string): AsyncIterable<string> => {
      if (host === null) throw new Error("[dsh-generative-ui] no host bound");
      const workspace = host.cwd();
      if (workspace === undefined) throw new Error("[dsh-generative-ui] $dsh/ai needs a session workspace");
      return streamFrom(workspace, typeof options === "string" ? { prompt: options } : options);
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

  return { chat, ai, fs };
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

/** One entry of a directory listing. `size` is absent for directories. */
export type Ui4aDirEntry = { name: string; type?: "file" | "directory"; size?: number };

/** One user turn plus an optional system prompt — see the route's note on why not more. */
export type Ui4aStreamOptions = { prompt: string; system?: string };

/**
 * Decodes the route's plain-text stream into characters.
 *
 * Character-at-a-time rather than chunk-at-a-time because that is what the consumer wants:
 * generated cards append to a buffer and re-parse it, and a card that grows by whole network
 * chunks reads as stuttering rather than typing.
 */
async function* streamFrom(cwd: string, request: Ui4aStreamOptions): AsyncIterable<string> {
  const response = await fetch(`${AI_STREAM_PATH}?cwd=${encodeURIComponent(cwd)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
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
    yield* decoder.decode(value, { stream: true });
  }
}

const GROUPS = ["chat", "ai", "fs"] as const;

/** Blob URLs for every `$dsh/*` module, built once and reused by every surface. */
let cached: Record<string, string> | null = null;

export function bindingImports(): Record<string, string> {
  if (cached !== null) return cached;
  const internal = moduleUrl(INTERNAL);
  const imports: Record<string, string> = {};
  const bound = bind();
  for (const group of GROUPS) {
    const names = Object.keys(bound[group]);
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
