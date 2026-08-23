/**
 * The guards and the cache in `bindings.ts`.
 *
 * `stream.test.ts` covers the `$dsh/ai` path only. Measured by inverting each condition alone:
 * eight of the fifteen `if`s in this module changed nothing that any test asserted — including
 * every "no host bound" and "needs a session workspace" guard on `fs` and `exec`, both
 * `!response.ok` denials, and the `bindingImports` cache. A card calling `readFile` with no host
 * would have returned a URL query containing `undefined` rather than saying so.
 */
import { restoreGlobals } from "./globals.ts";
import { beforeEach, afterEach, expect, test } from "bun:test";
import { EXEC_PATH, FS_PATH } from "../src/contract-assets.ts";
import { bind, bindingImports, registerUi4aHost, releaseBindings } from "../src/client/runtime/bindings.ts";

let release: (() => void) | undefined;
// Before, not only after. The module-level host is shared with every other test FILE — bun
// keeps one module registry per RUN — so the "no host bound" test below asserts a state this
// file must ESTABLISH rather than assume. In file order nothing has bound one yet; under
// `--randomize` another file may have registered one and not released it.
//
// `releaseBindings()` does NOT do this: it revokes cached blob URLs and leaves `host` alone.
// Registering a throwaway host and immediately calling its disposer is the only way to reach
// the module's `host = null` from outside.
beforeEach(() => { releaseBindings(); registerUi4aHost({} as never)() });
afterEach(() => {
  release?.();
  release = undefined;
  restoreGlobals();
  releaseBindings();
});

const hostWith = (cwd: string | undefined) => registerUi4aHost({ cwd: () => cwd, sessionId: () => "s1" } as never);

test("with no host bound, fs and exec say so instead of building a URL", () => {
  expect(() => bind().fs.readFile("a.txt")).toThrow("no host bound");
  // `sendMessage` drives the next turn; with no host it would silently swallow the card's turn.
  expect(() => bind().chat.sendMessage("hi")).toThrow("no host bound");
  expect(() => bind().exec.bash("ls")).toThrow("no host bound");
});

test("a host without a workspace names the missing workspace, not the missing host", () => {
  release = hostWith(undefined);
  expect(() => bind().fs.readFile("a.txt")).toThrow("$dsh/fs needs a session workspace");
  expect(() => bind().exec.bash("ls")).toThrow("$dsh/exec needs a session workspace");
});

// A denial carries the route's own `error` so the card can say "this session is read-only".
test("a rejected fs or exec request surfaces the route's reason", async () => {
  release = hostWith("/tmp");
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://x").pathname;
    expect([FS_PATH, EXEC_PATH]).toContain(path);
    return new Response(JSON.stringify({ error: "read-only session" }), { status: 403 });
  }) as typeof fetch;
  await expect(bind().fs.readFile("a.txt")).rejects.toThrow("read-only session");
  await expect(bind().exec.bash("ls")).rejects.toThrow("read-only session");
});

// `statusText` is the fallback when the route dies before writing a body at all.
test("a denial with no body still names something", async () => {
  release = hostWith("/tmp");
  globalThis.fetch = (async () => new Response("<html>", { status: 502, statusText: "Bad Gateway" })) as typeof fetch;
  await expect(bind().fs.readFile("a.txt")).rejects.toThrow("Bad Gateway");
});

/**
 * The blob URLs are built once. Rebuilding them per call would leak a URL per import and, worse,
 * hand two surfaces different module identities for `$dsh/fs` — the same singleton problem that
 * makes a second React instance render blank.
 */
test("the binding blobs are built once and revoked on release", () => {
  const first = bindingImports();
  expect(bindingImports()).toBe(first);
  releaseBindings();
  expect(bindingImports()).not.toBe(first);
});

// The teardown returned by `registerUi4aHost` must not unbind a host that replaced it.
test("releasing a stale host does not unbind the current one", () => {
  const stale = hostWith("/a");
  release = hostWith("/b");
  stale();
  // The guard throws synchronously, before any request: asserting through the promise instead
  // makes the test depend on whatever `fetch` happens to be installed.
  globalThis.fetch = (async () => new Response("{}")) as typeof fetch;
  expect(() => bind().fs.readFile("x")).not.toThrow();
});
