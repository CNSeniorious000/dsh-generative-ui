/**
 * Stands in for `partial-react/src/compiler.ts` at bundle time (see scripts/build.ts).
 *
 * That module is unusable in a plugin bundle: it has a top-level `import.meta.resolve`
 * — a syntax error inside a CJS factory whether or not the branch runs — plus a `Bun`
 * global and a node:fs read path. We already ship our own browser compiler, so the
 * upstream one is dead weight even after the syntax problem.
 *
 * partial-react's runtime only imports `createTsxCompiler` from it.
 */
export { createBrowserTsxCompiler as createTsxCompiler } from "./compiler.ts";
export type { CompileOptions, CompileResult, TsxCompiler } from "./compiler.ts";
