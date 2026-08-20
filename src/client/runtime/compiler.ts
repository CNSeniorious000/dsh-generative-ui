import initTsx, { transform as transformTsx } from "@esm.sh/tsx";
import { normalizeGeneratedTsx } from "partial-tsx";
import { rewriteImportMetaResolveSpecifiers, type RendererImportMap } from "partial-react/import-map";
import { WASM_PATH } from "../../contract-assets.ts";

// Structurally equivalent to `partial-react/compiler`'s three types. Deliberately not
// imported from there: that module has a Vite-only `...tsx_bg.wasm?url` at the top level
// plus a node:fs read path and a `Bun` global, none of which survive a plugin bundle.
export type CompileOptions = { importMap?: RendererImportMap; partial?: boolean; previousCode?: string; filename?: string };
export type CompileResult = { code: string; source: string; changed: boolean };
export type TsxCompiler = { compile: (code: string, options?: CompileOptions) => Promise<CompileResult> };

let initPromise: Promise<unknown> | null = null;

/** The wasm is served by this plugin's own webServer route; /plugins only serves client.js. */
const initCompiler = () =>
  (initPromise ??= initTsx(WASM_PATH).catch((error: unknown) => {
    initPromise = null;
    throw error;
  }));

/**
 * Starts loading the ~2.5 MB wasm so it is warm before the first real frame (a cold init
 * costs 400-500 ms). Never throws: `apply()` calls this and nothing else awaits it, so a
 * synchronous failure inside `initTsx` — an unfetchable wasm path, say — would otherwise
 * take the whole plugin's registration down with it and leave the shell loading forever.
 * A cold compile on the first card is a far better outcome than no plugin at all.
 */
export const warmCompiler = (): Promise<unknown> => {
  try {
    return initCompiler().catch(() => undefined);
  } catch {
    initPromise = null;
    return Promise.resolve();
  }
};

export function createBrowserTsxCompiler(): TsxCompiler {
  return {
    async compile(code, options = {}) {
      await initCompiler();
      const source = options.partial === true ? normalizeGeneratedTsx(code, { mode: "streaming" }) : code;
      const importMap = options.importMap;
      const resolved = importMap?.imports ? rewriteImportMetaResolveSpecifiers(source, importMap.imports) : source;
      const result = transformTsx({ filename: options.filename ?? "_.tsx", code: resolved, target: "es2022", importMap, jsxImportSource: "react" });
      const compiled = new TextDecoder().decode(result.code);
      return { code: compiled, source, changed: compiled !== options.previousCode };
    },
  };
}
