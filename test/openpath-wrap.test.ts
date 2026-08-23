import { expect, test } from "bun:test";
import { apply } from "../src/client/index.ts";
import { canvasPath } from "../src/contract.ts";

/**
 * The plugin wraps the host's `workspaces.openPath` so a canvas link opens the panel instead of
 * the OS opener. Three paths, none of which was constrained: a host that has no `openPath` at
 * all, a canvas path, and everything else.
 *
 * Wrapping someone else's method is the riskiest thing the plugin does to its host — losing the
 * bet on its shape throws during registration and takes the whole plugin down.
 */
const applyWithWorkspaces = (workspaces: Record<string, unknown>) => {
  const disposers: (() => void)[] = [];
  const stub = (): unknown => new Proxy(() => stub(), { get: () => stub(), apply: () => stub() });
  const base: Record<string, unknown> = {
    workspaces,
    effect: (run: () => unknown) => { try { const d = run(); if (typeof d === "function") disposers.push(d as () => void) } catch { /* only this effect is the subject */ } },
    inject: (_want: readonly string[], callback: (scoped: unknown) => void) => callback(scoped),
  };
  const scoped: unknown = new Proxy(base, { get: (t, k) => (k in t ? t[k as string] : stub()) });
  apply(scoped as never);
  return { disposers };
};

test("a host without openPath keeps its own behaviour rather than throwing", () => {
  const workspaces: Record<string, unknown> = {};
  expect(() => applyWithWorkspaces(workspaces)).not.toThrow();
  expect(workspaces.openPath).toBeUndefined();
});

test("a non-canvas path is forwarded to the original opener untouched", async () => {
  const opened: string[] = [];
  const workspaces: Record<string, unknown> = { openPath: async (path: string) => void opened.push(path) };
  applyWithWorkspaces(workspaces);
  await (workspaces.openPath as (p: string) => Promise<void>)("/notes/todo.md");
  expect(opened).toEqual(["/notes/todo.md"]);
});

/**
 * With no panel mounted the canvas path must ALSO fall through to the original — headless, or
 * after teardown, the OS opener is still the right answer. Losing this is a link that silently
 * does nothing.
 */
test("a canvas path falls through when no panel is mounted", async () => {
  const opened: string[] = [];
  const workspaces: Record<string, unknown> = { openPath: async (path: string) => void opened.push(path) };
  applyWithWorkspaces(workspaces);
  await (workspaces.openPath as (p: string) => Promise<void>)(canvasPath("abc123"));
  expect(opened).toEqual([canvasPath("abc123")]);
});

test("the disposer restores an opener rather than deleting the property", async () => {
  const opened: string[] = [];
  const original = async (path: string) => void opened.push(path);
  const workspaces: Record<string, unknown> = { openPath: original };
  const { disposers } = applyWithWorkspaces(workspaces);
  expect(workspaces.openPath).not.toBe(original);
  for (const dispose of disposers) dispose();
  // Restored, not deleted: deleting the own-property would expose another plugin's wrap, or
  // the prototype's. It is not reference-identical because the source restores a `.bind()`
  // copy — what matters is that an own-property is there and it reaches the original.
  expect(Object.hasOwn(workspaces, "openPath")).toBe(true);
  await (workspaces.openPath as (p: string) => Promise<void>)(canvasPath("abc123"));
  expect(opened).toEqual([canvasPath("abc123")]); // no longer intercepting
});
