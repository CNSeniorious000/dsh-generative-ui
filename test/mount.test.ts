/**
 * `whenFrameReady` — how the canvas panel finds the host's layout element.
 *
 * The selector tracks a hashed class name in someone else's bundle, so it *will* break on a
 * host rebuild, and the failure is a panel that silently never appears. Everything here is
 * about that: resolve immediately when the frame is already painted, wait when it is not, warn
 * rather than hang when it never arrives, and cancel cleanly when disposed first.
 *
 * Stubbed rather than run against a DOM library: the function touches `querySelector`,
 * `MutationObserver` and the timer pair, so the fakes are the exact surface it depends on.
 */
import { restoreGlobals } from "./globals.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

let frame: unknown = null;
let fire: () => void = () => {};
let observing = 0, disconnected = 0, cleared = 0;
let timeoutFn: (() => void) | null = null;
let warnings: string[] = [];

// Restore what this file stubs: bun shares one global per RUN, so a `document` with no
// `querySelectorAll` left installed breaks whichever file sweeps next.
afterEach(restoreGlobals);

beforeEach(() => {
  frame = null; observing = 0; disconnected = 0; cleared = 0; timeoutFn = null; warnings = [];
  (globalThis as any).document = { body: {}, querySelector: () => frame };
  (globalThis as any).MutationObserver = class {
    private live = false;
    // A disconnected observer stops delivering. Without modelling that, `fire()` after dispose
    // still invokes the callback and the disposal test fails against correct code — the fake
    // has to reproduce the part of the contract the code relies on, not just the method names.
    constructor(private readonly cb: () => void) { fire = () => { if (this.live) this.cb() } }
    observe() { observing += 1; this.live = true }
    disconnect() { disconnected += 1; this.live = false }
  };
  (globalThis as any).window = { setTimeout: (fn: () => void) => { timeoutFn = fn; return 1 }, clearTimeout: () => { cleared += 1 } };
  (globalThis as any).console = { ...console, warn: (msg: string) => warnings.push(msg) };
});

const load = async () => (await import(`../src/client/canvas/mount.ts?${Math.random()}`)).whenFrameReady;

describe("whenFrameReady", () => {
  test("an already-painted frame resolves without observing anything", async () => {
    frame = { id: "frame" };
    let got: unknown = null;
    (await load())((f: unknown) => { got = f });
    expect(got).toBe(frame);
    expect(observing).toBe(0);
  });

  test("a frame that arrives later resolves on the mutation", async () => {
    let got: unknown = null;
    (await load())((f: unknown) => { got = f });
    expect(got).toBeNull();
    expect(observing).toBe(1);
    frame = { id: "late" };
    fire();
    expect(got).toBe(frame);
    // Both the observer and the timeout must be released, or a found frame leaves a 15s timer
    // armed that will disconnect nothing and warn about a panel that mounted fine.
    expect(disconnected).toBe(1);
    expect(cleared).toBe(1);
  });

  test("a mutation with still no frame keeps waiting", async () => {
    let calls = 0;
    (await load())(() => { calls += 1 });
    fire();
    expect(calls).toBe(0);
    expect(disconnected).toBe(0);
  });

  // The whole reason the timeout exists: without it a changed host selector is a mystery,
  // and the warning names the selector so the next person has a starting point.
  test("a frame that never arrives warns instead of waiting forever", async () => {
    (await load())(() => {});
    expect(timeoutFn).not.toBeNull();
    timeoutFn?.();
    expect(disconnected).toBe(1);
    expect(warnings[0]).toContain("no AppFrame matched");
  });

  test("disposing before the frame appears cancels both the observer and the timer", async () => {
    let calls = 0;
    const dispose = (await load())(() => { calls += 1 });
    dispose();
    expect(disconnected).toBe(1);
    expect(cleared).toBe(1);
    frame = { id: "too late" };
    fire();
    expect(calls).toBe(0);
  });
});
