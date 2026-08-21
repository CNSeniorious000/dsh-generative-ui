/**
 * The `$ui4a/*` capability modules generated code may import.
 *
 * These are real TypeScript that lives in our bundle; generated code reaches them through
 * a per-surface blob shim, because a blob URL cannot carry a query string and the surface
 * identity therefore has to be compiled into the module body.
 *
 * Ported from ui4a-playground, minus what this host cannot back: there is no browser-side
 * filesystem service in dsh (`dsh-fs` is the Node half only) and no client-facing model
 * gateway, so `$ui4a/fs` and `$ui4a/ai` have no implementation here yet.
 */
import { moduleUrl, registerModules } from "./registry.ts";

/** What the plugin's client half lends to generated code. Registered once, at apply. */
export type Ui4aHost = {
  /** Sends a prompt into the current session, exactly as the composer would. */
  send: (text: string) => void;
};

const INTERNAL = "$ui4a/internal";
let host: Ui4aHost | null = null;

export function registerUi4aHost(next: Ui4aHost): () => void {
  host = next;
  registerModules({ [INTERNAL]: { bind } });
  return () => {
    if (host === next) host = null;
  };
}

/**
 * The capability surface, one group per `$ui4a/<group>` module.
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
  return { chat };
}

const GROUPS = ["chat"] as const;

/** Blob URLs for every `$ui4a/*` module, built once and reused by every surface. */
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
    imports[`$ui4a/${group}`] = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  }
  cached = imports;
  return imports;
}

export function releaseBindings(): void {
  for (const url of Object.values(cached ?? {})) URL.revokeObjectURL(url);
  cached = null;
}
