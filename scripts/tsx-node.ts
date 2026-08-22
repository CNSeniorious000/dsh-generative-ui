/**
 * The tsx compiler for scripts, loaded from disk.
 *
 * Not `src/client/runtime/compiler.ts`: that one initialises from `WASM_PATH`, an HTTP route
 * this plugin serves, which no Node script can fetch. The wasm is the same file either way —
 * only where it comes from differs, so this is a second loader rather than a second compiler.
 */
import { readdirSync } from "node:fs";

import initTsx, { transform } from "@esm.sh/tsx";

let ready: Promise<unknown> | null = null;

export const initTsxFromDisk = () => (ready ??= Bun.file("node_modules/@esm.sh/tsx/pkg/tsx_bg.wasm").arrayBuffer().then(initTsx));

/** Compile one card the way the runtime does, minus the import-map rewrite. */
export const compileCard = (filename: string, code: string) => transform({ filename, code, target: "es2022", jsxImportSource: "react" });

/** The cards in a directory, sorted — the fixed input for the card checkers. */
export const cardsIn = (dir: string) => readdirSync(dir).filter(n => n.endsWith(".tsx")).toSorted();
